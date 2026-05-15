import { ReactNode } from 'react';

interface CentryConfig {
    dsn: string;
    environment?: string;
    release?: string;
    allowUrls?: RegExp[];
    enabled?: boolean;
}
interface ParsedDsn {
    publicKey: string;
    host: string;
    projectId: string;
    envelopeUrl: string;
}
declare function parseDsn(dsn: string): ParsedDsn;

interface CentryProviderProps extends CentryConfig {
    children: ReactNode;
}
declare function CentryProvider({ children, ...config }: CentryProviderProps): React.ReactElement;

declare class CentryClient {
    private config;
    private dsn;
    private recentErrors;
    constructor(config: CentryConfig);
    /** Capture a manually-caught exception (handled = true). */
    captureException(error: unknown): void;
    /** Internal: capture an unhandled exception (handled = false). Used by globalHandlers. */
    captureUnhandled(error: unknown): void;
    private _capture;
    private send;
}

/**
 * Installs window.onerror and window.onunhandledrejection handlers.
 * Handles cross-handler dedup (same Error object can fire both).
 */
declare function installGlobalHandlers(client: CentryClient): () => void;

export { CentryClient, type CentryConfig, CentryProvider, installGlobalHandlers, parseDsn };
