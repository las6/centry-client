import { parseStack } from '../stackParser'
import { toError } from './toError'

/** Primary last, preserving the existing title and grouping contract. */
export function buildExceptionValues(error: unknown, handled: boolean) {
  const values = []
  const seen = new Set<unknown>()
  let current: unknown = error
  let truncated = false
  while (current != null) {
    if (seen.has(current) || values.length === 5) { truncated = true; break }
    seen.add(current)
    const err = toError(current)
    if (!err) break
    const primary = values.length === 0
    values.unshift({
      type: err.name || 'Error', value: err.message,
      mechanism: { type: primary ? (handled ? 'generic' : 'onerror') : 'cause', handled: primary ? handled : true },
      stacktrace: { frames: err.stack ? parseStack(err.stack) : [] },
    })
    try { current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined }
    catch { truncated = true; break }
  }
  return { values, truncated }
}
