// ── Cloudflare Worker client ──────────────────────────────────────────────────
// Centry client for CF Workers. Extends BaseServerClient — only CF-specific
// concerns live here: lazy AsyncLocalStorage init from globalThis, the CF
// runtime context tag, and the withCentry() ExportedHandler wrapper.

import type { CentryConfig } from './types'
import { BaseServerClient } from './_shared/baseServerClient'

// ── AsyncLocalStorage (CF Workers) ───────────────────────────────────────────
// CF Workers expose AsyncLocalStorage on globalThis. We resolve it lazily so
// the module doesn't hard-fail in environments that lack it.

type ALS = { getStore(): unknown; run<T>(store: unknown, fn: () => T): T }

let _als: ALS | null | undefined = undefined // undefined = not yet resolved

function getAls(): ALS | null {
  if (_als !== undefined) return _als
  try {
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

export class WorkerClient extends BaseServerClient {
  constructor(config: CentryConfig) {
    super(config)
  }

  protected getStore(): unknown {
    return getAls()?.getStore()
  }

  protected get runtimeContext(): Record<string, unknown> {
    return { name: 'cloudflare-worker' }
  }

  /**
   * Capture a caught exception. Optionally pass the Request explicitly —
   * if omitted and withCentry() is in use, the request is picked up
   * automatically from AsyncLocalStorage context.
   */
  override captureException(error: unknown, request?: Request): void {
    super.captureException(error, request)
  }

  /** For use in unhandled rejection / uncaughtException hooks. */
  override captureUnhandled(error: unknown, request?: Request): void {
    super.captureUnhandled(error, request)
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
 * import { initWorker } from 'centry-client/worker'
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
 * Capture a plain message from a Cloudflare Worker.
 * No-op if neither initWorker() nor withCentry() has been called.
 */
export function captureWorkerMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  _workerClient?.captureMessage(message, level)
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
 * automatically), catches any unhandled exceptions that bubble up, and
 * registers ctx.waitUntil(client.flush()) so in-flight events always finish
 * sending after the response is returned.
 *
 * @example
 * import { withCentry } from 'centry-client/worker'
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
          (
            originalFetch as (
              req: Request,
              env: unknown,
              ctx: ExecutionContext,
            ) => Response | Promise<Response>
          )(request, env, ctx),
        ).catch((err: unknown) => {
          client.captureUnhandled(err, request)
          throw err
        })

      const responsePromise = als ? als.run(request, run) : run()
      ctx.waitUntil(responsePromise.then(() => client.flush(), () => client.flush()))
      return responsePromise
    }
  }

  if (handler.scheduled) {
    const originalScheduled = handler.scheduled
    wrapped.scheduled = async (
      event: ScheduledController,
      env: unknown,
      ctx: ExecutionContext,
    ) => {
      try {
        await (
          originalScheduled as (
            e: ScheduledController,
            env: unknown,
            ctx: ExecutionContext,
          ) => Promise<void>
        )(event, env, ctx)
      } catch (err) {
        client.captureUnhandled(err)
        throw err
      } finally {
        ctx.waitUntil(client.flush())
      }
    }
  }

  return wrapped
}
