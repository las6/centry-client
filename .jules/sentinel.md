## 2025-05-15 - [Security] Scrubbing Sensitive Data in Referer Headers
**Vulnerability:** Sensitive parameters (tokens, API keys) present in the `Referer` HTTP header were being logged/transmitted, as the header was not passing through the `scrubUrl` sanitizer.
**Learning:** Broadly scrubbing URL fragments (hashes) can strip useful Single Page Application (SPA) route context, which might be an overreach for a lightweight error tracking SDK. However, sanitizing headers known to contain URLs (like `Referer`) is a critical "defense in depth" measure.
**Prevention:** Ensure that any extracted URL-like headers (like `Referer`) are passed through the existing sanitizer before being included in event payloads, while balancing security with the preservation of useful application state.
