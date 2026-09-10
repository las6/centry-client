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

/** Strip origin and query so breadcrumb URLs stay concise and privacy-safe. */
function normalizeBreadcrumbUrl(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '') || '/'
}

/** Serialize a console argument without losing Error details to `{}`. */
function formatConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try { return JSON.stringify(value) } catch { return String(value) }
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
            .map((a) => formatConsoleArg(a))
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
      url = normalizeBreadcrumbUrl(url)
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

// ── XHR interceptor ───────────────────────────────────────────────────────────
// Axios and other libraries default to XMLHttpRequest, which `fetch` wrapping
// does not observe. Record method/url at open() and the status at loadend.

function installXhrInterceptor(buf: BreadcrumbBuffer): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => {}

  const proto = XMLHttpRequest.prototype
  const originalOpen = proto.open as (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) => void
  const originalSend = proto.send as (this: XMLHttpRequest, ...args: unknown[]) => void
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string }>()

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    try {
      meta.set(this, {
        method: String(method).toUpperCase(),
        url: normalizeBreadcrumbUrl(String(url)),
      })
    } catch { /* never throw */ }
    return originalOpen.apply(this, [method, url, ...rest])
  } as typeof proto.open

  proto.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    try {
      const info = meta.get(this) ?? { method: 'GET', url: '(unknown)' }
      this.addEventListener('loadend', () => {
        try {
          const status = this.status
          buf.add({
            timestamp: now(),
            type: 'http',
            category: 'xhr',
            ...(status === 0 ? { level: 'error' } : {}),
            data: { url: info.url, method: info.method, status_code: status },
          })
        } catch { /* never throw */ }
      })
    } catch { /* never throw */ }
    return originalSend.apply(this, args)
  } as typeof proto.send

  return () => {
    proto.open = originalOpen as typeof proto.open
    proto.send = originalSend as typeof proto.send
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
    installXhrInterceptor(_buffer),
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
