import { defineConfig } from 'vite'

/**
 * The rig for `scripts/bench-graph-engine.mjs`: a page whose worker runs one workload against both
 * LadybugDB variants. Separate from vite.config.ts because it must NOT pull in the app, and because
 * neither engine file may be bundled: both carry 22 MB of wasm as raw bytes and are served instead.
 */
export default defineConfig({
  logLevel: 'warn',
  build: { outDir: 'bench-out', emptyOutDir: true, rollupOptions: { input: 'scripts/bench/index.html' } },
})
