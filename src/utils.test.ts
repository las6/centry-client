import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'

describe('scrubUrl', () => {
  it('returns empty string for null, undefined, or empty input', () => {
    expect(scrubUrl(null)).toBe('')
    expect(scrubUrl(undefined)).toBe('')
    expect(scrubUrl('')).toBe('')
  })

  it('leaves URLs without sensitive data unchanged', () => {
    expect(scrubUrl('https://example.com/path?foo=bar')).toBe('https://example.com/path?foo=bar')
    expect(scrubUrl('/relative/path?page=1')).toBe('/relative/path?page=1')
  })

  it('redacts sensitive query parameters with literal [filtered]', () => {
    expect(scrubUrl('https://example.com/?token=secret123&foo=bar')).toBe(
      'https://example.com/?token=[filtered]&foo=bar',
    )
    expect(scrubUrl('?api_key=xyz')).toBe('?api_key=[filtered]')
    expect(scrubUrl('/api/v1?jwt=header.payload.sig')).toBe('/api/v1?jwt=[filtered]')
  })

  it('redacts Basic Auth credentials in absolute URLs', () => {
    expect(scrubUrl('https://user:pass123@example.com/data')).toBe('https://[filtered]:[filtered]@example.com/data')
  })

  it('redacts query-style hash fragments containing sensitive parameters', () => {
    expect(scrubUrl('https://example.com/#access_token=secret_token&type=bearer')).toBe(
      'https://example.com/#access_token=[filtered]&type=bearer',
    )
  })

  it('preserves plain hash routes without sensitive key-value pairs', () => {
    expect(scrubUrl('https://example.com/#section2')).toBe('https://example.com/#section2')
    expect(scrubUrl('/dashboard#/user/profile')).toBe('/dashboard#/user/profile')
  })
})
