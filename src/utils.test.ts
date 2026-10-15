import { describe, expect, it } from 'vitest'
import { scrubUrl, sensitiveKeys } from './utils'

describe('scrubUrl', () => {
  it('handles null, undefined, and empty string', () => {
    expect(scrubUrl(null)).toBe('')
    expect(scrubUrl(undefined)).toBe('')
    expect(scrubUrl('')).toBe('')
  })

  it('preserves clean URLs without sensitive parameters', () => {
    const url = 'https://example.com/api/v1/users?page=1&limit=10'
    expect(scrubUrl(url)).toBe(url)
  })

  it('redacts Basic Auth credentials from absolute URLs', () => {
    const url = 'https://admin:secret123@example.com/dashboard'
    expect(scrubUrl(url)).toBe('https://[filtered]:[filtered]@example.com/dashboard')
  })

  it('redacts sensitive query parameters', () => {
    const url = 'https://example.com/callback?code=oauth_code_123&state=xyz'
    expect(scrubUrl(url)).toBe('https://example.com/callback?code=[filtered]&state=xyz')
  })

  it('redacts JWTs and tokens', () => {
    const url = 'https://example.com/api?jwt=header.payload.signature&access_token=bearer_123'
    expect(scrubUrl(url)).toBe('https://example.com/api?jwt=[filtered]&access_token=[filtered]')
  })

  it('redacts API keys and secrets', () => {
    const url = 'https://example.com/api?api_key=sk_live_12345&sig=abcdef'
    expect(scrubUrl(url)).toBe('https://example.com/api?api_key=[filtered]&sig=[filtered]')
  })

  it('redacts query-style auth parameters in hash fragments', () => {
    const url = 'https://example.com/#/oauth?access_token=secret_token&type=bearer'
    expect(scrubUrl(url)).toBe('https://example.com/#/oauth?access_token=[filtered]&type=bearer')
  })

  it('preserves plain SPA hash routes without sensitive query data', () => {
    const url = 'https://example.com/#/dashboard/settings'
    expect(scrubUrl(url)).toBe(url)
  })

  it('handles relative URLs correctly', () => {
    const relativeUrl = '/api/data?token=secret_abc&category=news'
    expect(scrubUrl(relativeUrl)).toBe('/api/data?token=[filtered]&category=news')
  })

  it('handles standalone search parameter strings', () => {
    const search = '?refresh_token=rt_9999&redirect=home'
    expect(scrubUrl(search)).toBe('?refresh_token=[filtered]&redirect=home')
  })

  it('exports sensitiveKeys list', () => {
    expect(sensitiveKeys).toContain('jwt')
    expect(sensitiveKeys).toContain('access_token')
    expect(sensitiveKeys).toContain('refresh_token')
    expect(sensitiveKeys).toContain('code')
  })
})
