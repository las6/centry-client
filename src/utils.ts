/**
 * Sensitive query parameter / credential keys to redact.
 */
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

/**
 * Redacts sensitive query parameters, Basic Auth credentials, and fragment query parameters from a URL string.
 */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return ''

  try {
    const isSearch = urlStr.startsWith('?')
    // Use a dummy base for relative URLs and search strings
    const url = new URL(urlStr, 'http://dummy.com')

    let hasSensitive = false

    if (url.username) {
      url.username = '[filtered]'
      hasSensitive = true
    }
    if (url.password) {
      url.password = '[filtered]'
      hasSensitive = true
    }

    // Iterate over search keys and check if any match our sensitive list
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    // Check query-style parameters in fragment/hash if present
    if (url.hash && (url.hash.includes('=') || url.hash.includes('&'))) {
      const hashContent = url.hash.slice(1)
      const qIdx = hashContent.indexOf('?')
      const queryString = qIdx !== -1 ? hashContent.slice(qIdx + 1) : hashContent
      const prefix = qIdx !== -1 ? '#' + hashContent.slice(0, qIdx + 1) : '#'

      const hashParams = new URLSearchParams(queryString)
      let hashModified = false
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, '[filtered]')
          hashModified = true
        }
      }
      if (hashModified) {
        url.hash = prefix + hashParams.toString()
        hasSensitive = true
      }
    }

    if (!hasSensitive) return urlStr

    if (isSearch) {
      return ('?' + url.searchParams.toString()).replaceAll('%5Bfiltered%5D', '[filtered]')
    }

    const result = url.toString().replaceAll('%5Bfiltered%5D', '[filtered]')

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
