import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['react'],
  esbuildOptions(options) {
    // CJS builds replace import.meta with {} — env?.MODE safely falls back to
    // 'production', which is correct for non-Vite/Node environments.
    options.logOverride = { 'empty-import-meta': 'silent' }
  },
})
