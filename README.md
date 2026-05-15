# centry-client

Lightweight browser error tracking SDK for [Centry](https://github.com/las6/centry).

## Install

```bash
npm install github:las6/centry-client
```

## Usage

```tsx
import { CentryProvider } from 'centry-client'

export function App() {
  return (
    <CentryProvider
      dsn="https://your-worker.workers.dev/api/PROJECT_ID/envelope/"
      dsnKey="YOUR_DSN_KEY"
      environment="production"
    >
      {/* your app */}
    </CentryProvider>
  )
}
```

Captures unhandled errors and promise rejections automatically. Use `CentryClient` for manual capture:

```ts
import { CentryClient } from 'centry-client'

const client = new CentryClient({ dsn: '...', dsnKey: '...' })
client.captureException(error)
```
