// ── Request context builder ───────────────────────────────────────────────────
// Extracts a safe subset of request metadata for both Web Request (CF Workers,
// Next.js App Router) and IncomingMessage-style objects (Vercel old-style,
// Next.js Pages Router, Express).

import { scrubUrl } from '../utils'

const SAFE_HEADERS = [
  'accept',
  'content-type',
  'user-agent',
  'referer',
  'cf-ray',
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-vercel-id',
  'x-vercel-ip-country',
]

export function buildRequestContext(req: unknown): Record<string, unknown> | null {
  if (!req || typeof req !== 'object') return null

  // Web Request (CF Workers, Next.js App Router, Vercel Edge)
  // Detected by the presence of a Headers.get() method
  if (typeof (req as Request).headers?.get === 'function') {
    const request = req as Request
    const headers: Record<string, string> = {}
    for (const key of SAFE_HEADERS) {
      let val = request.headers.get(key)
      if (key === 'referer' && val) val = scrubUrl(val)
      if (val) headers[key] = val
    }
    return { method: request.method, url: scrubUrl(request.url), headers }
  }

  // IncomingMessage-style (Vercel Node.js, Next.js Pages Router, Express)
  // Detected by the presence of a plain headers object
  const r = req as {
    url?: string
    method?: string
    headers?: Record<string, string | string[] | undefined>
  }
  if (r.headers && typeof r.headers === 'object') {
    const headers: Record<string, string> = {}
    for (const key of SAFE_HEADERS) {
      let val = r.headers[key]
      if (key === 'referer' && typeof val === 'string') val = scrubUrl(val)
      if (typeof val === 'string') headers[key] = val
    }
    // IncomingMessage.url is path-only (e.g. "/api/foo?bar=1"), not a full URL
    return {
      method: r.method,
      url: r.url ? scrubUrl(r.url) : undefined,
      headers,
    }
  }

  return null
}
