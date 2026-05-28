// ── Cloudflare Worker client ──────────────────────────────────────────────────
// A stripped-down Centry client that works in CF Workers (and any non-browser
// JS runtime). No DOM APIs — uses fetch() for delivery, which is available
// globally in CF Workers.

import { parseStack } from './stackParser'
import type { CentryConfig } from './types'
import { envelopeUrl } from './types'
import { scrubUrl } from './utils'

// ── Envelope builder ──────────────────────────────────────────────────────────

function buildEnvelope(event: Record<string, unknown>): string {
  const eventJson = JSON.stringify(event)
  const header = JSON.stringify({ sent_at: new Date().toISOString() })
  const itemHeader = JSON.stringify({ type: 'event', length: eventJson.length })
  return `${header}\n${itemHeader}\n${eventJson}\n`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toError(value: unknown): Error | null {
  if (value instanceof Error) return value
  if (value === null || value === undefined) return null
  const msg =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? String((value as Record<string, unknown>).message || JSON.stringify(value))
        : String(value)
  const err = new Error(msg)
  err.name =
    typeof value === 'object' && (value as Record<string, unknown>).name
      ? String((value as Record<string, unknown>).name)
      : 'UnknownError'
  return err
}

function buildRequestContext(request: Request): Record<string, unknown> {
  const headers: Record<string, string> = {}
  const SAFE_HEADERS = ['accept', 'content-type', 'user-agent', 'referer', 'cf-ray', 'cf-connecting-ip']
  for (const key of SAFE_HEADERS) {
    const val = request.headers.get(key)
    if (val) headers[key] = val
  }
  return { method: request.method, url: scrubUrl(request.url), headers }
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

class RateLimiter {
  private readonly max: number
  private readonly windowMs: number
  private timestamps: number[] = []

  constructor(max: number, windowMs: number) {
    this.max = max
    this.windowMs = windowMs
  }

  allow(): boolean {
    const now = Date.now()
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
    if (this.timestamps.length >= this.max) return false
    this.timestamps.push(now)
    return true
  }
}

// ── Request context (AsyncLocalStorage) ──────────────────────────────────────
// Stores the current request for the duration of a fetch handler invocation so
// captureWorkerException() can attach it automatically without being passed it.

type ALS = { getStore(): Request | undefined; run<T>(store: Request, fn: () => T): T }

// AsyncLocalStorage is available in CF Workers (and Node 16+). We access it
// lazily so the module doesn't hard-fail in environments that lack it.
let _als: ALS | null | undefined = undefined // undefined = not yet resolved

function getAls(): ALS | null {
  if (_als !== undefined) return _als
  try {
    // CF Workers expose AsyncLocalStorage on globalThis
    const ALS = (globalThis as Record<string, unknown>)['AsyncLocalStorage'] as
      | (new () => ALS)
      | undefined
    _als = ALS ? new ALS() : null
  } catch {
    _als = null
  }
  return _als
}

// ── WorkerClient ──────────────────────────────────────────────────────────────

export class WorkerClient {
  private config: CentryConfig
  private url: string
  private recentErrors = new Set<string>()
  private rateLimiter: RateLimiter

  constructor(config: CentryConfig) {
    this.config = config
    this.url = envelopeUrl(config.project)
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 60_000)
  }

  /**
   * Capture a caught exception. Optionally pass the `Request` explicitly —
   * if omitted and withCentry() is being used, the request is picked up
   * automatically from AsyncLocalStorage context.
   */
  captureException(error: unknown, request?: Request): void {
    void this._capture(error, true, request ?? getAls()?.getStore())
  }

  /** For use in unhandled rejection / uncaughtException hooks. */
  captureUnhandled(error: unknown, request?: Request): void {
    void this._capture(error, false, request ?? getAls()?.getStore())
  }

  private async _capture(error: unknown, handled: boolean, request?: Request): Promise<void> {
    try {
      if (this.config.enabled === false) return

      const err = toError(error)
      if (!err) return

      // Dedup
      const dedupKey = `${err.name}:${err.message}:${err.stack?.slice(0, 150) ?? ''}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      const dedupWindow = this.config.dedupWindowMs ?? 10_000
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow)

      // Rate limit
      if (!this.rateLimiter.allow()) return

      const frames = err.stack ? parseStack(err.stack) : []

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level: 'error',
        environment: this.config.environment,
        release: this.config.release,
        exception: {
          values: [
            {
              type: err.name || 'Error',
              value: err.message,
              mechanism: { type: handled ? 'generic' : 'onerror', handled },
              stacktrace: { frames },
            },
          ],
        },
        contexts: {
          runtime: { name: 'cloudflare-worker' },
        },
      }

      if (request) {
        event['request'] = buildRequestContext(request)
      }

      await this._send(event)
    } catch {
      // Capturing must never throw
    }
  }

  private async _send(event: Record<string, unknown>): Promise<void> {
    try {
      const envelope = buildEnvelope(event)
      await fetch(this.url, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'text/plain' },
      })
    } catch {
      // send must never throw
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _workerClient: WorkerClient | null = null

/**
 * Initialize Centry for a Cloudflare Worker. Call once at module level
 * (outside fetch/scheduled handlers). Use withCentry() instead if you want
 * automatic request context and unhandled error capture.
 *
 * @example
 * import { initWorker } from 'centry-client'
 * initWorker({ project: 'my-project', environment: 'production' })
 */
export function initWorker(config: CentryConfig): WorkerClient {
  _workerClient = new WorkerClient(config)
  return _workerClient
}

/**
 * Capture an exception from a Cloudflare Worker. If withCentry() is being
 * used, the current request is attached automatically. Otherwise pass it
 * explicitly as the second argument.
 * No-op if neither initWorker() nor withCentry() has been called.
 */
export function captureWorkerException(error: unknown, request?: Request): void {
  _workerClient?.captureException(error, request)
}

/**
 * Returns the active worker client, or null if not initialised.
 */
export function getWorkerClient(): WorkerClient | null {
  return _workerClient
}

// ── withCentry ────────────────────────────────────────────────────────────────

type WorkerHandler = ExportedHandler<Record<string, unknown>>

/**
 * Wraps a Cloudflare Worker export with Centry instrumentation. Initialises
 * the client, stores the incoming Request in AsyncLocalStorage for the
 * duration of each fetch invocation (so captureWorkerException picks it up
 * automatically), and catches any unhandled exceptions that bubble up.
 *
 * @example
 * import { withCentry } from 'centry-client'
 *
 * export default withCentry(
 *   { project: 'my-project', environment: 'production' },
 *   {
 *     fetch: app.fetch,
 *     async scheduled(event, env, ctx) { ... },
 *   }
 * )
 */
export function withCentry(config: CentryConfig, handler: WorkerHandler): WorkerHandler {
  const client = initWorker(config)
  const als = getAls()

  const wrapped: WorkerHandler = {}

  if (handler.fetch) {
    const originalFetch = handler.fetch
    wrapped.fetch = async (request: Request, env: unknown, ctx: ExecutionContext) => {
      const run = () =>
        Promise.resolve(
          (originalFetch as (req: Request, env: unknown, ctx: ExecutionContext) => Response | Promise<Response>)(
            request, env, ctx,
          ),
        ).catch((err: unknown) => {
          client.captureUnhandled(err, request)
          throw err
        })

      return als ? als.run(request, run) : run()
    }
  }

  if (handler.scheduled) {
    const originalScheduled = handler.scheduled
    wrapped.scheduled = async (event: ScheduledController, env: unknown, ctx: ExecutionContext) => {
      try {
        await (originalScheduled as (e: ScheduledController, env: unknown, ctx: ExecutionContext) => Promise<void>)(
          event, env, ctx,
        )
      } catch (err) {
        client.captureUnhandled(err)
        throw err
      }
    }
  }

  return wrapped
}
