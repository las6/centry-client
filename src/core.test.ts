import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CentryClient, init, captureException, getClient, resetClientForTests } from './core'
import { installGlobalHandlers } from './integrations/globalHandlers'

async function drain() {
  await new Promise((r) => setTimeout(r, 10))
}

async function getCalls(): Promise<{ url: string; body: string }[]> {
  const results: { url: string; body: string }[] = []
  for (const [url, blob] of vi.mocked(navigator.sendBeacon).mock.calls) {
    results.push({ url, body: await (blob as Blob).text() })
  }
  return results
}

async function parseEvent(index: number): Promise<Record<string, unknown>> {
  const calls = await getCalls()
  const lines = calls[index].body.split('\n').filter(Boolean)
  return JSON.parse(lines[2])
}

function setupMocks() {
  vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
  vi.stubGlobal('crypto', {
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
}

describe('CentryClient', () => {
  describe('envelope building', () => {
    beforeEach(() => setupMocks())
    afterEach(() => vi.restoreAllMocks())

    it('sends a correctly formatted envelope via sendBeacon', async () => {
      const client = new CentryClient({ project: 'test-project' })
      client.captureException(new Error('test error'))
      await drain()

      const calls = await getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toContain('/api/test-project/envelope/')

      const event = await parseEvent(0)
      expect(event.exception.values[0].value).toBe('test error')
    })

    it('includes event metadata', async () => {
      const client = new CentryClient({ project: 'test-project' })
      client.captureException(new Error('kapow'))
      await drain()

      const event = await parseEvent(0)
      expect(event.event_id).toBe('11111111222243338444555555555555')
      expect(event.level).toBe('error')
      expect(event.exception.values[0].type).toBe('Error')
      expect(event.exception.values[0].value).toBe('kapow')
      expect(event.exception.values[0].mechanism).toEqual({ type: 'generic', handled: true })
    })

    it('marks unhandled errors correctly', async () => {
      const client = new CentryClient({ project: 'test-project' })
      client.captureUnhandled(new Error('crash'))
      await drain()

      const event = await parseEvent(0)
      expect(event.exception.values[0].mechanism).toEqual({ type: 'onerror', handled: false })
    })

    it('includes browser and OS context', async () => {
      const client = new CentryClient({ project: 'test-project' })
      client.captureException(new Error('x'))
      await drain()

      const event = await parseEvent(0)
      expect(event.contexts.browser).toBeDefined()
      expect(event.contexts.browser.name).toBeTruthy()
      expect(event.contexts.os).toBeDefined()
      expect(event.contexts.os.name).toBeTruthy()
      expect(event.contexts.runtime).toEqual({ name: 'javascript' })
    })

    it('includes environment and release', async () => {
      const client = new CentryClient({ project: 'p', environment: 'staging', release: '1.0.0' })
      client.captureException(new Error('x'))
      await drain()

      const event = await parseEvent(0)
      expect(event.environment).toBe('staging')
      expect(event.release).toBe('1.0.0')
    })
  })

  describe('dedup', () => {
    beforeEach(() => setupMocks())
    afterEach(() => vi.restoreAllMocks())

    it('suppresses duplicate errors within the dedup window', async () => {
      const client = new CentryClient({ project: 'p' })
      const err = new Error('same error')
      client.captureException(err)
      client.captureException(err)
      client.captureException(err)
      await drain()

      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(1)
    })

    it('allows different errors', async () => {
      const client = new CentryClient({ project: 'p' })
      client.captureException(new Error('error A'))
      client.captureException(new Error('error B'))
      await drain()

      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(2)
    })

    it('allows re-send after dedup window expires', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
      setupMocks()

      const client = new CentryClient({ project: 'p', dedupWindowMs: 1000 })
      client.captureException(new Error('periodic error'))
      await vi.advanceTimersByTimeAsync(0)

      // let 1001ms pass, running the dedup clear timeout
      await vi.advanceTimersByTimeAsync(1001)

      client.captureException(new Error('periodic error'))
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(2)
      vi.useRealTimers()
      vi.restoreAllMocks()
    })
  })

  describe('rate limiting', () => {
    it('caps at maxEventsPerMinute', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
      setupMocks()

      const client = new CentryClient({ project: 'p', maxEventsPerMinute: 3 })
      for (let i = 0; i < 10; i++) {
        client.captureException(new Error(`err ${i}`))
      }
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(3)
      vi.useRealTimers()
      vi.restoreAllMocks()
    })
  })

  describe('disabled state', () => {
    beforeEach(() => setupMocks())
    afterEach(() => vi.restoreAllMocks())

    it('sends nothing when enabled is false', async () => {
      const client = new CentryClient({ project: 'p', enabled: false })
      client.captureException(new Error('x'))
      await drain()
      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(0)
    })
  })

  describe('error filtering', () => {
    beforeEach(() => setupMocks())
    afterEach(() => vi.restoreAllMocks())

    it('filters out cross-origin script errors', async () => {
      const client = new CentryClient({ project: 'p' })
      client.captureException(new Error('Script error.'))
      await drain()
      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(0)
    })

    it('filters out null/undefined', async () => {
      const client = new CentryClient({ project: 'p' })
      client.captureException(null)
      client.captureException(undefined)
      await drain()
      expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(0)
    })

    it('scrubs sensitive query parameters from URLs', async () => {
      // Mock location and document.referrer
      const origLocation = window.location
      const origReferrer = document.referrer

      // Use Object.defineProperty because window.location is often read-only in test environments
      delete (window as any).location
      window.location = new URL('https://example.com/page?token=secret&user=jules') as any
      Object.defineProperty(document, 'referrer', { value: 'https://referrer.com/?api_key=123', configurable: true })

      const client = new CentryClient({ project: 'p' })
      client.captureException(new Error('test'))
      await drain()

      const event = await parseEvent(0)
      expect(event.contexts.page.url).toBe('https://example.com/page?token=%5Bfiltered%5D&user=jules')
      expect(event.contexts.page['http.query']).toBe('?token=%5Bfiltered%5D&user=jules')
      expect(event.contexts.page.referer).toBe('https://referrer.com/?api_key=%5Bfiltered%5D')

      // Restore
      window.location = origLocation
      Object.defineProperty(document, 'referrer', { value: origReferrer, configurable: true })
    })
  })
})

describe('module-level singleton', () => {
  beforeEach(() => setupMocks())
  afterEach(() => {
    resetClientForTests()
    vi.restoreAllMocks()
  })

  it('getClient returns null before init', () => {
    expect(getClient()).toBeNull()
  })

  it('captureException is a no-op before init', async () => {
    captureException(new Error('x'))
    await drain()
    expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(0)
  })

  it('init sets the global client', () => {
    init({ project: 'my-app' })
    expect(getClient()).toBeInstanceOf(CentryClient)
  })

  it('captureException sends after init', async () => {
    init({ project: 'my-app' })
    captureException(new Error('test'))
    await drain()
    expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(1)
  })

  it('installs browser global handlers by default', async () => {
    init({ project: 'browser-app' })

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('global crash'), message: 'global crash' }))
    await drain()

    expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(1)
    const event = await parseEvent(0)
    expect(event.exception.values[0].mechanism).toEqual({ type: 'onerror', handled: false })
  })

  it('supports opting out of automatic browser global handlers', async () => {
    init({ project: 'browser-app', globalHandlers: false })

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('ignored crash'), message: 'ignored crash' }))
    await drain()

    expect(vi.mocked(navigator.sendBeacon).mock.calls).toHaveLength(0)
  })

  it('reuses one listener installation across repeated init calls', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    init({ project: 'first-app' })
    init({ project: 'second-app' })

    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'error')).toHaveLength(1)
    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1)

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('reinit crash'), message: 'reinit crash' }))
    await drain()

    const calls = await getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/second-app/envelope/')
  })

  it('reuses one listener installation across module reloads', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

    const firstCore = await import('./core')
    firstCore.init({ project: 'first-app' })

    vi.resetModules()

    const secondCore = await import('./core')
    secondCore.init({ project: 'second-app' })

    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'error')).toHaveLength(1)
    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1)

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('hmr crash'), message: 'hmr crash' }))
    await drain()

    const calls = await getCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/api/second-app/envelope/')

    secondCore.resetClientForTests()
  })

  it('cleans up manual handlers correctly and supports re-install', async () => {
    const cleanup = installGlobalHandlers(new CentryClient({ project: 'manual-app' }))

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('manual crash'), message: 'manual crash' }))
    await drain()

    cleanup()

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after cleanup'), message: 'after cleanup' }))
    await drain()

    init({ project: 'reinit-app' })
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after reinit'), message: 'after reinit' }))
    await drain()

    const calls = await getCalls()
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/api/manual-app/envelope/')
    expect(calls[1].url).toContain('/api/reinit-app/envelope/')
  })
})
