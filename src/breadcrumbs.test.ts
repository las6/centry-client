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
      expect(navCrumb?.data?.from).toBe('/start?token=%5Bfiltered%5D')
      expect(navCrumb?.data?.to).toBe('/target?api_key=%5Bfiltered%5D')
    })
  })

  describe('console', () => {
    afterEach(() => uninstallBreadcrumbs())

    it('preserves Error name and message instead of serializing to {}', () => {
      const buf = installBreadcrumbs()
      console.error(new Error('boom'))

      const crumb = buf.snapshot().find(c => c.category === 'console' && c.level === 'error')
      expect(crumb?.message).toBe('Error: boom')
    })
  })

  describe('xhr', () => {
    const originalXhr = (globalThis as any).XMLHttpRequest

    class FakeXhr {
      status = 0
      private listeners = new Map<string, Array<() => void>>()
      open(_method: string, _url: string) { /* noop */ }
      send() { /* noop */ }
      addEventListener(type: string, cb: () => void) {
        const list = this.listeners.get(type) ?? []
        list.push(cb)
        this.listeners.set(type, list)
      }
      emit(type: string) {
        for (const cb of this.listeners.get(type) ?? []) cb()
      }
    }

    beforeEach(() => {
      ;(globalThis as any).XMLHttpRequest = FakeXhr
      ;(window as any).XMLHttpRequest = FakeXhr
    })

    afterEach(() => {
      uninstallBreadcrumbs()
      ;(globalThis as any).XMLHttpRequest = originalXhr
      ;(window as any).XMLHttpRequest = originalXhr
    })

    it('records method, scrubbed url, and status on loadend', () => {
      const buf = installBreadcrumbs()
      const xhr = new FakeXhr() as unknown as XMLHttpRequest
      xhr.open('POST', 'https://example.com/api/items?token=secret')
      ;(xhr as any).status = 401
      xhr.send()
      ;(xhr as unknown as FakeXhr).emit('loadend')

      const crumb = buf.snapshot().find(c => c.category === 'xhr')
      expect(crumb?.data).toEqual({ url: '/api/items', method: 'POST', status_code: 401 })
    })

    it('marks network failures (status 0) as error level', () => {
      const buf = installBreadcrumbs()
      const xhr = new FakeXhr() as unknown as XMLHttpRequest
      xhr.open('GET', '/api/health')
      xhr.send()
      ;(xhr as unknown as FakeXhr).emit('loadend')

      const crumb = buf.snapshot().find(c => c.category === 'xhr')
      expect(crumb?.level).toBe('error')
      expect(crumb?.data).toEqual({ url: '/api/health', method: 'GET', status_code: 0 })
    })
  })
})
