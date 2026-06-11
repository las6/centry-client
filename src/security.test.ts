import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'
import { buildRequestContext } from './_shared/requestContext'

describe('Security: scrubUrl', () => {
  it('redacts sensitive query parameters', () => {
    const url = 'https://example.com/api?api_key=secret&user=jules'
    expect(scrubUrl(url)).toBe('https://example.com/api?api_key=%5Bfiltered%5D&user=jules')
  })

  it('redacts sensitive fragments (hashes)', () => {
    const url = 'https://example.com/#access_token=secret_token&state=123'
    expect(scrubUrl(url)).toContain('access_token=%5Bfiltered%5D')
  })
})

describe('Security: buildRequestContext', () => {
  it('redacts referer header', () => {
    const req = {
      method: 'GET',
      url: '/api/test',
      headers: {
        'referer': 'https://example.com/login?password=123',
        'user-agent': 'test'
      }
    }
    const ctx = buildRequestContext(req)
    expect(ctx?.headers).toBeDefined()
    const headers = ctx?.headers as Record<string, string>
    expect(headers['referer']).toBe('https://example.com/login?password=%5Bfiltered%5D')
  })
})
