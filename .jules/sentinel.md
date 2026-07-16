Keep URL scrubbing narrowly scoped. Redact sensitive query parameters with `scrubUrl`, and scrub the `referer` header through the same helper before capture. Do not propose broad fragment/hash scrubbing unless the fragment is explicitly parsed as query-style auth data; plain SPA/hash routes are useful debugging context and should be preserved.

## 2025-05-14 - URL Scrubbing Readability and Completeness
**Vulnerability:** URL scrubbing utility was missing Basic Auth credentials (username/password) and had a limited set of sensitive query parameter keys. It also produced URL-encoded filter strings (`%5Bfiltered%5D`) which reduced readability.
**Learning:** SDKs capturing URLs must account for all parts of the URL spec where secrets can hide, not just query parameters.
**Prevention:** Use the built-in `URL` object properties (`username`, `password`) specifically for scrubbing credentials. Ensure the filter string is consistently applied and optionally un-encoded if it's meant for human-readable contexts like breadcrumbs, provided the un-encoding doesn't break the transport or downstream parsing.
