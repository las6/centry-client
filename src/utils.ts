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
    const isHash = urlStr.startsWith('#')
    // Use a dummy base for relative URLs, search strings, and hash/fragments
    const url = new URL(urlStr, 'http://dummy.com')

    let hasSensitive = false

    // Check and redact basic auth credentials
    if (url.username) {
      url.username = '[filtered]'
      hasSensitive = true
    }
    if (url.password) {
      url.password = '[filtered]'
      hasSensitive = true
    }

    // Redact sensitive query parameters
    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase()
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        url.searchParams.set(key, '[filtered]')
        hasSensitive = true
      }
    }

    // Check and redact query-style fragments
    const hash = url.hash
    if (hash && (hash.includes('=') || hash.includes('&'))) {
      const hashContent = hash.substring(1)
      const hashParams = new URLSearchParams(hashContent)
      let hashChanged = false
      for (const key of Array.from(hashParams.keys())) {
        const lowerKey = key.toLowerCase()
        if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
          hashParams.set(key, '[filtered]')
          hashChanged = true
          hasSensitive = true
        }
      }
      if (hashChanged) {
        url.hash = '#' + hashParams.toString()
      }
    }

    if (!hasSensitive) return urlStr

    if (isSearch) {
      // Post-process the result to replace URL-encoded brackets '%5Bfiltered%5D' with '[filtered]'
      const searchStr = '?' + url.searchParams.toString()
      return searchStr.replace(/%5Bfiltered%5D/gi, '[filtered]')
    }

    if (isHash) {
      const hashStr = url.hash
      return hashStr.replace(/%5Bfiltered%5D/gi, '[filtered]')
    }

    const result = url.toString()

    // If the original URL was absolute, return the result
    if (/^https?:\/\//i.test(urlStr)) {
      return result.replace(/%5Bfiltered%5D/gi, '[filtered]')
    }

    // If it was a relative URL, try to preserve the relative-ness
    if (result.startsWith('http://dummy.com/')) {
      const relative = result.substring('http://dummy.com/'.length)
      const res = (urlStr.startsWith('/') ? '/' : '') + relative
      return res.replace(/%5Bfiltered%5D/gi, '[filtered]')
    }

    return result.replace(/%5Bfiltered%5D/gi, '[filtered]')
  } catch {
    return urlStr
  }
}
