// ── Security utility: URL scrubbing ──────────────────────────────────────────
// Redacts sensitive query parameters, Basic Auth credentials, and auth fragments.

export const sensitiveKeys = [
  'token',
  'api_key',
  'apikey',
  'auth',
  'password',
  'passwd',
  'secret',
  'session',
  'sid',
  'authorization',
  'credential',
  'sig',
  'signature',
  'key',
  'code',
  'pk',
  'sk',
  'jwt',
  'access_token',
  'refresh_token',
  'id_token',
]

const FILTERED = '[filtered]'

/**
 * Redacts sensitive query parameters, Basic Auth credentials (username/password),
 * and query-style URL fragments (containing '=' or '&') from URLs.
 */
export function scrubUrl(urlStr: string): string {
  if (!urlStr || typeof urlStr !== 'string') return urlStr

  try {
    let scrubbed = urlStr

    // Redact Basic Auth credentials (username & password or username only)
    scrubbed = scrubbed.replace(/:\/\/([^:@\s]+):([^@\s]+)@/g, `://${FILTERED}:${FILTERED}@`)
    scrubbed = scrubbed.replace(/:\/\/([^:@\s]+)@/g, `://${FILTERED}@`)

    // Redact sensitive query parameters and query-style fragments
    for (const key of sensitiveKeys) {
      const regex = new RegExp(`([?&,#]${key}=)[^&#]*`, 'gi')
      scrubbed = scrubbed.replace(regex, `$1${FILTERED}`)
    }

    return scrubbed.replace(/%5Bfiltered%5D/gi, FILTERED)
  } catch {
    return urlStr
  }
}
