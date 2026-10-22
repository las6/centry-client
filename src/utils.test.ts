import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'

describe('scrubUrl', () => {
  it('handles empty or non-string inputs', () => {
    expect(scrubUrl('')).toBe('')
    expect(scrubUrl(null as unknown as string)).toBe(null)
    expect(scrubUrl(undefined as unknown as string)).toBe(undefined)
  })

  it('scrubs sensitive query parameters from relative URLs', () => {
    const input = '/api/v1/user?token=secret123&page=1&api_key=key456'
    const result = scrubUrl(input)
    expect(result).toBe('/api/v1/user?token=[filtered]&page=1&api_key=[filtered]')
  })

  it('scrubs sensitive query parameters from absolute URLs', () => {
    const input = 'https://example.com/login?password=myPassword&redirect=/home'
    const result = scrubUrl(input)
    expect(result).toBe('https://example.com/login?password=[filtered]&redirect=/home')
  })

  it('scrubs Basic Auth credentials from absolute URLs', () => {
    const input = 'https://user:secretpass@example.com/dashboard'
    const result = scrubUrl(input)
    expect(result).toBe('https://[filtered]:[filtered]@example.com/dashboard')
  })

  it('scrubs query-style hash/fragment URLs', () => {
    const input = 'https://example.com/oauth#access_token=secret_token&token_type=bearer'
    const result = scrubUrl(input)
    expect(result).toBe('https://example.com/oauth#access_token=[filtered]&token_type=bearer')
  })

  it('preserves plain SPA hash routes without query-style parameters', () => {
    const input = 'https://example.com/app/#/settings/profile'
    const result = scrubUrl(input)
    expect(result).toBe('https://example.com/app/#/settings/profile')
  })

  it('ensures [filtered] is not URL-encoded as %5Bfiltered%5D', () => {
    const input = 'https://example.com/api?secret=shhh'
    const result = scrubUrl(input)
    expect(result).not.toContain('%5Bfiltered%5D')
    expect(result).toContain('[filtered]')
  })
})
