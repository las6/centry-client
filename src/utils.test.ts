import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'

describe('scrubUrl', () => {
  it('handles empty or undefined URL strings', () => {
    expect(scrubUrl(undefined)).toBe('')
    expect(scrubUrl(null)).toBe('')
    expect(scrubUrl('')).toBe('')
  })

  it('redacts sensitive query parameters with unencoded [filtered]', () => {
    expect(scrubUrl('/path?token=secret')).toBe('/path?token=[filtered]')
    expect(scrubUrl('https://example.com?api_key=xyz&user=jules')).toBe('https://example.com/?api_key=[filtered]&user=jules')
    expect(scrubUrl('?token=abc')).toBe('?token=[filtered]')
  })

  it('redacts basic auth credentials (username and password)', () => {
    expect(scrubUrl('https://user:password@example.com/foo')).toBe('https://[filtered]:[filtered]@example.com/foo')
    expect(scrubUrl('https://user@example.com/')).toBe('https://[filtered]@example.com/')
  })

  it('redacts query-style URL fragments', () => {
    expect(scrubUrl('https://example.com/callback#access_token=foo&token_type=Bearer')).toBe(
      'https://example.com/callback#access_token=[filtered]&token_type=[filtered]'
    )
    expect(scrubUrl('https://example.com/callback#access_token=foo&other_param=value')).toBe(
      'https://example.com/callback#access_token=[filtered]&other_param=value'
    )
    expect(scrubUrl('#id_token=123')).toBe('#id_token=[filtered]')
  })

  it('preserves plain SPA/hash routes without equality or ampersand symbols for debugging', () => {
    expect(scrubUrl('https://example.com/#/home')).toBe('https://example.com/#/home')
    expect(scrubUrl('/path#/dashboard')).toBe('/path#/dashboard')
  })
})
