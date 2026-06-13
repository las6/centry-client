import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClientForTests } from './core'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
  }
})

describe('CentryProvider', () => {
  beforeEach(() => {
    vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true)
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
  })

  afterEach(() => {
    resetClientForTests()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('does not double-install browser handlers', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const { CentryProvider } = await import('./CentryProvider')

    CentryProvider({ project: 'provider-app', children: null })

    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'error')).toHaveLength(1)
    expect(addEventListenerSpy.mock.calls.filter(([type]) => type === 'unhandledrejection')).toHaveLength(1)
  })
})
