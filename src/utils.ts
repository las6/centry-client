/**
 * Redacts sensitive query parameters from a URL string.
 */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return ''

  try {
    const isSearch = urlStr.startsWith('?')
    // Use a dummy base for relative URLs and search strings
    const url = new URL(urlStr, 'http://dummy.com')

    let hasSensitive = false
    const sensitiveKeys = [
      'token', 'api_key', 'apikey', 'auth', 'password', 'passwd',
      'secret', 'session', 'sid', 'authorization', 'credential'
    ]

    // Redact sensitive keys in search params
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    // Redact sensitive keys in hash (fragment) if it looks like a query string
    if (url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.substring(1))
      let hashModified = false
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          hashParams.set(key, '[filtered]')
          hashModified = true
          hasSensitive = true
        }
      }
      if (hashModified) {
        url.hash = hashParams.toString()
      }
    }

    if (!hasSensitive) return urlStr

    if (isSearch) {
      return '?' + url.searchParams.toString()
    }

    const result = url.toString()

    // If the original URL was absolute, return the result
    if (/^https?:\/\//i.test(urlStr)) {
      return result
    }

    // If it was a relative URL, try to preserve the relative-ness
    if (result.startsWith('http://dummy.com/')) {
      const relative = result.substring('http://dummy.com/'.length)
      // If original didn't have a leading slash, and dummy-based URL added one,
      // we might want to be careful, but usually these are handled fine.
      return (urlStr.startsWith('/') ? '/' : '') + relative
    }

    return result
  } catch {
    return urlStr
  }
}
