const MAX_EVENT_BYTES = 48 * 1024
const MAX_ENVELOPE_BYTES = 60 * 1024
const MAX_FRAMES = 30
const MAX_BREADCRUMBS = 40
const MAX_BREADCRUMB_BYTES = 8 * 1024
const MAX_STRING_BYTES = 1024
const MAX_URL_BYTES = 1536
const MAX_TAG_VALUE_BYTES = 256
const MAX_OBJECT_DEPTH = 5
const MAX_OBJECT_KEYS = 20
const MAX_ARRAY_ITEMS = 20

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function byteSize(value: string): number {
  return encoder.encode(value).byteLength
}

function truncateString(value: string, maxBytes: number): string {
  if (byteSize(value) <= maxBytes) return value

  const suffix = '...'
  const suffixBytes = byteSize(suffix)
  const targetBytes = Math.max(0, maxBytes - suffixBytes)
  let low = 0
  let high = value.length

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = value.slice(0, mid)
    if (byteSize(candidate) <= targetBytes) low = mid
    else high = mid - 1
  }

  const trimmed = value.slice(0, low)
  return decoder.decode(encoder.encode(trimmed)) + suffix
}

function sanitizeValue(value: unknown, maxBytes: number, depth = 0): unknown {
  if (typeof value === 'string') return truncateString(value, maxBytes)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value

  if (Array.isArray(value)) {
    if (depth >= MAX_OBJECT_DEPTH) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, maxBytes, depth + 1))
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, maxBytes, depth + 1))
  }

  if (typeof value === 'object') {
    if (depth >= MAX_OBJECT_DEPTH) return {}
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
    return Object.fromEntries(entries.map(([key, entry]) => [key, sanitizeValue(entry, maxBytes, depth + 1)]))
  }

  return String(value)
}

function cloneEvent<T>(event: T): T {
  return JSON.parse(JSON.stringify(event)) as T
}

function trimFrames(frames: Array<Record<string, unknown>>, dropped: Set<string>): void {
  if (frames.length > MAX_FRAMES) {
    frames.splice(0, frames.length - MAX_FRAMES)
    dropped.add('frames_head')
  }

  for (const frame of frames) {
    if (typeof frame.filename === 'string') frame.filename = truncateString(frame.filename, MAX_URL_BYTES)
    if (typeof frame.function === 'string') frame.function = truncateString(frame.function, MAX_STRING_BYTES)

    if (typeof frame.context_line === 'string') {
      frame.context_line = truncateString(frame.context_line, 256)
      dropped.add('source_context')
    }

    if (Array.isArray(frame.pre_context)) {
      frame.pre_context = frame.pre_context.slice(-2).map((line) =>
        typeof line === 'string' ? truncateString(line, 256) : line)
      dropped.add('source_context')
    }

    if (Array.isArray(frame.post_context)) {
      frame.post_context = frame.post_context.slice(0, 2).map((line) =>
        typeof line === 'string' ? truncateString(line, 256) : line)
      dropped.add('source_context')
    }
  }
}

function trimBreadcrumbs(event: Record<string, unknown>, dropped: Set<string>): void {
  const breadcrumbs = event.breadcrumbs as { values?: Array<Record<string, unknown>> } | undefined
  if (!breadcrumbs?.values) return

  if (breadcrumbs.values.length > MAX_BREADCRUMBS) {
    breadcrumbs.values = breadcrumbs.values.slice(-MAX_BREADCRUMBS)
    dropped.add('breadcrumbs_tail')
  }

  breadcrumbs.values = breadcrumbs.values.map((crumb) => {
    const next = cloneEvent(crumb)
    if (typeof next.message === 'string') next.message = truncateString(next.message, 256)
    if (next.data && typeof next.data === 'object') next.data = sanitizeValue(next.data, 256)
    if (typeof next.category === 'string') next.category = truncateString(next.category, 128)
    if (typeof next.type === 'string') next.type = truncateString(next.type, 64)
    if (typeof next.level === 'string') next.level = truncateString(next.level, 32)
    return next
  })

  while (breadcrumbs.values.length > 0 && byteSize(JSON.stringify(breadcrumbs.values)) > MAX_BREADCRUMB_BYTES) {
    breadcrumbs.values.shift()
    dropped.add('breadcrumbs_tail')
  }

  if (breadcrumbs.values.length === 0) delete event.breadcrumbs
}

function sanitizeTopLevel(event: Record<string, unknown>, dropped: Set<string>): void {
  if (typeof event.message === 'string') event.message = truncateString(event.message, MAX_STRING_BYTES)
  if (typeof event.release === 'string') event.release = truncateString(event.release, 128)
  if (typeof event.environment === 'string') event.environment = truncateString(event.environment, 64)

  const exceptionValues = (((event.exception as Record<string, unknown> | undefined)?.values) ?? []) as Array<Record<string, unknown>>
  for (const exc of exceptionValues) {
    if (typeof exc.type === 'string') exc.type = truncateString(exc.type, 128)
    if (typeof exc.value === 'string') exc.value = truncateString(exc.value, MAX_STRING_BYTES)

    const stacktrace = exc.stacktrace as Record<string, unknown> | undefined
    const frames = (stacktrace?.frames ?? []) as Array<Record<string, unknown>>
    trimFrames(frames, dropped)
  }

  const tags = event.tags as Record<string, unknown> | undefined
  if (tags) {
    event.tags = Object.fromEntries(
      Object.entries(tags).slice(0, MAX_OBJECT_KEYS).map(([key, value]) => [key, sanitizeValue(value, MAX_TAG_VALUE_BYTES)]),
    )
  }

  if (event.extra) {
    event.extra = sanitizeValue(event.extra, 256)
    dropped.add('extra')
  }

  if (event.user) event.user = sanitizeValue(event.user, 256)
  if (event.request) event.request = sanitizeValue(event.request, 256)
  if (event.contexts) event.contexts = sanitizeValue(event.contexts, 256)
}

function attachTrimMetadata(
  event: Record<string, unknown>,
  dropped: Set<string>,
  originalSize: number,
  finalSize: number,
): void {
  if (dropped.size === 0 && originalSize === finalSize) return

  const debugMeta = (event.debug_meta as Record<string, unknown> | undefined) ?? {}
  const centry = (debugMeta.centry as Record<string, unknown> | undefined) ?? {}
  centry.payload_trimmed = true
  centry.dropped = [...dropped]
  centry.original_size = originalSize
  centry.final_size = finalSize
  debugMeta.centry = centry
  event.debug_meta = debugMeta
}

function shrinkForBudget(event: Record<string, unknown>, dropped: Set<string>): void {
  const breadcrumbs = event.breadcrumbs as { values?: Array<Record<string, unknown>> } | undefined
  if (breadcrumbs?.values?.length) {
    breadcrumbs.values = breadcrumbs.values.slice(-10)
    dropped.add('breadcrumbs_tail')
  }

  const exceptionValues = (((event.exception as Record<string, unknown> | undefined)?.values) ?? []) as Array<Record<string, unknown>>
  for (const exc of exceptionValues) {
    const stacktrace = exc.stacktrace as Record<string, unknown> | undefined
    const frames = (stacktrace?.frames ?? []) as Array<Record<string, unknown>>
    if (frames.length > 15) {
      frames.splice(0, frames.length - 15)
      dropped.add('frames_head')
    }
    for (const frame of frames) {
      delete frame.context_line
      delete frame.pre_context
      delete frame.post_context
    }
  }

  delete event.extra
  delete event.user
  delete event.request
}

export function prepareBrowserEventForTransport(event: Record<string, unknown>): ({
  event: Record<string, unknown>
  eventSize: number
  envelopeSize: number
  dropped: string[]
  originalSize: number
} | {
  event: null
  eventSize: number
  envelopeSize: number
  dropped: string[]
  originalSize: number
}) {
  const originalJson = JSON.stringify(event)
  const originalSize = byteSize(originalJson)
  const next = cloneEvent(event)
  const dropped = new Set<string>()

  sanitizeTopLevel(next, dropped)
  trimBreadcrumbs(next, dropped)

  let eventJson = JSON.stringify(next)
  if (byteSize(eventJson) > MAX_EVENT_BYTES) {
    shrinkForBudget(next, dropped)
    eventJson = JSON.stringify(next)
  }

  attachTrimMetadata(next, dropped, originalSize, byteSize(eventJson))
  eventJson = JSON.stringify(next)

  if (byteSize(eventJson) > MAX_EVENT_BYTES) {
    return { event: null, eventSize: byteSize(eventJson), envelopeSize: 0, dropped: [...dropped], originalSize }
  }

  const header = JSON.stringify({ sent_at: new Date().toISOString() })
  const itemHeader = JSON.stringify({ type: 'event', length: eventJson.length })
  const envelopeSize = byteSize(`${header}\n${itemHeader}\n${eventJson}\n`)

  if (envelopeSize > MAX_ENVELOPE_BYTES) {
    return { event: null, eventSize: byteSize(eventJson), envelopeSize, dropped: [...dropped], originalSize }
  }

  return {
    event: next,
    eventSize: byteSize(eventJson),
    envelopeSize,
    dropped: [...dropped],
    originalSize,
  }
}
