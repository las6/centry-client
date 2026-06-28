// ── Core types ────────────────────────────────────────────────────────────────

const CENTRY_HOST = 'https://centry.pages.dev'

export type SendErrorReason =
  | 'payload_too_large'
  | 'http_error'
  | 'network_error'
  | 'send_failed'

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
  /** Called when an event cannot be sent or must be dropped for transport reasons. */
  onSendError?: (error: Error, payloadSize: number, reason?: SendErrorReason) => void
}

export function envelopeUrl(project: string): string {
  return `${CENTRY_HOST}/api/${project}/envelope/`
}
