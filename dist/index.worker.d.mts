interface CentryConfig {
    project: string;
    environment?: string;
    release?: string;
    allowUrls?: RegExp[];
    enabled?: boolean;
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

declare class WorkerClient extends BaseServerClient {
    constructor(config: CentryConfig);
    protected getStore(): unknown;
    protected get runtimeContext(): Record<string, unknown>;
    /**
     * Capture a caught exception. Optionally pass the Request explicitly —
     * if omitted and withCentry() is in use, the request is picked up
     * automatically from AsyncLocalStorage context.
     */
    captureException(error: unknown, request?: Request): void;
    /** For use in unhandled rejection / uncaughtException hooks. */
    captureUnhandled(error: unknown, request?: Request): void;
}
/**
 * Initialize Centry for a Cloudflare Worker. Call once at module level
 * (outside fetch/scheduled handlers). Use withCentry() instead if you want
 * automatic request context and unhandled error capture.
 *
 * @example
 * import { initWorker } from 'centry-client/worker'
 * initWorker({ project: 'my-project', environment: 'production' })
 */
declare function initWorker(config: CentryConfig): WorkerClient;
/**
 * Capture an exception from a Cloudflare Worker. If withCentry() is being
 * used, the current request is attached automatically. Otherwise pass it
 * explicitly as the second argument.
 * No-op if neither initWorker() nor withCentry() has been called.
 */
declare function captureWorkerException(error: unknown, request?: Request): void;
/**
 * Capture a plain message from a Cloudflare Worker.
 * No-op if neither initWorker() nor withCentry() has been called.
 */
declare function captureWorkerMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
/**
 * Returns the active worker client, or null if not initialised.
 */
declare function getWorkerClient(): WorkerClient | null;
type WorkerHandler = ExportedHandler<Record<string, unknown>>;
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
declare function withCentry(config: CentryConfig, handler: WorkerHandler): WorkerHandler;

export { type CentryConfig, WorkerClient, captureWorkerException, captureWorkerMessage, getWorkerClient, initWorker, withCentry };
