import { parseStack } from './stackParser'
import type { CentryConfig, ParsedDsn } from './types'
import { parseDsn } from './types'

// ── Envelope builder ──────────────────────────────────────────────────────────

function buildEnvelope(event: Record<string, unknown>, dsn: ParsedDsn): string {
  const eventJson = JSON.stringify(event)
  const header = JSON.stringify({ dsn: `${dsn.host}/api/${dsn.projectId}/`, sent_at: new Date().toISOString() })
  const itemHeader = JSON.stringify({ type: 'event', length: eventJson.length })
  return `${header}\n${itemHeader}\n${eventJson}\n`
}

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

// Cache fetched source files for the lifetime of the page — avoids re-fetching
// the same large bundle multiple times if several errors occur.
const sourceCache = new Map<string, string[] | null>()

/**
 * Fetch a JS source file and return its lines, or null on any failure.
 * Uses a 2-second timeout so it can never meaningfully delay error capture.
 * Only fetches same-origin or CORS-accessible URLs; silently drops the rest.
 */
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

/**
 * Enrich stack frames with source context lines by fetching each unique
 * source file. All fetches run in parallel. Failures are silently ignored —
 * frames without context are still included in the event.
 */
async function enrichFrames(frames: FrameRaw[]): Promise<FrameWithContext[]> {
  // Collect unique filenames that look like fetchable URLs
  const urls = [...new Set(
    frames
      .map((f) => f.filename)
      .filter((fn) => fn && /^https?:\/\//.test(fn))
  )]

  // Fetch all files in parallel
  const sourceMap = new Map<string, string[] | null>()
  await Promise.all(
    urls.map(async (url) => {
      sourceMap.set(url, await fetchSourceLines(url))
    })
  )

  return frames.map((f): FrameWithContext => {
    const lines = sourceMap.get(f.filename) ?? null
    if (!lines || !f.lineno) return f

    const idx = f.lineno - 1 // 0-indexed
    const pre = lines.slice(Math.max(0, idx - CONTEXT_LINES), idx)
    const context = lines[idx]
    const post = lines.slice(idx + 1, idx + 1 + CONTEXT_LINES)

    return {
      ...f,
      pre_context: pre,
      context_line: context,
      post_context: post,
    }
  })
}

// ── Core client ───────────────────────────────────────────────────────────────

export class CentryClient {
  private config: CentryConfig
  private dsn: ParsedDsn
  private recentErrors = new Set<string>()

  constructor(config: CentryConfig) {
    this.config = config
    this.dsn = parseDsn(config.dsn)
  }

  /** Capture a manually-caught exception (handled = true). */
  captureException(error: unknown): void {
    void this._capture(error, true)
  }

  /** Internal: capture an unhandled exception (handled = false). Used by globalHandlers. */
  captureUnhandled(error: unknown): void {
    void this._capture(error, false)
  }

  private async _capture(error: unknown, handled: boolean): Promise<void> {
    try {
      if (this.config.enabled === false) return
      if (typeof window === 'undefined') return

      // Normalise non-Error values to an Error so we always have a stack
      const err = toError(error)
      if (!err) return

      // Filter cross-origin noise — browsers mask these as "Script error."
      if (err.message === 'Script error.' || err.message === 'Script error') return

      // Client-side dedup — skip if we sent this fingerprint in the last 3 s
      const dedupKey = `${err.message}:${err.stack?.slice(0, 120) ?? ''}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      setTimeout(() => this.recentErrors.delete(dedupKey), 3000)

      const frames = err.stack ? parseStack(err.stack) : []
      const allowUrls = this.config.allowUrls

      const rawFrames: FrameRaw[] = frames.map((f) => ({
        ...f,
        in_app: !allowUrls || allowUrls.some((re) => re.test(f.filename)),
      }))

      // Enrich with source context (parallel fetches, 2 s max)
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
          values: [
            {
              type: err.name || 'Error',
              value: err.message,
              mechanism: { type: handled ? 'generic' : 'onerror', handled },
              stacktrace: { frames: enrichedFrames },
            },
          ],
        },
        contexts: {
          browser,
          os,
          page: {
            url: location.href,
            'http.query': location.search,
            referer: document.referrer,
          },
          runtime: { name: 'javascript' },
        },
      }

      this.send(event)
    } catch {
      // Capturing must never throw — swallow everything
    }
  }

  private send(event: Record<string, unknown>): void {
    try {
      const envelope = buildEnvelope(event, this.dsn)
      const authHeader = `Sentry sentry_version=7, sentry_key=${this.dsn.publicKey}`
      const blob = new Blob([envelope], { type: 'text/plain' })

      if (navigator.sendBeacon) {
        navigator.sendBeacon(this.dsn.envelopeUrl, blob)
      } else {
        fetch(this.dsn.envelopeUrl, {
          method: 'POST',
          body: envelope,
          headers: {
            'Content-Type': 'text/plain',
            'X-Sentry-Auth': authHeader,
          },
          keepalive: true,
        }).catch(() => {/* silent */})
      }
    } catch {
      // send must never throw
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Coerce any thrown value into an Error with a stack trace.
 * Returns null only for values that should be completely ignored.
 */
function toError(value: unknown): Error | null {
  if (value instanceof Error) return value

  // Ignore completely empty/nullish throws
  if (value === null || value === undefined) return null

  // Wrap strings and objects
  const msg = typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? (String((value as Record<string, unknown>).message || JSON.stringify(value)))
      : String(value)

  const err = new Error(msg)
  err.name = typeof value === 'object' && (value as Record<string, unknown>).name
    ? String((value as Record<string, unknown>).name)
    : 'UnknownError'
  return err
}
