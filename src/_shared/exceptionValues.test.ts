import { describe, expect, it } from 'vitest'
import { buildExceptionValues } from './exceptionValues'
import { prepareBrowserEventForTransport } from './browserEventPayload'

describe('cause chains and transport budgets', () => {
  it('retains the primary last and keeps handled semantics', () => {
    const root = new Error('D1_ERROR')
    const outer = new Error('Failed query', { cause: root })
    const chain = buildExceptionValues(outer, false)
    expect(chain.values.map(v => v.value)).toEqual(['D1_ERROR', 'Failed query'])
    expect(chain.values[0].mechanism).toEqual({ type: 'cause', handled: true })
    expect(chain.values[1].mechanism).toEqual({ type: 'onerror', handled: false })
  })
  it('bounds cycles, deep chains, non-Error and throwing causes', () => {
    const cycle = new Error('cycle') as Error & { cause: unknown }; cycle.cause = cycle
    expect(buildExceptionValues(cycle, true).truncated).toBe(true)
    let deep = new Error('root'); for (let i = 0; i < 10; i++) deep = new Error('outer', { cause: deep })
    expect(buildExceptionValues(deep, true).values).toHaveLength(5)
    expect(buildExceptionValues(new Error('outer', { cause: { code: 'FAILED' } }), true).values[0].value).toContain('FAILED')
    const hostile = new Error('outer'); Object.defineProperty(hostile, 'cause', { get() { throw Error('no') } })
    expect(buildExceptionValues(hostile, true).truncated).toBe(true)
  })
  it('fits large Unicode chains in the wire budget while retaining primary and a cause', () => {
    const event = { exception: { values: Array.from({ length: 5 }, (_, i) => ({ type: 'Error', value: `error-${i}`, stacktrace: { frames: Array.from({ length: 30 }, () => ({ filename: 'é'.repeat(1500), function: 'fn'.repeat(1000) })) } })) } }
    const prepared = prepareBrowserEventForTransport(event)
    expect(prepared.event).not.toBeNull()
    expect(prepared.envelopeSize).toBeLessThanOrEqual(60 * 1024)
    if (!prepared.event) throw new Error('Expected a bounded event')
    const values = (prepared.event.exception as typeof event.exception).values
    expect(values.at(-1)?.value).toBe('error-4')
    expect(values[0].value).toBe('error-0')
  })
})
