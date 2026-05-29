import { defineConfig } from 'tsup'

export default defineConfig([
  // ── Browser target ────────────────────────────────────────────────────────
  // import from 'centry-client'
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['react'],
    esbuildOptions(options) {
      // CJS builds replace import.meta with {} — env?.MODE safely falls back to
      // 'production', which is correct for non-Vite/Node environments.
      options.logOverride = { 'empty-import-meta': 'silent' }
    },
  },

  // ── CF Worker target ──────────────────────────────────────────────────────
  // import from 'centry-client/worker'
  {
    entry: { 'index.worker': 'src/index.worker.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    // No 'clean' here — runs after browser build and must not wipe its output
  },

  // ── Node.js / serverless target ───────────────────────────────────────────
  // import from 'centry-client/node'
  {
    entry: { 'index.node': 'src/index.node.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    platform: 'node',
    tsconfig: 'tsconfig.node.json',
    // node:async_hooks is a built-in — mark it external so bundlers don't try
    // to inline it and CJS/ESM consumers both resolve it at runtime.
    external: ['node:async_hooks'],
  },
])
