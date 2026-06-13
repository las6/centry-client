import type { CentryClient } from '../core'

const GLOBAL_HANDLERS_STATE = Symbol.for('centry.globalHandlers')

interface GlobalHandlersState {
  initClient: CentryClient | null
  installed: boolean
  manualInstallId: number
  manualClients: Map<number, CentryClient>
  seen: WeakSet<Error>
}

function getState(): GlobalHandlersState {
  if (typeof window === 'undefined') {
    return {
      initClient: null,
      installed: false,
      manualInstallId: 0,
      manualClients: new Map<number, CentryClient>(),
      seen: new WeakSet<Error>(),
    }
  }

  const globalWindow = window as Window & { [GLOBAL_HANDLERS_STATE]?: GlobalHandlersState }
  globalWindow[GLOBAL_HANDLERS_STATE] ??= {
    initClient: null,
    installed: false,
    manualInstallId: 0,
    manualClients: new Map<number, CentryClient>(),
    seen: new WeakSet<Error>(),
  }
  return globalWindow[GLOBAL_HANDLERS_STATE]
}

function getActiveClient(): CentryClient | null {
  const state = getState()
  let latestManualClient: CentryClient | null = null
  for (const client of state.manualClients.values()) latestManualClient = client
  return latestManualClient ?? state.initClient
}

function onError(event: ErrorEvent): void {
  const error = event.error
  const state = getState()
  if (error instanceof Error && !state.seen.has(error)) {
    state.seen.add(error)
    getActiveClient()?.captureUnhandled(error)
  }
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const error = event.reason
  const state = getState()
  if (error instanceof Error && !state.seen.has(error)) {
    state.seen.add(error)
    getActiveClient()?.captureUnhandled(error)
    return
  }

  if (typeof error === 'string') {
    getActiveClient()?.captureUnhandled(new Error(error))
  }
}

function ensureInstalled(): void {
  const state = getState()
  if (typeof window === 'undefined' || state.installed) return
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  state.installed = true
}

function maybeUninstall(): void {
  const state = getState()
  if (typeof window === 'undefined') return
  if (state.initClient || state.manualClients.size > 0 || !state.installed) return
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onUnhandledRejection)
  state.installed = false
}

export function syncGlobalHandlers(client: CentryClient | null): void {
  const state = getState()
  state.initClient = client
  if (client) {
    ensureInstalled()
    return
  }

  maybeUninstall()
}

/**
 * Installs window.onerror and window.onunhandledrejection handlers.
 * Handles cross-handler dedup (same Error object can fire both).
 */
export function installGlobalHandlers(client: CentryClient): () => void {
  if (typeof window === 'undefined') return () => {/* no-op in SSR */}

  const state = getState()
  const installId = ++state.manualInstallId
  state.manualClients.set(installId, client)
  ensureInstalled()

  return () => {
    state.manualClients.delete(installId)
    maybeUninstall()
  }
}
