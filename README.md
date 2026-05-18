# centry-client

Lightweight browser error tracking SDK for [Centry](https://github.com/las6/centry).

## Install

```bash
npm install github:las6/centry-client
```

## Quick start

Call `init()` once in your client entry file (before React mounts, or at the top of your main module). Unhandled errors and promise rejections are captured automatically.

```ts
import { init } from 'centry-client'

init({ project: 'my-project' })
```

You can also set an optional `environment` and `release`:

```ts
init({
  project: 'my-project',
  environment: 'production',  // optional — defaults to undefined
  release: '1.2.0',          // optional — defaults to undefined
})
```

## React provider (optional)

If you prefer a React component, `CentryProvider` wraps `init()` and installs global handlers on mount:

```tsx
import { CentryProvider } from 'centry-client'

<CentryProvider project="my-project" environment="production">
  <App />
</CentryProvider>
```

`CentryProvider` accepts the same config as `init()` (all props except `project` are optional).

## Manual capture

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

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `project` _(required)_ | `string` | — | Project ID from your Centry dashboard |
| `environment` | `string` | `undefined` | e.g. `production`, `staging` |
| `release` | `string` | `undefined` | App version or commit hash |
| `enabled` | `boolean` | `true` | Set to `false` to disable reporting |
| `allowUrls` | `RegExp[]` | — | Only mark frames matching these URLs as in-app |
| `maxEventsPerMinute` | `number` | `10` | Hard cap on errors sent per 60-second window |
| `dedupWindowMs` | `number` | `10000` | Suppress duplicate errors for this duration (ms) |
