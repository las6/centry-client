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

Call `initWorker()` once at module level (outside your `fetch`/`scheduled` handlers). Then use `captureWorkerException()` wherever you catch errors.

```ts
import { initWorker, captureWorkerException } from 'centry-client'

initWorker({ project: 'my-project', environment: 'production' })

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request)
    } catch (err) {
      captureWorkerException(err, request)  // request is optional but recommended
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}
```

Passing the `Request` object as the second argument attaches HTTP context to the event (method, URL, headers), which makes it much easier to reproduce errors.

### Hono / framework integration

For Hono, the best place is the global error handler — this covers all unhandled errors in a single spot without touching individual routes:

```ts
import { initWorker, captureWorkerException } from 'centry-client'

initWorker({ project: 'my-project', environment: 'production' })

app.onError((err, c) => {
  captureWorkerException(err, c.req.raw)
  return c.json({ error: 'Internal server error' }, 500)
})
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
