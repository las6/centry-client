# Changelog

## 1.4.0

- Preserve bounded `Error.cause` chains in browser, Node and Worker events.
- Preserve diagnostic URL queries and breadcrumb hosts; shared credential
  filtering now belongs to the ingest server. Self-hosted servers must upgrade
  first. This intentionally changes automatic client-side privacy behavior.
- Add synchronous `beforeSend` (transform/drop) and configurable `host` to all
  targets. Retain the automatic request-header allowlist.
- Apply final payload budgets to every JS target, after `beforeSend`; retain
  primary/root exception details preferentially and record trimming metadata.
- Report Node/Worker transport failures through the existing `onSendError` hook.
- Use UTF-8 byte lengths in envelope item headers.
