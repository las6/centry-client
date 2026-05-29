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
    /**
     * Capture a plain message (non-exception). Level defaults to 'info'.
     *
     * @example
     * import { captureMessage } from 'centry-client'
     * captureMessage('Payment processed', 'info')
     */
    captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
    private _capture;
    private _captureMessage;
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
 * Capture a plain message. Level defaults to 'info'.
 * No-op if init() has not been called.
 *
 * @example
 * import { captureMessage } from 'centry-client'
 * captureMessage('Checkout completed', 'info')
 */
declare function captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
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

export { CentryClient, type CentryConfig, CentryProvider, captureException, captureMessage, getClient, init, installGlobalHandlers };
