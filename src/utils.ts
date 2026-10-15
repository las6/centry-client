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
 * Redacts sensitive query parameters, credentials, and hash auth data from a URL string.
 */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return ''

  try {
    const isSearch = urlStr.startsWith('?')
    // Use a dummy base for relative URLs and search strings
    const url = new URL(urlStr, 'http://dummy.com')

    let hasSensitive = false

    if (url.username || url.password) {
      if (url.username) url.username = '[filtered]'
      if (url.password) url.password = '[filtered]'
      hasSensitive = true
    }

    // Iterate over keys and check if any match our sensitive list
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    if (url.hash && (url.hash.includes('=') || url.hash.includes('&'))) {
      const lowerHash = url.hash.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerHash.includes(sk))) {
        const pattern = new RegExp(
          `([?&#][^=&#]*?(?:${sensitiveKeys.join('|')})[^=&#]*=)[^&#]*`,
          'gi',
        )
        url.hash = url.hash.replace(pattern, '$1[filtered]')
        hasSensitive = true
      }
    }

    if (!hasSensitive) return urlStr

    let result = ''
    if (isSearch) {
      result = '?' + url.searchParams.toString()
    } else {
      result = url.toString()

      // If the original URL was relative, preserve relative path format
      if (!/^https?:\/\//i.test(urlStr)) {
        if (result.startsWith('http://dummy.com/')) {
          const relative = result.substring('http://dummy.com/'.length)
          result = (urlStr.startsWith('/') ? '/' : '') + relative
        }
      }
    }

    return result.replace(/%5Bfiltered%5D/gi, '[filtered]')
  } catch {
    return urlStr
  }
}
