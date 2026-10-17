// ── toError ───────────────────────────────────────────────────────────────────
// Coerces any thrown value into an Error (or null for empty values).

export function toError(value: unknown): Error | null {
  if (value instanceof Error) return value
  if (value === null || value === undefined) return null
  const msg =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? String((value as Record<string, unknown>).message || safeStringify(value))
        : String(value)
  const err = new Error(msg)
  err.name =
    typeof value === 'object' && (value as Record<string, unknown>).name
      ? String((value as Record<string, unknown>).name)
      : 'UnknownError'
  return err
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value) ?? String(value) } catch { return '[Unserializable thrown value]' }
}
