interface SourceContextFrame {
  filename: string
  function: string
  lineno: number | null
  colno: number | null
  in_app: boolean
  pre_context?: string[]
  context_line?: string
  post_context?: string[]
}

const FETCH_TIMEOUT_MS = 1500
const MAX_CONTEXT_CHARS = 240
const CONTEXT_LINES = 2

const sourceCache = new Map<string, Promise<string | null>>()

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars - 3)}...`
}

function sameOriginUrl(filename: string, pageUrl: string): string | null {
  if (!filename || !pageUrl) return null

  try {
    const page = new URL(pageUrl)
    const url = new URL(filename, page.href)
    if (!/^https?:$/.test(url.protocol)) return null
    if (url.origin !== page.origin) return null
    return url.toString()
  } catch {
    return null
  }
}

async function fetchSourceText(url: string): Promise<string | null> {
  const cached = sourceCache.get(url)
  if (cached) return cached

  const request = (async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
      })
      clearTimeout(timeout)
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  })()

  sourceCache.set(url, request)
  return request
}

function extractNormalContext(lines: string[], lineno: number): Pick<SourceContextFrame, 'pre_context' | 'context_line' | 'post_context'> | null {
  const index = lineno - 1
  const line = lines[index]
  if (line == null) return null

  return {
    pre_context: lines
      .slice(Math.max(0, index - CONTEXT_LINES), index)
      .map((entry) => truncateText(entry, MAX_CONTEXT_CHARS)),
    context_line: truncateText(line, MAX_CONTEXT_CHARS),
    post_context: lines
      .slice(index + 1, index + 1 + CONTEXT_LINES)
      .map((entry) => truncateText(entry, MAX_CONTEXT_CHARS)),
  }
}

function extractMinifiedContext(line: string, colno: number | null): Pick<SourceContextFrame, 'context_line'> {
  const center = Math.max(0, (colno ?? 1) - 1)
  const halfWindow = Math.floor(MAX_CONTEXT_CHARS / 2)
  const start = Math.max(0, center - halfWindow)
  const end = Math.min(line.length, center + halfWindow)

  return {
    context_line: `${start > 0 ? '...' : ''}${line.slice(start, end)}${end < line.length ? '...' : ''}`,
  }
}

function buildSourceContext(
  sourceText: string,
  frame: SourceContextFrame,
): Pick<SourceContextFrame, 'pre_context' | 'context_line' | 'post_context'> | null {
  if (!frame.lineno) return null

  const lines = sourceText.split('\n')
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0)
  const line = lines[frame.lineno - 1]
  if (line == null) return null

  const looksMinified = (lines.length <= 5 && maxLineLength > 1000) || line.length > 1000
  if (looksMinified) return extractMinifiedContext(line, frame.colno)

  return extractNormalContext(lines, frame.lineno)
}

export async function enrichTopFrameWithContext<T extends SourceContextFrame>(frames: T[], pageUrl: string): Promise<T[]> {
  const targetIndex = (() => {
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (frames[i].in_app && sameOriginUrl(frames[i].filename, pageUrl)) return i
    }
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      if (sameOriginUrl(frames[i].filename, pageUrl)) return i
    }
    return -1
  })()

  if (targetIndex === -1) return frames

  const frame = frames[targetIndex]
  const url = sameOriginUrl(frame.filename, pageUrl)
  if (!url) return frames

  const sourceText = await fetchSourceText(url)
  if (!sourceText) return frames

  const sourceContext = buildSourceContext(sourceText, frame)
  if (!sourceContext) return frames

  return frames.map((entry, index) => (
    index === targetIndex
      ? { ...entry, ...sourceContext }
      : entry
  ))
}
