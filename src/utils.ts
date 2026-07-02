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
      'secret', 'session', 'sid', 'authorization', 'credential',
      'sig', 'signature', 'key', 'code', 'pk', 'sk', 'jwt',
      'access_token', 'refresh_token', 'id_token'
    ]

    const isSensitive = (key: string) => {
      const lowerKey = key.toLowerCase()
      return sensitiveKeys.some(sk => lowerKey.includes(sk))
    }

    // 1. Scrub basic auth
    if (url.username || url.password) {
      if (url.username) url.username = '[filtered]'
      if (url.password) url.password = '[filtered]'
      hasSensitive = true
    }

    // 2. Scrub query params
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitive(key)) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    // 3. Scrub hash if it looks like query params
    if (url.hash.length > 1) {
      const hashContent = url.hash.substring(1)
      if (hashContent.includes('=') && sensitiveKeys.some(sk => hashContent.toLowerCase().includes(sk))) {
        const hashParams = new URLSearchParams(hashContent)
        let hashChanged = false
        for (const key of Array.from(hashParams.keys())) {
          if (isSensitive(key)) {
            hashParams.set(key, '[filtered]')
            hashChanged = true
            hasSensitive = true
          }
        }
        if (hashChanged) {
          url.hash = hashParams.toString()
        }
      }
    }

    if (!hasSensitive) return urlStr

    if (isSearch) {
      return ('?' + url.searchParams.toString()).replace(/%5Bfiltered%5D/g, '[filtered]')
    }

    let result = url.toString()

    // Replace encoded [filtered] with literal
    result = result.replace(/%5Bfiltered%5D/g, '[filtered]')

    // If the original URL was absolute, return the result
    if (/^https?:\/\//i.test(urlStr)) {
      return result
    }

    // If it was a relative URL, try to preserve the relative-ness
    if (result.startsWith('http://dummy.com/')) {
      const relative = result.substring('http://dummy.com/'.length)
      return (urlStr.startsWith('/') ? '/' : '') + relative
    }

    return result
  } catch {
    return urlStr
  }
}
