## 2025-05-15 - [Security] Scrubbing Sensitive Data in Fragments and Referer Headers
**Vulnerability:** Sensitive parameters (tokens, API keys) were being redacted from URL query strings but remained exposed in URL fragments (hashes) and the `Referer` HTTP header.
**Learning:** Standard URL parsing often treats fragments separately from query parameters, leading to "blind spots" in scrubbing logic. Telemetry SDKs are particularly prone to leaking sensitive data via the `Referer` header if it's not explicitly sanitized.
**Prevention:** Always apply scrubbing logic to both `searchParams` and `hash` in URLs. Ensure that any extracted URL-like headers (like `Referer`) are passed through the sanitizer before being included in event payloads.
