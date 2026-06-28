import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrichTopFrameWithContext } from './sourceContext'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('enrichTopFrameWithContext', () => {
  it('adds bounded source context to the newest same-origin in-app frame', async () => {
    const sourceUrl = 'https://example.com/assets/app.js'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'const one = 1;',
      'const two = 2;',
      'throw new Error("kapow");',
      'const four = 4;',
      'const five = 5;',
    ].join('\n'), { status: 200 })))

    const frames = await enrichTopFrameWithContext([
      { filename: sourceUrl, function: 'main', lineno: 4, colno: 3, in_app: true },
      { filename: sourceUrl, function: 'helper', lineno: 3, colno: 7, in_app: true },
    ], 'https://example.com/app')

    expect(frames[1].context_line).toBe('throw new Error("kapow");')
    expect(frames[1].pre_context).toEqual(['const one = 1;', 'const two = 2;'])
    expect(frames[1].post_context).toEqual(['const four = 4;', 'const five = 5;'])
    expect(frames[0].context_line).toBeUndefined()
  })

  it('uses a column window for minified source', async () => {
    const sourceUrl = 'https://example.com/assets/min.js'
    const minified = `const a=1;${'x'.repeat(1500)}ReactDOM.render(App);${'y'.repeat(1500)}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(minified, { status: 200 })))

    const marker = 'ReactDOM.render(App);'
    const colno = minified.indexOf(marker) + 1
    const frames = await enrichTopFrameWithContext([
      { filename: sourceUrl, function: 'render', lineno: 1, colno, in_app: true },
    ], 'https://example.com/app')

    expect(frames[0].context_line).toContain('ReactDOM.render(App);')
    expect(frames[0].context_line?.length).toBeLessThanOrEqual(246)
    expect(frames[0].pre_context).toBeUndefined()
    expect(frames[0].post_context).toBeUndefined()
  })

  it('skips cross-origin frames', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const frames = await enrichTopFrameWithContext([
      { filename: 'https://cdn.example.net/app.js', function: 'render', lineno: 1, colno: 10, in_app: true },
    ], 'https://example.com/app')

    expect(frames[0].context_line).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
