// ── Core types ────────────────────────────────────────────────────────────────

const CENTRY_HOST = 'https://centry.pages.dev'

export interface CentryConfig {
  project: string
  environment?: string
  release?: string
  allowUrls?: RegExp[]
  enabled?: boolean
  /** Browser only. Defaults to true in init(); set false to skip window-level handlers. */
  globalHandlers?: boolean
  /** Max errors sent per 60-second window. Defaults to 10. */
  maxEventsPerMinute?: number
  /** How long (ms) to suppress duplicate errors. Defaults to 10000 (10s). */
  dedupWindowMs?: number
}

export function envelopeUrl(project: string): string {
  return `${CENTRY_HOST}/api/${project}/envelope/`
}
