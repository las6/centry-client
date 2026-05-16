import { useEffect, type ReactNode } from 'react'
import { init } from './core'
import { installGlobalHandlers } from './integrations/globalHandlers'
import type { CentryConfig } from './types'

interface CentryProviderProps extends CentryConfig {
  children: ReactNode
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
export function CentryProvider({ children, ...config }: CentryProviderProps) {
  useEffect(() => {
    const client = init(config)
    const cleanup = installGlobalHandlers(client)
    return cleanup
  // Only re-init if projectId changes — other config changes are ignored at runtime
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.project])

  return children as React.ReactElement
}
