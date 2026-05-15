import type { CentryClient } from '../core'

type TimerFn = (...args: unknown[]) => unknown

function wrap(client: CentryClient, fn: TimerFn): TimerFn {
  return function (this: unknown, ...args: unknown[]) {
    try {
      return fn.apply(this, args)
    } catch (err) {
      client.captureException(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }
}

/**
 * Patches setTimeout, setInterval, requestAnimationFrame so errors
 * in their callbacks are captured (they don't reach window.onerror
 * in all browsers).
 */
export function installBrowserApiErrorsIntegration(client: CentryClient): () => void {
  const origSetTimeout = window.setTimeout.bind(window)
  const origSetInterval = window.setInterval.bind(window)
  const origRaf = window.requestAnimationFrame.bind(window)

  window.setTimeout = function (fn: TimerFn, delay?: number, ...args: unknown[]) {
    return origSetTimeout(typeof fn === 'function' ? wrap(client, fn) : fn, delay, ...args)
  } as typeof window.setTimeout

  window.setInterval = function (fn: TimerFn, delay?: number, ...args: unknown[]) {
    return origSetInterval(typeof fn === 'function' ? wrap(client, fn) : fn, delay, ...args)
  } as typeof window.setInterval

  window.requestAnimationFrame = function (fn: FrameRequestCallback) {
    return origRaf(wrap(client, fn as TimerFn) as FrameRequestCallback)
  }

  return () => {
    window.setTimeout = origSetTimeout as typeof window.setTimeout
    window.setInterval = origSetInterval as typeof window.setInterval
    window.requestAnimationFrame = origRaf
  }
}
