// ── Envelope builder ──────────────────────────────────────────────────────────
// Produces the 3-line Sentry envelope format required by the Centry ingest API:
//   {"sent_at":"<ISO>"}\n
//   {"type":"event","length":<bytes>}\n
//   {<event JSON>}\n

export function buildEnvelope(event: Record<string, unknown>): string {
  const eventJson = JSON.stringify(event)
  const header = JSON.stringify({ sent_at: new Date().toISOString() })
  const itemHeader = JSON.stringify({ type: 'event', length: eventJson.length })
  return `${header}\n${itemHeader}\n${eventJson}\n`
}
