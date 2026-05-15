// ── Stack parser ──────────────────────────────────────────────────────────────
// Hand-rolled, handles Chrome / Firefox / Safari. No external deps.

export interface ParsedFrame {
  filename: string
  function: string
  lineno: number | null
  colno: number | null
}

// Chrome/Edge: "    at FunctionName (filename:line:col)"
//              "    at filename:line:col"
const CHROME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/

// Firefox/Safari: "functionName@filename:line:col"
//                 "@filename:line:col"
const FIREFOX_RE = /^(?:(.+?)@)?(.+?):(\d+)(?::(\d+))?\s*$/

function parseChromeLine(line: string): ParsedFrame | null {
  const m = CHROME_RE.exec(line)
  if (!m) return null
  return {
    function: m[1] || '<anonymous>',
    filename: m[2],
    lineno: m[3] ? parseInt(m[3], 10) : null,
    colno: m[4] ? parseInt(m[4], 10) : null,
  }
}

function parseFirefoxLine(line: string): ParsedFrame | null {
  const m = FIREFOX_RE.exec(line)
  if (!m) return null
  // Skip lines that look like eval sources "eval:line:col"
  if (m[2] === 'eval') return null
  return {
    function: m[1] || '<anonymous>',
    filename: m[2],
    lineno: m[3] ? parseInt(m[3], 10) : null,
    colno: m[4] ? parseInt(m[4], 10) : null,
  }
}

/**
 * Parse an Error.stack string into frames.
 * Returns frames in oldest→newest order (reversed from V8 output)
 * to match Sentry's expected frame ordering.
 */
export function parseStack(stack: string): ParsedFrame[] {
  const lines = stack.split('\n')
  const frames: ParsedFrame[] = []

  for (const line of lines) {
    if (!line.trim() || line.startsWith('Error')) continue

    const frame = parseChromeLine(line) || parseFirefoxLine(line)
    if (frame) frames.push(frame)
  }

  // V8 gives newest→oldest; Sentry expects oldest→newest
  return frames.reverse()
}
