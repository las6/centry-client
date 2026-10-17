import { describe, it, expect } from 'vitest'
import { scrubUrl } from './utils'

describe('scrubUrl privacy and fidelity', () => {
  it.each([
    [null, ''], [undefined, ''], ['', ''],
    ['https://user:secret@example.com/a', 'https://%5Bfiltered%5D@example.com/a'],
    ['//user:secret@example.com/a', '//%5Bfiltered%5D@example.com/a'],
    ['https://user@example.com/a', 'https://%5Bfiltered%5D@example.com/a'],
    ['?token=a&token=b&x=a%20b', '?token=%5Bfiltered%5D&token=%5Bfiltered%5D&x=a%20b'],
    ['../a?api_key=a#section', '../a?api_key=%5Bfiltered%5D#section'],
    ['?JWT=a&sig=b&code=c&key=d', '?JWT=%5Bfiltered%5D&sig=%5Bfiltered%5D&code=%5Bfiltered%5D&key=%5Bfiltered%5D'],
    ['#%74%6f%6b%65%6e=example&state=ok', '#%74%6f%6b%65%6e=%5Bfiltered%5D&state=ok'],
    ['/a?x=1#access_token=example', '/a?x=1#access_token=%5Bfiltered%5D'],
    ['#/login?token=example&tab=a', '#/login?token=%5Bfiltered%5D&tab=a'],
    ['?token=a#refresh_token=b', '?token=%5Bfiltered%5D#refresh_token=%5Bfiltered%5D'],
    ['?%74oken=example&token=two', '?%74oken=%5Bfiltered%5D&token=%5Bfiltered%5D'],
    ['?bad%=ok&token=example', '?bad%=ok&token=%5Bfiltered%5D'],
  ])('redacts %s', (input, expected) => {
    expect(scrubUrl(input)).toBe(expected)
    expect(scrubUrl(scrubUrl(input))).toBe(expected)
  })

  it.each([
    '/a?monkey=banana&postcode=00100&keyboard=us',
    '#/dashboard/settings', '#/code=examples', '#section',
    '/a?name=a%20b&name=c+d&empty=&flag#ordinary',
    '/user@example.com?email=a@b.example',
    'https://example.com/path', '../path',
  ])('preserves non-sensitive URL bytes: %s', input => {
    expect(scrubUrl(input)).toBe(input)
  })
})
