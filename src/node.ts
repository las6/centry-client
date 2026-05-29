// ── Node.js / Serverless client ───────────────────────────────────────────────
// Centry client for Node.js runtimes: Vercel serverless, Next.js API routes
// (Pages and App Router), AWS Lambda, long-running servers, and CLI scripts.
//
// Uses AsyncLocalStorage from node:async_hooks (Node 16.4+, available in all
// current Vercel / Lambda runtimes). No DOM APIs.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { CentryConfig } from './types'
import { BaseServerClient } from './_shared/baseServerClient'

// ── AsyncLocalStorage ─────────────────────────────────────────────────────────
// Module-level ALS instance. Stores the current request object (Web Request or
// IncomingMessage-style) so captureException() can attach it automatically
// without the caller needing to pass it explicitly.

const _als = new AsyncLocalStorage<unknown>()

// ── NodeClient ────────────────────────────────────────────────────────────────

export class NodeClient extends BaseServerClient {
  constructor(config: CentryConfig) {
    super(config)
  }

  protected getStore(): unknown {
    return _als.getStore()
  }

  protected get runtimeContext(): Record<string, unknown> {
    return { name: 'node', version: process.version }
  }
}

// ── Global handlers ───────────────────────────────────────────────────────────

/**
 * Attaches process-level handlers for uncaught exceptions and unhandled promise
 * rejections. Called automatically by initNode(). Returns a cleanup function
 * that removes the handlers (useful in tests or short-lived processes).
 */
export function installNodeGlobalHandlers(client: NodeClient): () => void {
  const onUncaughtException = (error: Error) => {
    client.captureUnhandled(error)
  }
  const onUnhandledRejection = (reason: unknown) => {
    client.captureUnhandled(reason)
  }

  process.on('uncaughtException', onUncaughtException)
  process.on('unhandledRejection', onUnhandledRejection)

  return () => {
    process.off('uncaughtException', onUncaughtException)
    process.off('unhandledRejection', onUnhandledRejection)
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _nodeClient: NodeClient | null = null
let _removeGlobalHandlers: (() => void) | null = null

/**
 * Initialize Centry for a Node.js environment. Call once at process startup.
 * Installs global handlers for uncaughtException and unhandledRejection.
 * Safe to call multiple times — re-initialisation replaces the client and
 * re-attaches handlers.
 *
 * @example
 * // Long-running server / CLI
 * import { initNode } from 'centry-client/node'
 * initNode({ project: 'my-project', environment: 'production' })
 */
export function initNode(config: CentryConfig): NodeClient {
  // Clean up previous handlers if re-initialising
  _removeGlobalHandlers?.()

  _nodeClient = new NodeClient(config)
  _removeGlobalHandlers = installNodeGlobalHandlers(_nodeClient)
  return _nodeClient
}

/**
 * Capture an exception from Node.js. Attaches request context automatically
 * if called inside a withCentry()-wrapped handler.
 * No-op if initNode() has not been called.
 */
export function captureException(error: unknown): void {
  _nodeClient?.captureException(error)
}

/**
 * Capture a plain message from Node.js.
 * No-op if initNode() has not been called.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  _nodeClient?.captureMessage(message, level)
}

/**
 * Returns the active Node client, or null if initNode() has not been called.
 */
export function getNodeClient(): NodeClient | null {
  return _nodeClient
}

// ── withCentry ────────────────────────────────────────────────────────────────

/**
 * Wraps any async handler with Centry instrumentation. Initialises the client
 * (or reuses the existing singleton), stores the first argument in
 * AsyncLocalStorage if it looks like a request object, captures any unhandled
 * errors, and awaits flush() before returning — critical for serverless
 * environments where the process may exit immediately after the handler returns.
 *
 * Works with all Node.js handler patterns:
 *
 * @example
 * // Vercel old-style Node.js serverless (IncomingMessage / ServerResponse)
 * import { withCentry } from 'centry-client/node'
 * export default withCentry({ project: 'las6' }, async (req, res) => { ... })
 *
 * @example
 * // Next.js App Router route handler
 * import { withCentry } from 'centry-client/node'
 * export const GET = withCentry({ project: 'severalgia' }, async (request) => {
 *   return Response.json({ ... })
 * })
 *
 * @example
 * // No-arg handler
 * export const GET = withCentry({ project: 'severalgia' }, async () => {
 *   return Response.json({ ... })
 * })
 */
export function withCentry<TArgs extends unknown[], TReturn>(
  config: CentryConfig,
  handler: (...args: TArgs) => TReturn | Promise<TReturn>,
): (...args: TArgs) => Promise<Awaited<TReturn>> {
  // initNode is idempotent — if already initialised with the same config the
  // singleton is reused; re-calling replaces it (fine for cold starts).
  const client = initNode(config)

  return async (...args: TArgs): Promise<Awaited<TReturn>> => {
    const maybeRequest = args[0]

    const run = async (): Promise<Awaited<TReturn>> => {
      try {
        return (await handler(...args)) as Awaited<TReturn>
      } catch (err) {
        client.captureUnhandled(err)
        throw err
      } finally {
        // Always flush before returning — prevents event loss on Lambda / Vercel
        await client.flush()
      }
    }

    // If the first arg looks like a request object (has url/method/headers),
    // run inside an ALS context so captureException() can attach it automatically.
    if (maybeRequest && typeof maybeRequest === 'object') {
      return _als.run(maybeRequest, run)
    }

    return run()
  }
}
