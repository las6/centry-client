import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'

describe('scrubUrl security tests', () => {
  it('should scrub basic auth credentials', () => {
    const url = 'https://user:password123@example.com/path'
    expect(scrubUrl(url)).not.toContain('password123')
    expect(scrubUrl(url)).toContain('[filtered]:[filtered]')
  })

  it('should scrub sensitive data in fragments if they look like query params', () => {
    const url = 'https://example.com/#access_token=secret_token&state=123'
    expect(scrubUrl(url)).toContain('[filtered]')
    expect(scrubUrl(url)).not.toContain('secret_token')
  })

  it('should NOT scrub plain SPA fragments', () => {
    const url = 'https://example.com/#/dashboard/settings'
    expect(scrubUrl(url)).toBe(url)
  })

  it('should scrub multiple sensitive query params and use literal [filtered]', () => {
      const url = 'https://example.com/?api_key=key123&token=abc'
      const scrubbed = scrubUrl(url)
      expect(scrubbed).toContain('api_key=[filtered]')
      expect(scrubbed).toContain('token=[filtered]')
      expect(scrubbed).not.toContain('%5B')
  })

  it('should scrub new sensitive keys', () => {
    const url = 'https://example.com/?sig=mysig&jwt=myjwt'
    const scrubbed = scrubUrl(url)
    expect(scrubbed).toContain('sig=[filtered]')
    expect(scrubbed).toContain('jwt=[filtered]')
  })
})
