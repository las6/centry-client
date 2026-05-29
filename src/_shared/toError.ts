// ── toError ───────────────────────────────────────────────────────────────────
// Coerces any thrown value into an Error (or null for empty values).

export function toError(value: unknown): Error | null {
  if (value instanceof Error) return value
  if (value === null || value === undefined) return null
  const msg =
    typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? String((value as Record<string, unknown>).message || JSON.stringify(value))
        : String(value)
  const err = new Error(msg)
  err.name =
    typeof value === 'object' && (value as Record<string, unknown>).name
      ? String((value as Record<string, unknown>).name)
      : 'UnknownError'
  return err
}
