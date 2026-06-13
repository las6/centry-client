interface CentryConfig {
    project: string;
    environment?: string;
    release?: string;
    allowUrls?: RegExp[];
    enabled?: boolean;
    /** Browser only. Defaults to true in init(); set false to skip window-level handlers. */
    globalHandlers?: boolean;
    /** Max errors sent per 60-second window. Defaults to 10. */
    maxEventsPerMinute?: number;
    /** How long (ms) to suppress duplicate errors. Defaults to 10000 (10s). */
    dedupWindowMs?: number;
}

declare abstract class BaseServerClient {
    protected readonly config: CentryConfig;
    protected readonly url: string;
    private readonly rateLimiter;
    private readonly recentErrors;
    private readonly _pending;
    constructor(config: CentryConfig);
    /** Platform-specific: returns the current request from AsyncLocalStorage, or undefined. */
    protected abstract getStore(): unknown;
    /** Platform-specific: value for contexts.runtime (e.g. { name: 'node', version: '...' }). */
    protected abstract get runtimeContext(): Record<string, unknown>;
    /** Capture a manually-caught exception (handled = true). */
    captureException(error: unknown, request?: unknown): void;
    /** Capture an unhandled exception (handled = false). Used by global handlers + withCentry. */
    captureUnhandled(error: unknown, request?: unknown): void;
    /**
     * Capture a plain message (non-exception). Level defaults to 'info'.
     * Useful for logging significant events (deployments, job completions, etc.).
     */
    captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
    /**
     * Await all in-flight sends, with a timeout. Call this before a serverless
     * function returns (Lambda, Vercel) or pass to ctx.waitUntil() in CF Workers.
     */
    flush(timeoutMs?: number): Promise<void>;
    protected _capture(error: unknown, handled: boolean, request?: unknown): Promise<void>;
    private _captureMessage;
    protected _send(event: Record<string, unknown>): void;
}

declare class NodeClient extends BaseServerClient {
    constructor(config: CentryConfig);
    protected getStore(): unknown;
    protected get runtimeContext(): Record<string, unknown>;
}
/**
 * Attaches process-level handlers for uncaught exceptions and unhandled promise
 * rejections. Called automatically by initNode(). Returns a cleanup function
 * that removes the handlers (useful in tests or short-lived processes).
 */
declare function installNodeGlobalHandlers(client: NodeClient): () => void;
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
declare function initNode(config: CentryConfig): NodeClient;
/**
 * Capture an exception from Node.js. Attaches request context automatically
 * if called inside a withCentry()-wrapped handler.
 * No-op if initNode() has not been called.
 */
declare function captureException(error: unknown): void;
/**
 * Capture a plain message from Node.js.
 * No-op if initNode() has not been called.
 */
declare function captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
/**
 * Returns the active Node client, or null if initNode() has not been called.
 */
declare function getNodeClient(): NodeClient | null;
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
declare function withCentry<TArgs extends unknown[], TReturn>(config: CentryConfig, handler: (...args: TArgs) => TReturn | Promise<TReturn>): (...args: TArgs) => Promise<Awaited<TReturn>>;

export { type CentryConfig, NodeClient, captureException, captureMessage, getNodeClient, initNode, installNodeGlobalHandlers, withCentry };
