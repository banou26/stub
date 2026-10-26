import { resolve } from 'path'
import { defineConfig } from 'vite-plus'

/**
 * The api.stub.banou.dev Worker (api/), as one module wrangler deploys (api/wrangler.jsonc `main`). Built here rather
 * than by wrangler, since the offline history it reads is a set of shards named by `import.meta.glob`
 * (src/sources/offline/history-shards.ts), which only vite resolves.
 */
export default defineConfig({
  publicDir: false,
  build: {
    target: 'esnext',
    outDir: resolve(__dirname, 'api/build'),
    emptyOutDir: true,
    minify: true,
    lib: { entry: resolve(__dirname, 'api/src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
