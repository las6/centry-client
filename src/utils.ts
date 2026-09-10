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
 * Redacts sensitive query parameters, basic auth credentials, and query-style fragments from a URL string.
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

    // Handle query-style fragments (e.g. #access_token=xyz&state=123)
    if (url.hash && (url.hash.includes('=') || url.hash.includes('&'))) {
      const hashContent = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const hashParams = new URLSearchParams(hashContent)
      let hashModified = false

      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, '[filtered]')
          hashModified = true
          hasSensitive = true
        }
      }

      if (hashModified) {
        url.hash = '#' + hashParams.toString()
      }
    }

    if (!hasSensitive) return urlStr

    let output = ''
    if (isSearch) {
      output = '?' + url.searchParams.toString()
    } else {
      const result = url.toString()

      // If the original URL was absolute, return the result
      if (/^https?:\/\//i.test(urlStr)) {
        output = result
      } else if (result.startsWith('http://dummy.com/')) {
        // If it was a relative URL, preserve the relative-ness
        const relative = result.substring('http://dummy.com/'.length)
        output = (urlStr.startsWith('/') ? '/' : '') + relative
      } else {
        output = result
      }
    }

    return output.replace(/%5Bfiltered%5D/gi, '[filtered]')
  } catch {
    return urlStr
  }
}
