# centry-client

Lightweight error tracking SDK for [Centry](https://github.com/las6/centry). Supports browser apps and Cloudflare Workers.

## Install

```bash
npm install github:las6/centry-client
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

### React provider (optional)

If you prefer a React component, `CentryProvider` wraps `init()` and installs global handlers on mount:

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

---

## Cloudflare Workers

### `withCentry()` — recommended

Wrap your worker export with `withCentry()` for automatic request context and unhandled error capture. No explicit `initWorker()` call needed — the wrapper initialises the client for you.

```ts
import { withCentry, captureWorkerException } from 'centry-client'

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
import { initWorker, captureWorkerException } from 'centry-client'

initWorker({ project: 'my-project', environment: 'production' })

app.onError((err, c) => {
  captureWorkerException(err, c.req.raw)
  return c.json({ error: 'Internal server error' }, 500)
})
```
```

---

## Configuration

All options apply to both `init()` (browser) and `initWorker()` (CF Worker).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `project` _(required)_ | `string` | — | Project ID from your Centry dashboard |
| `environment` | `string` | `undefined` | e.g. `production`, `staging` |
| `release` | `string` | `undefined` | App version or commit hash |
| `enabled` | `boolean` | `true` | Set to `false` to disable reporting |
| `allowUrls` | `RegExp[]` | — | Only mark frames matching these URLs as in-app (browser only) |
| `maxEventsPerMinute` | `number` | `10` | Hard cap on errors sent per 60-second window |
| `dedupWindowMs` | `number` | `10000` | Suppress duplicate errors for this duration (ms) |
