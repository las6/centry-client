# centry-client

Lightweight error tracking SDK for [Centry](https://github.com/las6/centry). Supports browser apps, Cloudflare Workers, and Node.js (Vercel, Next.js App Router, AWS Lambda).

## Install

```bash
npm install centry-client
```

---

## Browser

Call `init()` once in your client entry file (before React mounts, or at the top of your main module). Unhandled errors and promise rejections are captured automatically.

```ts
import { init } from 'centry-client'

init({ project: 'my-project' })
```

You can also set an optional `environment` and `release`:

```ts
init({
  project: 'my-project',
  environment: 'production',  // optional — defaults to undefined
  release: '1.2.0',          // optional — defaults to undefined
})
```

To opt out of automatic browser handlers, pass `globalHandlers: false`:

```ts
init({
  project: 'my-project',
  globalHandlers: false,
})
```

### React provider (optional)

If you prefer a React component, `CentryProvider` wraps `init()` on mount. Browser global handlers still come from `init()` itself:

```tsx
import { CentryProvider } from 'centry-client'

<CentryProvider project="my-project" environment="production">
  <App />
</CentryProvider>
```

`CentryProvider` accepts the same config as `init()` (all props except `project` are optional).

### Manual capture

For errors caught in try/catch or error boundaries:

```ts
import { captureException } from 'centry-client'

captureException(error)
```

If you need a client instance directly:

```ts
import { CentryClient } from 'centry-client'

const client = new CentryClient({ project: 'my-project' })
client.captureException(error)
```

### Transport reliability

Browser events are trimmed automatically before transport when optional fields would make the payload too large. The SDK keeps the core error data first: exception type/value, stack frames, release/environment, and recent breadcrumbs.

If an event still cannot be sent, use `onSendError` to surface that locally:

```ts
import { init } from 'centry-client'
import type { SendErrorReason } from 'centry-client'

init({
  project: 'my-project',
  onSendError(error, payloadSize, reason: SendErrorReason | undefined) {
    console.warn('Centry send failed', { reason, payloadSize, error })
  },
})
```

---

## Cloudflare Workers

Import from the `centry-client/worker` subpath.

### `withCentry()` — recommended

Wrap your worker export with `withCentry()` for automatic request context and unhandled error capture. No explicit `initWorker()` call needed — the wrapper initialises the client for you.

```ts
import { withCentry, captureWorkerException } from 'centry-client/worker'

export default withCentry(
  { project: 'my-project', environment: 'production' },
  {
    fetch: app.fetch,
    async scheduled(event, env, ctx) { ... },
  }
)
```

Any exception that bubbles up uncaught from `fetch` or `scheduled` is captured automatically. For caught errors, call `captureWorkerException()` as normal — the current request is attached automatically without needing to pass it:

```ts
app.onError((err, c) => {
  captureWorkerException(err)  // request attached automatically via AsyncLocalStorage
  return c.json({ error: 'Internal server error' }, 500)
})
```

### `initWorker()` — manual setup

If you're running Centry alongside another wrapper (e.g. `withSentry()`), use `initWorker()` directly instead. Pass the `Request` explicitly where you have it:

```ts
import { initWorker, captureWorkerException } from 'centry-client/worker'

initWorker({ project: 'my-project', environment: 'production' })

app.onError((err, c) => {
  captureWorkerException(err, c.req.raw)
  return c.json({ error: 'Internal server error' }, 500)
})
```

---

## Node.js / Serverless

Import from the `centry-client/node` subpath. Uses `AsyncLocalStorage` from `node:async_hooks` (Node 16.4+). Works with Vercel, Next.js App Router, AWS Lambda, and long-running servers.

### `withCentry()` — recommended for serverless

Wraps any async handler. Stores the request in `AsyncLocalStorage` so `captureException()` attaches it automatically, and calls `flush()` before returning — critical for short-lived functions.

```ts
// Vercel old-style Node.js (IncomingMessage / ServerResponse)
import { withCentry } from 'centry-client/node'

export default withCentry({ project: 'my-project' }, async (req, res) => {
  // ...
})
```

```ts
// Next.js App Router route handler
import { withCentry } from 'centry-client/node'

export const GET = withCentry({ project: 'my-project' }, async (request: Request) => {
  return Response.json({ ... })
})
```

For errors caught in try/catch, call `captureException()` directly — the current request is attached automatically:

```ts
import { captureException } from 'centry-client/node'

captureException(error)
```

### `initNode()` — long-running servers

For always-on Node.js processes (Express, Fastify, etc.), call `initNode()` once at startup. It installs global `uncaughtException` and `unhandledRejection` handlers automatically.

```ts
import { initNode, captureException } from 'centry-client/node'

initNode({ project: 'my-project', environment: 'production' })
```

---

## Configuration

Most options apply to all three targets (`init()`, `initWorker()`, `initNode()`, and `withCentry()`). `globalHandlers` is browser-only and only affects `init()` / `CentryProvider`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `project` _(required)_ | `string` | — | Project ID from your Centry dashboard |
| `environment` | `string` | `undefined` | e.g. `production`, `staging` |
| `release` | `string` | `undefined` | App version or commit hash |
| `enabled` | `boolean` | `true` | Set to `false` to disable reporting |
| `globalHandlers` | `boolean` | `true` in browser `init()` | Auto-install `window` error and unhandled rejection handlers (browser `init()` only) |
| `allowUrls` | `RegExp[]` | — | Only mark frames matching these URLs as in-app (browser only) |
| `maxEventsPerMinute` | `number` | `10` | Hard cap on errors sent per 60-second window |
| `dedupWindowMs` | `number` | `10000` | Suppress duplicate errors for this duration (ms) |
| `onSendError` | `(error, payloadSize, reason) => void` | `undefined` | Called when the SDK drops an event or transport fails |
