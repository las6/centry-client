/**
 * Returns a list of sensitive keys used for redaction.
 */
export const sensitiveKeys = [
  'token', 'api_key', 'apikey', 'auth', 'password', 'passwd',
  'secret', 'session', 'sid', 'authorization', 'credential',
  'sig', 'signature', 'key', 'code', 'pk', 'sk', 'jwt',
  'access_token', 'refresh_token', 'id_token'
]

/**
 * Redacts sensitive query parameters, Basic Auth credentials, and query-style
 * URL fragments from a URL string.
 */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return ''

  try {
    const isSearch = urlStr.startsWith('?')
    // Use a dummy base for relative URLs and search strings
    const url = new URL(urlStr, 'http://dummy.com')

    let changed = false

    // 1. Redact Basic Auth
    if (url.username) {
      url.username = '[filtered]'
      changed = true
    }
    if (url.password) {
      url.password = '[filtered]'
      changed = true
    }

    // 2. Redact Search Params
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        changed = true
      }
    }

    // 3. Redact Fragment (Hash) if it looks like query-style auth data
    // e.g. #access_token=... (common in OIDC/OAuth2 implicit flows)
    if (url.hash.includes('=') && url.hash.length > 1) {
      const hashContent = url.hash.substring(1) // remove '#'
      const hashParams = new URLSearchParams(hashContent)
      let hashChanged = false
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, '[filtered]')
          hashChanged = true
        }
      }
      if (hashChanged) {
        url.hash = hashParams.toString()
        changed = true
      }
    }

    if (!changed) return urlStr

    let result: string
    if (isSearch) {
      result = '?' + url.searchParams.toString()
    } else {
      result = url.toString()

      // If it was a relative URL, try to preserve the relative-ness
      if (result.startsWith('http://dummy.com/')) {
        result = (urlStr.startsWith('/') ? '/' : '') + result.substring('http://dummy.com/'.length)
      } else if (result.startsWith('http://dummy.com')) {
        // e.g. result is "http://dummy.com?foo=bar"
        result = result.substring('http://dummy.com'.length)
      }
    }

    // Post-process to ensure [filtered] is not URL-encoded as %5Bfiltered%5D
    return result.replace(/%5Bfiltered%5D/g, '[filtered]')
  } catch {
    return urlStr
  }
}
