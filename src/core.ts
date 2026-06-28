import { parseStack } from './stackParser'
import type { CentryConfig, SendErrorReason } from './types'
import { envelopeUrl } from './types'
import { scrubUrl } from './utils'
import { buildEnvelope } from './_shared/envelope'
import { prepareBrowserEventForTransport } from './_shared/browserEventPayload'

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

interface FrameRaw {
  filename: string
  function: string
  lineno: number | null
  colno: number | null
  in_app: boolean
}

import { toError } from './_shared/toError'
import { RateLimiter } from './_shared/rateLimiter'
import { syncGlobalHandlers } from './integrations/globalHandlers'
import { installBreadcrumbs, uninstallBreadcrumbs, getBreadcrumbBuffer } from './integrations/breadcrumbs'

// ── Dedup helpers ─────────────────────────────────────────────────────────────

function normalizeForDedup(url: string): string {
  const q = url.indexOf('?')
  if (q === -1) return url
  const path = url.slice(0, q)
  // If path has a file extension, strip all query params (they're cache busters)
  // Otherwise keep them (extensionless paths may encode route params in query)
  return /\.[a-z0-9]{2,8}$/i.test(path) ? path : url
}

function isDev(): boolean {
  return Boolean(import.meta.env?.DEV)
}

function warnDev(message: string): void {
  if (isDev()) console.warn(message)
}

function getBrowserFetch(): typeof fetch | null {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch.bind(window)
  }
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis)
  return null
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
    // Install breadcrumb interceptors (console, navigation, fetch)
    if (typeof window !== 'undefined' && config.enabled !== false) {
      installBreadcrumbs()
    }
  }

  private reportSendError(error: Error, payloadSize: number, reason: SendErrorReason): void {
    try {
      this.config.onSendError?.(error, payloadSize, reason)
    } catch {
      // send error reporting must never throw
    }

    warnDev(`[centry] ${reason}: ${error.message} (${payloadSize} bytes)`)
  }

  /** Tear down interceptors. Called when the client is replaced. */
  destroy(): void {
    uninstallBreadcrumbs()
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

      const { browser, os } = parseUa()

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level: 'error',
        environment: this.config.environment,
        release: this.config.release,
        breadcrumbs: { values: getBreadcrumbBuffer()?.snapshot() ?? [] },
        exception: {
          values: [{
            type: err.name || 'Error',
            value: err.message,
            mechanism: { type: handled ? 'generic' : 'onerror', handled },
            stacktrace: { frames: rawFrames },
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
      const prepared = prepareBrowserEventForTransport(event)
      if (!prepared.event) {
        this.reportSendError(new Error('Event exceeded browser transport budget'), prepared.originalSize, 'payload_too_large')
        return
      }

      if (prepared.dropped.length > 0) warnDev(`[centry] trimmed event fields: ${prepared.dropped.join(', ')}`)

      const envelope = buildEnvelope(prepared.event)
      const blob = new Blob([envelope], { type: 'text/plain' })

      if (navigator.sendBeacon) {
        const accepted = navigator.sendBeacon(this.url, blob)
        if (accepted) return

        warnDev(`[centry] beacon_refused: navigator.sendBeacon refused the payload (${prepared.envelopeSize} bytes)`)
      } else {
        warnDev('[centry] sendBeacon unavailable, falling back to fetch')
      }

      const fetchImpl = getBrowserFetch()
      if (!fetchImpl) {
        this.reportSendError(new Error('No fetch implementation available for fallback transport'), prepared.envelopeSize, 'send_failed')
        return
      }

      fetchImpl(this.url, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'text/plain' },
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok) {
            this.reportSendError(new Error(`Ingest responded with HTTP ${response.status}`), prepared.envelopeSize, 'http_error')
          }
        })
        .catch((error: unknown) => {
          const nextError = error instanceof Error ? error : new Error(String(error))
          this.reportSendError(nextError, prepared.envelopeSize, 'network_error')
        })
    } catch {
      this.reportSendError(new Error('Unexpected send failure'), 0, 'send_failed')
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
  _client?.destroy()
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
