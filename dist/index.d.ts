import { ReactNode } from 'react';

type SendErrorReason = 'payload_too_large' | 'http_error' | 'network_error' | 'send_failed';
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
    /** Called when an event cannot be sent or must be dropped for transport reasons. */
    onSendError?: (error: Error, payloadSize: number, reason?: SendErrorReason) => void;
}

interface CentryProviderProps extends CentryConfig {
    children: ReactNode;
}
/**
 * Optional React convenience wrapper. Calls init() on mount.
 * Browser global error handlers are installed by init() by default.
 * Prefer calling init() directly in your client entry file if you don't need
 * React lifecycle wiring or are using SSR.
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
    private reportSendError;
    /** Tear down interceptors. Called when the client is replaced. */
    destroy(): void;
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
 * In the browser, this also installs global error handlers by default.
 * Subsequent calls replace the active client (useful for hot-reload in dev).
 *
 * @example
 * // client.tsx / main.tsx
 * import { init } from 'centry-client'
 * init({ project: 'my-project' })
 *
 * // Opt out of automatic window error handlers:
 * init({ project: 'my-project', globalHandlers: false })
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

export { CentryClient, type CentryConfig, CentryProvider, type SendErrorReason, captureException, captureMessage, getClient, init, installGlobalHandlers };
