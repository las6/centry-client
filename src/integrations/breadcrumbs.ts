// ── Breadcrumb capture ────────────────────────────────────────────────────────
// Intercepts console calls, navigation events, and fetch requests to build a
// ring-buffer of breadcrumbs. The buffer is snapshotted into each captured
// event so the trail of activity leading up to the error is preserved.

import { scrubUrl } from '../utils'

export interface Breadcrumb {
  timestamp: string
  type: string
  category: string
  level?: string
  message?: string
  data?: Record<string, unknown>
}

const MAX_BREADCRUMBS = 100

// ── Ring buffer ───────────────────────────────────────────────────────────────

export class BreadcrumbBuffer {
  private _buf: Breadcrumb[] = []

  add(crumb: Breadcrumb): void {
    this._buf.push(crumb)
    if (this._buf.length > MAX_BREADCRUMBS) {
      this._buf.shift()
    }
  }

  snapshot(): Breadcrumb[] {
    return [...this._buf]
  }

  clear(): void {
    this._buf = []
  }
}

// ── Module-level state ────────────────────────────────────────────────────────

let _buffer: BreadcrumbBuffer | null = null
let _cleanupFns: Array<() => void> = []

function now(): string {
  return new Date().toISOString()
}

// ── Console interceptor ───────────────────────────────────────────────────────

type ConsoleLevel = 'debug' | 'info' | 'warning' | 'error'

const CONSOLE_LEVELS: Array<{ method: 'debug' | 'info' | 'warn' | 'error'; level: ConsoleLevel }> = [
  { method: 'debug', level: 'debug' },
  { method: 'info',  level: 'info' },
  { method: 'warn',  level: 'warning' },
  { method: 'error', level: 'error' },
]

function installConsoleInterceptors(buf: BreadcrumbBuffer): () => void {
  const originals: Partial<Record<string, (...args: unknown[]) => void>> = {}

  for (const { method, level } of CONSOLE_LEVELS) {
    const original = console[method].bind(console) as (...args: unknown[]) => void
    originals[method] = original

    // eslint-disable-next-line no-console
    ;(console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      try {
        buf.add({
          timestamp: now(),
          type: 'default',
          category: 'console',
          level,
          message: args
            .map((a) => {
              if (typeof a === 'string') return a
              try { return JSON.stringify(a) } catch { return String(a) }
            })
            .join(' ')
            .slice(0, 256),
        })
      } catch {
        // breadcrumb capture must never throw
      }
      original(...args)
    }
  }

  return () => {
    for (const { method } of CONSOLE_LEVELS) {
      if (originals[method]) {
        ;(console as unknown as Record<string, unknown>)[method] = originals[method]
      }
    }
  }
}

// ── Navigation interceptor ────────────────────────────────────────────────────

function installNavigationInterceptors(buf: BreadcrumbBuffer): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {}

  let currentUrl = window.location.href

  function recordNavigation(to: string) {
    try {
      buf.add({
        timestamp: now(),
        type: 'navigation',
        category: 'navigation',
        data: {
          from: scrubUrl(currentUrl.replace(window.location.origin, '') || '/'),
          to: scrubUrl(to.startsWith('http') ? to.replace(window.location.origin, '') : to),
        },
      })
      currentUrl = window.location.href
    } catch {
      // never throw
    }
  }

  const origPush    = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPush(...args)
    recordNavigation(typeof args[2] === 'string' ? args[2] : window.location.href)
  }

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    origReplace(...args)
    recordNavigation(typeof args[2] === 'string' ? args[2] : window.location.href)
  }

  function onPopState() {
    recordNavigation(window.location.href)
  }

  window.addEventListener('popstate', onPopState)

  return () => {
    history.pushState    = origPush
    history.replaceState = origReplace
    window.removeEventListener('popstate', onPopState)
  }
}

// ── Fetch interceptor ─────────────────────────────────────────────────────────

function installFetchInterceptor(buf: BreadcrumbBuffer): () => void {
  if (typeof window === 'undefined' || !window.fetch) return () => {}

  const originalFetch = window.fetch.bind(window)

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startedAt = now()
    let url = ''
    let method = (init?.method ?? 'GET').toUpperCase()

    try {
      if (typeof input === 'string') {
        url = input
      } else if (input instanceof URL) {
        url = input.toString()
      } else if (input instanceof Request) {
        url = input.url
        method = (input.method ?? method).toUpperCase()
      }
      // Strip origin + query to keep breadcrumbs concise and privacy-safe
      url = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '/'
    } catch {
      url = '(unknown)'
    }

    try {
      const response = await originalFetch(input, init)
      try {
        buf.add({
          timestamp: startedAt,
          type: 'http',
          category: 'fetch',
          data: { url, method, status_code: response.status },
        })
      } catch { /* never throw */ }
      return response
    } catch (err) {
      try {
        buf.add({
          timestamp: startedAt,
          type: 'http',
          category: 'fetch',
          level: 'error',
          data: { url, method, status_code: 0 },
        })
      } catch { /* never throw */ }
      throw err
    }
  }

  return () => {
    window.fetch = originalFetch
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Install all breadcrumb interceptors and return the buffer.
 * Called once by the CentryClient constructor. Safe to call multiple times —
 * existing interceptors are cleaned up before re-installing.
 */
export function installBreadcrumbs(): BreadcrumbBuffer {
  // Clean up any existing interceptors first
  uninstallBreadcrumbs()

  _buffer = new BreadcrumbBuffer()

  _cleanupFns = [
    installConsoleInterceptors(_buffer),
    installNavigationInterceptors(_buffer),
    installFetchInterceptor(_buffer),
  ]

  return _buffer
}

/**
 * Remove all interceptors and discard the buffer.
 */
export function uninstallBreadcrumbs(): void {
  for (const fn of _cleanupFns) {
    try { fn() } catch { /* ignore */ }
  }
  _cleanupFns = []
  _buffer = null
}

/**
 * Get the active buffer, or null if breadcrumbs are not installed.
 */
export function getBreadcrumbBuffer(): BreadcrumbBuffer | null {
  return _buffer
}
