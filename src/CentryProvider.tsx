import { useEffect, type ReactNode } from 'react'
import { CentryClient } from './core'
import { installGlobalHandlers } from './integrations/globalHandlers'
import { installBrowserApiErrorsIntegration } from './integrations/browserApiErrors'
import type { CentryConfig } from './types'

interface CentryProviderProps extends CentryConfig {
  children: ReactNode
}

export function CentryProvider({ children, ...config }: CentryProviderProps) {
  useEffect(() => {
    const client = new CentryClient(config)
    const cleanupGlobal = installGlobalHandlers(client)
    const cleanupBrowserApi = installBrowserApiErrorsIntegration(client)

    return () => {
      cleanupGlobal()
      cleanupBrowserApi()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.dsn])

  return children as React.ReactElement
}
