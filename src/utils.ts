// Existing long-form matches remain compatible. Short auth keys match exactly,
// so adding `key`/`code` does not erase `monkey` or `postcode` diagnostics.
const sensitiveParts = [
  'token', 'api_key', 'apikey', 'auth', 'password', 'passwd',
  'secret', 'session', 'sid', 'authorization', 'credential',
]
const sensitiveExact = new Set(['jwt', 'sig', 'signature', 'key', 'code', 'pk', 'sk'])

function scrubParams(params: string): string {
  return params.split('&').map(part => {
    const equals = part.indexOf('=')
    if (equals < 0) return part
    // URLSearchParams decodes percent-encoded names and tolerates malformed
    // escapes, without rewriting unrelated names/values or duplicate parameters.
    const key = new URLSearchParams(part.slice(0, equals) + '=').keys().next().value?.toLowerCase() ?? ''
    if (sensitiveExact.has(key) || sensitiveParts.some(name => key.includes(name))) {
      return part.slice(0, equals + 1) + '%5Bfiltered%5D'
    }
    return part
  }).join('&')
}

/** Redact URL auth data while preserving relative paths and plain SPA routes. */
export function scrubUrl(urlStr: string | undefined | null): string {
  if (!urlStr) return ''

  // Replace userinfo only inside an authority, including protocol-relative URLs.
  // Do not interpret @ in paths, queries or fragments as credentials.
  const credentialsScrubbed = urlStr.replace(/^([a-z][a-z\d+.-]*:)?\/\/([^/?#]*@)/i,
    (_match, scheme: string | undefined) => `${scheme ?? ''}//%5Bfiltered%5D@`)
  const hashIndex = credentialsScrubbed.indexOf('#')
  const beforeHash = hashIndex < 0 ? credentialsScrubbed : credentialsScrubbed.slice(0, hashIndex)
  const queryIndex = beforeHash.indexOf('?')
  const base = queryIndex < 0 ? beforeHash : beforeHash.slice(0, queryIndex + 1) + scrubParams(beforeHash.slice(queryIndex + 1))
  if (hashIndex < 0) return base

  const fragment = credentialsScrubbed.slice(hashIndex + 1)
  const fragmentQuery = fragment.indexOf('?')
  if (fragmentQuery >= 0) {
    return base + '#' + fragment.slice(0, fragmentQuery + 1) + scrubParams(fragment.slice(fragmentQuery + 1))
  }
  // OAuth parameter fragments are distinguishable from ordinary route paths.
  if (!fragment.startsWith('/') && fragment.includes('=')) {
    return base + '#' + scrubParams(fragment)
  }
  return base + '#' + fragment
}
