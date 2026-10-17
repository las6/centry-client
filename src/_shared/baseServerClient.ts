// ── BaseServerClient ──────────────────────────────────────────────────────────
// Shared base class for WorkerClient and NodeClient. Contains all logic that
// is identical between the two server targets: event capture, dedup, rate
// limiting, send, flush, and captureMessage.
//
// Subclasses supply:
//   - getStore()     — ALS lookup (platform-specific)
//   - runtimeContext — { name, version? } for contexts.runtime

import { buildExceptionValues } from './exceptionValues'
import { prepareBrowserEventForTransport } from './browserEventPayload'
import type { CentryConfig } from '../types'
import { envelopeUrl } from '../types'
import { buildEnvelope } from './envelope'
import { toError } from './toError'
import { RateLimiter } from './rateLimiter'
import { buildRequestContext } from './requestContext'

export abstract class BaseServerClient {
  protected readonly config: CentryConfig
  protected readonly url: string
  private readonly rateLimiter: RateLimiter
  private readonly recentErrors = new Set<string>()
  private readonly _pending = new Set<Promise<void>>()

  constructor(config: CentryConfig) {
    this.config = config
    this.url = envelopeUrl(config.project, config.host)
    this.rateLimiter = new RateLimiter(config.maxEventsPerMinute ?? 10, 60_000)
  }

  /** Platform-specific: returns the current request from AsyncLocalStorage, or undefined. */
  protected abstract getStore(): unknown

  /** Platform-specific: value for contexts.runtime (e.g. { name: 'node', version: '...' }). */
  protected abstract get runtimeContext(): Record<string, unknown>

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Capture a manually-caught exception (handled = true). */
  captureException(error: unknown, request?: unknown): void {
    void this._capture(error, true, request ?? this.getStore())
  }

  /** Capture an unhandled exception (handled = false). Used by global handlers + withCentry. */
  captureUnhandled(error: unknown, request?: unknown): void {
    void this._capture(error, false, request ?? this.getStore())
  }

  /**
   * Capture a plain message (non-exception). Level defaults to 'info'.
   * Useful for logging significant events (deployments, job completions, etc.).
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    void this._captureMessage(message, level)
  }

  /**
   * Await all in-flight sends, with a timeout. Call this before a serverless
   * function returns (Lambda, Vercel) or pass to ctx.waitUntil() in CF Workers.
   */
  async flush(timeoutMs = 2000): Promise<void> {
    await Promise.race([
      Promise.allSettled(this._pending),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  protected async _capture(error: unknown, handled: boolean, request?: unknown): Promise<void> {
    try {
      if (this.config.enabled === false) return

      const err = toError(error)
      if (!err) return

      // Dedup — suppress identical errors within the window
      const dedupKey = `${err.name}:${err.message}:${err.stack?.slice(0, 150) ?? ''}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      const dedupWindow = this.config.dedupWindowMs ?? 10_000
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow)

      // Rate limit
      if (!this.rateLimiter.allow()) return

      const chain = buildExceptionValues(error, handled)

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level: 'error',
        environment: this.config.environment,
        release: this.config.release,
        exception: { values: chain.values },
        ...(chain.truncated ? { debug_meta: { centry: { cause_chain_truncated: true } } } : {}),
        contexts: {
          runtime: this.runtimeContext,
        },
      }

      const reqCtx = buildRequestContext(request)
      if (reqCtx) event['request'] = reqCtx

      this._send(event)
    } catch {
      // Capturing must never throw
    }
  }

  private async _captureMessage(message: string, level: string): Promise<void> {
    try {
      if (this.config.enabled === false) return
      if (!message) return

      // Dedup messages the same way as errors
      const dedupKey = `message:${level}:${message.slice(0, 150)}`
      if (this.recentErrors.has(dedupKey)) return
      this.recentErrors.add(dedupKey)
      const dedupWindow = this.config.dedupWindowMs ?? 10_000
      setTimeout(() => this.recentErrors.delete(dedupKey), dedupWindow)

      if (!this.rateLimiter.allow()) return

      const event: Record<string, unknown> = {
        event_id: crypto.randomUUID().replace(/-/g, ''),
        timestamp: new Date().toISOString(),
        level,
        environment: this.config.environment,
        release: this.config.release,
        message,
        contexts: {
          runtime: this.runtimeContext,
        },
      }

      const reqCtx = buildRequestContext(this.getStore())
      if (reqCtx) event['request'] = reqCtx

      this._send(event)
    } catch {
      // Capturing must never throw
    }
  }

  protected _send(event: Record<string, unknown>): void {
    try {
      const filtered = this.config.beforeSend ? this.config.beforeSend(event) : event
      if (!filtered || typeof filtered !== 'object' || Array.isArray(filtered) || typeof filtered.then === 'function') return
      const prepared = prepareBrowserEventForTransport(filtered)
      if (!prepared.event) {
        this.config.onSendError?.(new Error('Event exceeded transport budget'), prepared.originalSize, 'payload_too_large')
        return
      }
      const envelope = buildEnvelope(prepared.event)
      // Track the promise so flush() can await it
      const p: Promise<void> = fetch(this.url, {
        method: 'POST',
        body: envelope,
        headers: { 'Content-Type': 'text/plain' },
      })
        .then((response) => {
          if (!response.ok) this.config.onSendError?.(new Error(`Ingest responded with HTTP ${response.status}`), prepared.envelopeSize, 'http_error')
        })
        .catch(() => {
          try { this.config.onSendError?.(new Error('Event transport failed'), prepared.envelopeSize, 'network_error') } catch { /* reporting must not throw */ }
        })
        .finally(() => this._pending.delete(p))
      this._pending.add(p)
    } catch {
      // send must never throw
    }
  }
}
