// ── Core types ────────────────────────────────────────────────────────────────

export interface CentryConfig {
  dsn: string
  environment?: string
  release?: string
  allowUrls?: RegExp[]
  enabled?: boolean
}

export interface ParsedDsn {
  publicKey: string
  host: string
  projectId: string
  envelopeUrl: string
}

export function parseDsn(dsn: string): ParsedDsn {
  // Format: https://PUBLIC_KEY@host/PROJECT_ID
  const url = new URL(dsn)
  const publicKey = url.username
  const host = url.origin.replace(`//${publicKey}@`, '//')
  // Reconstruct origin without credentials
  const cleanOrigin = `${url.protocol}//${url.host}`
  const projectId = url.pathname.slice(1) // strip leading /
  const envelopeUrl = `${cleanOrigin}/api/${projectId}/envelope/`
  return { publicKey, host: cleanOrigin, projectId, envelopeUrl }
}
