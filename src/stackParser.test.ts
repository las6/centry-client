import { describe, it, expect } from 'vitest'
import { parseStack } from './stackParser'

describe('parseStack', () => {
  describe('Chrome/Edge format', () => {
    it('parses frame with function name', () => {
      const stack = `Error: something broke
    at handleClick (https://example.com/app.js:42:15)
    at onClick (https://example.com/app.js:10:5)`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(2)
      expect(frames[0]).toMatchObject({ function: 'onClick', filename: 'https://example.com/app.js', lineno: 10, colno: 5 })
      expect(frames[1]).toMatchObject({ function: 'handleClick', filename: 'https://example.com/app.js', lineno: 42, colno: 15 })
    })

    it('parses frame without function name', () => {
      const stack = `Error: test
    at https://example.com/app.js:42:15`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({ function: '<anonymous>', filename: 'https://example.com/app.js', lineno: 42, colno: 15 })
    })

    it('reverses frame order (V8 gives newest first)', () => {
      const stack = `Error: test
    at c (app.js:30:1)
    at b (app.js:20:1)
    at a (app.js:10:1)`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(3)
      expect(frames[0].function).toBe('a')
      expect(frames[1].function).toBe('b')
      expect(frames[2].function).toBe('c')
    })
  })

  describe('Firefox/Safari format', () => {
    it('parses frame with function name', () => {
      const stack = `handleClick@https://example.com/app.js:42:15
onClick@https://example.com/app.js:10:5`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(2)
      expect(frames[1]).toMatchObject({ function: 'handleClick', filename: 'https://example.com/app.js', lineno: 42, colno: 15 })
      expect(frames[0]).toMatchObject({ function: 'onClick', filename: 'https://example.com/app.js', lineno: 10, colno: 5 })
    })

    it('parses frame without function name', () => {
      const stack = '@https://example.com/app.js:42'
      const frames = parseStack(stack)
      expect(frames).toHaveLength(1)
      expect(frames[0]).toMatchObject({ function: '<anonymous>', filename: 'https://example.com/app.js', lineno: 42, colno: null })
    })

    it('skips eval lines', () => {
      const stack = 'handleClick@eval:1:1\n@https://example.com/app.js:42:15'
      const frames = parseStack(stack)
      expect(frames).toHaveLength(1)
      expect(frames[0].filename).toBe('https://example.com/app.js')
    })
  })

  describe('mixed format', () => {
    it('handles both Chrome and Firefox style lines', () => {
      const stack = `Error: test
    at handleClick (https://a.com/a.js:10:5)
otherFunc@https://b.com/b.js:20:3`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(2)
      expect(frames[0].filename).toBe('https://b.com/b.js')
      expect(frames[1].filename).toBe('https://a.com/a.js')
    })
  })

  describe('edge cases', () => {
    it('skips the Error preamble line', () => {
      const stack = `Error: some error
TypeError: another error
    at a (app.js:1:1)`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(1)
      expect(frames[0].function).toBe('a')
    })

    it('handles empty stack', () => {
      expect(parseStack('')).toEqual([])
    })

    it('handles stack with only blank lines', () => {
      expect(parseStack('\n  \n  ')).toEqual([])
    })

    it('ignores completely unrecognized lines', () => {
      const stack = `Error: test
    at a (app.js:1:1)
    some random text
    at b (app.js:5:1)`
      const frames = parseStack(stack)
      expect(frames).toHaveLength(2)
      expect(frames[0].function).toBe('b')
      expect(frames[1].function).toBe('a')
    })

    it('handles Safari WebKit format variations', () => {
      // Safari sometimes uses @filename format with colno
      const stack = 'doWork@https://example.com/main.js:100:25'
      const frames = parseStack(stack)
      expect(frames[0]).toMatchObject({
        function: 'doWork',
        filename: 'https://example.com/main.js',
        lineno: 100,
        colno: 25,
      })
    })

    it('handles local file paths', () => {
      const stack = `    at render (file:///Users/test/src/App.tsx:15:8)`
      const frames = parseStack(stack)
      expect(frames[0]).toMatchObject({
        function: 'render',
        filename: 'file:///Users/test/src/App.tsx',
        lineno: 15,
        colno: 8,
      })
    })
  })
})
