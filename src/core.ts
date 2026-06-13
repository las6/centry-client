import { parseStack } from './stackParser'
import type { CentryConfig } from './types'
import { envelopeUrl } from './types'
import { scrubUrl } from './utils'
import { buildEnvelope } from './_shared/envelope'

// ── UA parser ─────────────────────────────────────────────────────────────────

function parseUa(): { browser: { name: string; version: string }; os: { name: string; version: string } } {
  const ua = navigator.userAgent
  let browserName = 'Unknown'
  let browserVersion = ''
  let osName = 'Unknown'
  let osVersion = ''

  if (/Edg\//.test(ua)) {
    browserName = 'Edge'
    browserVersion = (ua.match(/Edg\/([\d.]+)/) || [])[1] || ''
  } else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
    browserName = 'Chrome'
    browserVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || ''
  } else if (/Firefox\//.test(ua)) {
    browserName = 'Firefox'
    browserVersion = (ua.match(/Firefox\/([\d.]+)/) || [])[1] || ''
  } else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
    browserName = 'Safari'
    browserVersion = (ua.match(/Version\/([\d.]+)/) || [])[1] || ''
  }

  if (/Mac OS X ([\d_]+)/.test(ua)) {
    osName = 'macOS'
    osVersion = ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || ''
  } else if (/Windows NT ([\d.]+)/.test(ua)) {
    osName = 'Windows'
    osVersion = ua.match(/Windows NT ([\d.]+)/)?.[1] || ''
  } else if (/Linux/.test(ua)) {
    osName = 'Linux'
  } else if (/Android ([\d.]+)/.test(ua)) {
    osName = 'Android'
    osVersion = ua.match(/Android ([\d.]+)/)?.[1] || ''
  } else if (/iPhone OS ([\d_]+)/.test(ua)) {
    osName = 'iOS'
    osVersion = ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || ''
  }

  return {
    browser: { name: browserName, version: browserVersion },
    os: { name: osName, version: osVersion },
  }
}

// ── Source context fetcher ────────────────────────────────────────────────────

const sourceCache = new Map<string, string[] | null>()

async function fetchSourceLines(url: string): Promise<string[] | null> {
  if (sourceCache.has(url)) return sourceCache.get(url)!
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 2000)
    const resp = await fetch(url, { signal: ac.signal, credentials: 'omit' })
    clearTimeout(timer)
    if (!resp.ok) { sourceCache.set(url, null); return null }
    const text = await resp.text()
    const lines = text.split('\n')
    sourceCache.set(url, lines)
    return lines
  } catch {
    sourceCache.set(url, null)
    return null
  }
}

const CONTEXT_LINES = 5

interface FrameRaw {
  filename: string
  function: string
  lineno: number | null
  colno: number | null
  in_app: boolean
}

interface FrameWithContext extends FrameRaw {
  pre_context?: string[]
  context_line?: string
  post_context?: string[]
}

async function enrichFrames(frames: FrameRaw[]): Promise<FrameWithContext[]> {
  const urls = [...new Set(
    frames.map((f) => f.filename).filter((fn) => fn && /^https?:\/\//.test(fn))
  )]
  const sourceMap = new Map<string, string[] | null>()
  await Promise.all(urls.map(async (url) => { sourceMap.set(url, await fetchSourceLines(url)) }))
  return frames.map((f): FrameWithContext => {
    const lines = sourceMap.get(f.filename) ?? null
    if (!lines || !f.lineno) return f
    const idx = f.lineno - 1
    return {
      ...f,
      pre_context: lines.slice(Math.max(0, idx - CONTEXT_LINES), idx),
      context_line: lines[idx],
      post_context: lines.slice(idx + 1, idx + 1 + CONTEXT_LINES),
    }
  })
}

import { toError } from './_shared/toError'
import { RateLimiter } from './_shared/rateLimiter'
import { syncGlobalHandlers } from './integrations/globalHandlers'

// ── Dedup helpers ─────────────────────────────────────────────────────────────

function normalizeForDedup(url: string): string {
  const q = url.indexOf('?')
  if (q === -1) return url
  const path = url.slice(0, q)
  // If path has a file extension, strip all query params (they're cache busters)
  // Otherwise keep them (extensionless paths may encode route params in query)
  return /\.[a-z0-9]{2,8}$/i.test(path) ? path : url
}

// ── Core client ───────────────────────────────────────────────────────────────

export class CentryClient {
  private config: CentryConfig
  private url: string
  private recentErrors = new Set<string>()
  private rateLimiter: RateLimiter

  constructor(config: CentryConfig) {
    this.config = {
      ...config,
      environment: config.environment ?? import.meta.env?.MODE ?? 'production',
    }
    this.url = envelopeUrl(config.project)
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 60_000)
  }

  /** Capture a manually-caught exception (handled = true). */
  captureException(error: unknown): void {
    void this._capture(error, true)
  }

  /** Internal: capture an unhandled exception (handled = false). Used by globalHandlers. */
  captureUnhandled(error: unknown): void {
    void this._capture(error, false)
  }

  /**
   * Capture a plain message (non-exception). Level defaults to 'info'.
   *
   * @example
   * import { captureMessage } from 'centry-client'
   * captureMessage('Payment processed', 'info')
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    void this._captureMessage(message, level)
  }

  private async _capture(error: unknown, handled: boolean): Promise<void> {
    try {
      if (this.config.enabled === false) return
      if (typeof window === 'undefined') return

      const err = toError(error)
      if (!err) return

      // Filter cross-origin noise
      if (err.message === 'Script error.' || err.message === 'Script error') return

      const frames = err.stack ? parseStack(err.stack) : []
      const allowUrls = this.config.allowUrls
      const rawFrames: FrameRaw[] = frames.map((f) => ({
        ...f,
        in_app: !allowUrls || allowUrls.some((re) => re.test(f.filename)),
      }))

      // Client-side dedup — filename-based fingerprint within dedupWindowMs (default 10s)
      const firstFrame = rawFrames.find(f => f.in_app) ?? rawFrames[0]
      const fileKey = firstFrame ? normalizeForDedup(firstFrame.filename) : ''
      const dedupKey = `${err.name}:${err.message}:${fileKey}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      const dedupWindow = this.config.dedupWindowMs ?? 10_000
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow)

      // Rate limit — hard cap per minute, protects against runaway loops
      if (!this.rateLimiter.allow()) return

      const enrichedFrames = await enrichFrames(rawFrames)
      const { browser, os } = parseUa()

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level: 'error',
        environment: this.config.environment,
        release: this.config.release,
        breadcrumbs: { values: [] },
        exception: {
          values: [{
            type: err.name || 'Error',
            value: err.message,
            mechanism: { type: handled ? 'generic' : 'onerror', handled },
            stacktrace: { frames: enrichedFrames },
          }],
        },
        contexts: {
          browser,
          os,
          page: {
            url: scrubUrl(location.href),
            'http.query': scrubUrl(location.search),
            referer: scrubUrl(document.referrer),
          },
          runtime: { name: 'javascript' },
        },
      }

      this.send(event)
    } catch {
      // Capturing must never throw
    }
  }

  private async _captureMessage(message: string, level: string): Promise<void> {
    try {
      if (this.config.enabled === false) return
      if (typeof window === 'undefined') return
      if (!message) return

      const dedupKey = `message:${level}:${message.slice(0, 150)}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      const dedupWindow = this.config.dedupWindowMs ?? 10_000
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow)

      if (!this.rateLimiter.allow()) return

      const { browser, os } = parseUa()

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level,
        environment: this.config.environment,
        release: this.config.release,
        message,
        contexts: {
          browser,
          os,
          page: {
            url: scrubUrl(location.href),
            'http.query': scrubUrl(location.search),
            referer: scrubUrl(document.referrer),
          },
          runtime: { name: 'javascript' },
        },
      }

      this.send(event)
    } catch {
      // Capturing must never throw
    }
  }

  private send(event: Record<string, unknown>): void {
    try {
      const envelope = buildEnvelope(event)
      const blob = new Blob([envelope], { type: 'text/plain' })

      if (navigator.sendBeacon) {
        navigator.sendBeacon(this.url, blob)
      } else {
        fetch(this.url, {
          method: 'POST',
          body: envelope,
          headers: { 'Content-Type': 'text/plain' },
          keepalive: true,
        }).catch(() => {/* silent */})
      }
    } catch {
      // send must never throw
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────
// Mirrors Sentry's API: call init() once at app startup (in your client entry
// file), then use captureException() anywhere without importing the client.

let _client: CentryClient | null = null

/**
 * Initialize Centry. Call once at application startup, before React mounts.
 * In the browser, this also installs global error handlers by default.
 * Subsequent calls replace the active client (useful for hot-reload in dev).
 *
 * @example
 * // client.tsx / main.tsx
 * import { init } from 'centry-client'
 * init({ project: 'my-project' })
 *
 * // Opt out of automatic window error handlers:
 * init({ project: 'my-project', globalHandlers: false })
 */
export function init(config: CentryConfig): CentryClient {
  _client = new CentryClient(config)
  syncGlobalHandlers(config.globalHandlers === false ? null : _client)
  return _client
}

/**
 * Capture an exception. No-op if init() has not been called.
 *
 * @example
 * import { captureException } from 'centry-client'
 * captureException(error)
 */
export function captureException(error: unknown): void {
  _client?.captureException(error)
}

/**
 * Capture a plain message. Level defaults to 'info'.
 * No-op if init() has not been called.
 *
 * @example
 * import { captureMessage } from 'centry-client'
 * captureMessage('Checkout completed', 'info')
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  _client?.captureMessage(message, level)
}

/**
 * Returns the active client, or null if init() has not been called.
 * Prefer captureException() for most use cases.
 */
export function getClient(): CentryClient | null {
  return _client
}

/** Internal test helper. Not part of the public SDK contract. */
export function resetClientForTests(): void {
  _client = null
  syncGlobalHandlers(null)
}
