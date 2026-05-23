// ── Cloudflare Worker client ──────────────────────────────────────────────────
// A stripped-down Centry client that works in CF Workers (and any non-browser
// JS runtime). No DOM APIs — uses fetch() for delivery, which is available
// globally in CF Workers.

import { parseStack } from './stackParser'
import type { CentryConfig } from './types'
import { envelopeUrl } from './types'

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

  captureException(error: unknown): void {
    void this._capture(error, true)
  }

  /** For use in unhandled rejection / uncaughtException hooks. */
  captureUnhandled(error: unknown): void {
    void this._capture(error, false)
  }

  private async _capture(error: unknown, handled: boolean): Promise<void> {
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
 * Initialize Centry for a Cloudflare Worker. Call once at the top of your
 * worker module (outside the fetch/scheduled handlers).
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
 * Capture an exception from a Cloudflare Worker.
 * No-op if initWorker() has not been called.
 */
export function captureWorkerException(error: unknown): void {
  _workerClient?.captureException(error)
}

/**
 * Returns the active worker client, or null if initWorker() has not been called.
 */
export function getWorkerClient(): WorkerClient | null {
  return _workerClient
}
