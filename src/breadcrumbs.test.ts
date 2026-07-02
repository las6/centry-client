import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installBreadcrumbs, uninstallBreadcrumbs } from './integrations/breadcrumbs'

describe('Breadcrumbs Integration', () => {
  describe('navigation', () => {
    const origLocation = window.location
    const origHistory = window.history

    beforeEach(() => {
      // Mock window.location
      delete (window as any).location
      window.location = new URL('https://example.com/') as any

      // Mock history.pushState and history.replaceState
      const history = {
        pushState: vi.fn(),
        replaceState: vi.fn(),
      }
      Object.defineProperty(window, 'history', { value: history, configurable: true, writable: true })

      // Mock addEventListener for popstate
      vi.spyOn(window, 'addEventListener')
      vi.spyOn(window, 'removeEventListener')
    })

    afterEach(() => {
      uninstallBreadcrumbs()
      window.location = origLocation
      Object.defineProperty(window, 'history', { value: origHistory, configurable: true, writable: true })
      vi.restoreAllMocks()
    })

    it('redacts sensitive information in navigation breadcrumbs', () => {
      // Set initial URL with sensitive info BEFORE installing breadcrumbs
      window.location = new URL('https://example.com/start?token=secret1') as any

      const buf = installBreadcrumbs()

      // Trigger a pushState with sensitive info
      window.history.pushState({}, '', '/target?api_key=secret2')

      const crumbs = buf.snapshot()
      const navCrumb = crumbs.find(c => c.type === 'navigation')

      expect(navCrumb).toBeDefined()
      // We WANT these to be filtered. Note: URLSearchParams.toString() URL-encodes brackets
      expect(navCrumb?.data?.from).toBe('/start?token=[filtered]')
      expect(navCrumb?.data?.to).toBe('/target?api_key=[filtered]')
    })
  })
})
