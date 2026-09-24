import { describe, it, expect } from 'vitest'
import { scrubUrl, sensitiveKeys } from './utils'

describe('scrubUrl', () => {
  it('returns empty string for null, undefined, or empty input', () => {
    expect(scrubUrl(null)).toBe('')
    expect(scrubUrl(undefined)).toBe('')
    expect(scrubUrl('')).toBe('')
  })

  it('redacts sensitive query parameters with literal [filtered]', () => {
    const input = 'https://example.com/api?token=secret123&user=john&api_key=key456'
    expect(scrubUrl(input)).toBe('https://example.com/api?token=[filtered]&user=john&api_key=[filtered]')
  })

  it('redacts expanded sensitive keys such as jwt, access_token, and signature', () => {
    const input = 'https://example.com/auth?jwt=eyJ...&access_token=abc&sig=xyz'
    expect(scrubUrl(input)).toBe('https://example.com/auth?jwt=[filtered]&access_token=[filtered]&sig=[filtered]')
  })

  it('redacts embedded Basic Auth credentials', () => {
    const input = 'https://admin:secretpass@example.com/protected'
    expect(scrubUrl(input)).toBe('https://[filtered]:[filtered]@example.com/protected')
  })

  it('redacts sensitive query parameters in URL fragments/hash while preserving routes', () => {
    // Hash with query parameters
    expect(scrubUrl('https://example.com/#/login?token=abc123')).toBe('https://example.com/#/login?token=[filtered]')

    // Hash with OAuth params
    expect(scrubUrl('https://example.com/#access_token=jwt123&state=xyz')).toBe('https://example.com/#access_token=[filtered]&state=xyz')

    // Plain SPA hash route without sensitive params is preserved
    expect(scrubUrl('https://example.com/#/dashboard/settings')).toBe('https://example.com/#/dashboard/settings')
  })

  it('handles relative URLs and search strings', () => {
    expect(scrubUrl('/path?password=123')).toBe('/path?password=[filtered]')
    expect(scrubUrl('?secret=456')).toBe('?secret=[filtered]')
  })

  it('exports sensitiveKeys array', () => {
    expect(Array.isArray(sensitiveKeys)).toBe(true)
    expect(sensitiveKeys).toContain('token')
    expect(sensitiveKeys).toContain('access_token')
  })
})
