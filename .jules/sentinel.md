# Sentinel Security Journal

## 2025-05-15 - URL Fragment and Referer Leakage
**Vulnerability:** Sensitive data (like OAuth tokens) in URL fragments (`#`) and full URLs in the `Referer` header were being sent to Centry without scrubbing.
**Learning:** Standard URL query scrubbing often misses fragments. In modern web apps, sensitive tokens are frequently passed in fragments (Implicit Flow).
**Prevention:** Always scrub both `searchParams` and `hash` when handling URLs, and ensure the `Referer` header is scrubbed before being included in telemetry.
