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

    if (url.username || url.password) {
      if (url.username) url.username = '[filtered]'
      if (url.password) url.password = '[filtered]'
      hasSensitive = true
    }

    // We iterate over keys and check if any match our sensitive list
    // searchParams.keys() can contain duplicates, but that's fine for our check
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    if (!hasSensitive) return urlStr

    let result = ''
    if (isSearch) {
      result = '?' + url.searchParams.toString()
    } else {
      result = url.toString()
    }

    // URL.toString() / searchParams.toString() encode [ ] as %5B %5D.
    // We want to keep [filtered] as a literal string for readability in breadcrumbs.
    result = result.replace(/%5Bfiltered%5D/g, '[filtered]')

    if (isSearch) return result

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
