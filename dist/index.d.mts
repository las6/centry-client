import { ReactNode } from 'react';

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

interface CentryProviderProps extends CentryConfig {
    children: ReactNode;
}
/**
 * Optional React convenience wrapper. Calls init() on mount and installs
 * global error handlers. Prefer calling init() directly in your client entry
 * file if you don't need React context or are using SSR.
 *
 * @example
 * // Using init() directly (recommended):
 * import { init } from 'centry-client'
 * init({ project: 'my-project' })
 *
 * // Using the provider (optional React convenience):
 * <CentryProvider project="my-project">
 *   <App />
 * </CentryProvider>
 */
declare function CentryProvider({ children, ...config }: CentryProviderProps): React.ReactElement;

declare class CentryClient {
    private config;
    private url;
    private recentErrors;
    private rateLimiter;
    constructor(config: CentryConfig);
    /** Capture a manually-caught exception (handled = true). */
    captureException(error: unknown): void;
    /** Internal: capture an unhandled exception (handled = false). Used by globalHandlers. */
    captureUnhandled(error: unknown): void;
    private _capture;
    private send;
}
/**
 * Initialize Centry. Call once at application startup, before React mounts.
 * Subsequent calls replace the active client (useful for hot-reload in dev).
 *
 * @example
 * // client.tsx / main.tsx
 * import { init } from 'centry-client'
 * init({ project: 'my-project' })
 */
declare function init(config: CentryConfig): CentryClient;
/**
 * Capture an exception. No-op if init() has not been called.
 *
 * @example
 * import { captureException } from 'centry-client'
 * captureException(error)
 */
declare function captureException(error: unknown): void;
/**
 * Returns the active client, or null if init() has not been called.
 * Prefer captureException() for most use cases.
 */
declare function getClient(): CentryClient | null;

/**
 * Installs window.onerror and window.onunhandledrejection handlers.
 * Handles cross-handler dedup (same Error object can fire both).
 */
declare function installGlobalHandlers(client: CentryClient): () => void;

declare class WorkerClient {
    private config;
    private url;
    private recentErrors;
    private rateLimiter;
    constructor(config: CentryConfig);
    captureException(error: unknown, request?: Request): void;
    /** For use in unhandled rejection / uncaughtException hooks. */
    captureUnhandled(error: unknown, request?: Request): void;
    private _capture;
    private _send;
}
/**
 * Initialize Centry for a Cloudflare Worker. Call once at the top of your
 * worker module (outside the fetch/scheduled handlers).
 *
 * @example
 * import { initWorker } from 'centry-client'
 * initWorker({ project: 'my-project', environment: 'production' })
 */
declare function initWorker(config: CentryConfig): WorkerClient;
/**
 * Capture an exception from a Cloudflare Worker.
 * Pass the `Request` object as the second argument to include HTTP context.
 * No-op if initWorker() has not been called.
 */
declare function captureWorkerException(error: unknown, request?: Request): void;
/**
 * Returns the active worker client, or null if initWorker() has not been called.
 */
declare function getWorkerClient(): WorkerClient | null;

export { CentryClient, type CentryConfig, CentryProvider, WorkerClient, captureException, captureWorkerException, getClient, getWorkerClient, init, initWorker, installGlobalHandlers };
