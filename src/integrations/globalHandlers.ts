import type { CentryClient } from '../core'

/**
 * Installs window.onerror and window.onunhandledrejection handlers.
 * Handles cross-handler dedup (same Error object can fire both).
 */
export function installGlobalHandlers(client: CentryClient): () => void {
  if (typeof window === 'undefined') return () => {/* no-op in SSR */}

  const seen = new WeakSet<Error>()

  const onError = (
    _message: string | Event,
    _source?: string,
    _lineno?: number,
    _colno?: number,
    error?: Error
  ) => {
    if (error && !seen.has(error)) {
      seen.add(error)
      client.captureUnhandled(error)
    }
    return false // don't suppress default browser behaviour
  }

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason
    if (error instanceof Error && !seen.has(error)) {
      seen.add(error)
      client.captureUnhandled(error)
    } else if (typeof error === 'string') {
      client.captureUnhandled(new Error(error))
    }
  }

  window.addEventListener('error', (e) => onError(e.message, e.filename, e.lineno, e.colno, e.error))
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return () => {
    window.removeEventListener('error', onError as EventListener)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}
