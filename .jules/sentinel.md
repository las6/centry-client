## 2026-05-28 - [PII Leakage in URLs]
**Vulnerability:** Sensitive query parameters (tokens, API keys, session IDs) were being included in captured URLs and request contexts.
**Learning:** Error tracking SDKs must proactively scrub URLs because users often include sensitive data in query strings (e.g., OAuth callbacks, password resets).
**Prevention:** Use a centralized URL scrubbing utility to redact known sensitive parameter keys before sending data to the backend.
