import { copyFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite-plus'

import { commitOf, version } from './vite.config'

const OUT = resolve(__dirname, 'functions-lib')
const WORKER_FETCH = resolve(__dirname, 'src/worker/fetch.ts')
const WASM = {
  'frizbee_wasm_bg.wasm': resolve(__dirname, 'node_modules/frizbee/pkg/frizbee_wasm_bg.wasm'),
  'sacha_bg.wasm': resolve(__dirname, 'node_modules/sacha/sacha_bg.wasm'),
}

/**
 * The link preview's half of stub's worker, for functions/_middleware.ts, which the Pages build compiles after this.
 *
 * Emitted as `createPreview()`, which builds every module of it anew on each call, so each request has its own site,
 * graph and asks in flight. A worker's modules keep that state across requests, and a Worker cancels what a request
 * left running once it has answered, so a later request could join work that never ends: seen once on a shared-module
 * build, a title cut at 800 ms that answered nothing in 20 s when asked again, and not seen in 3 later tries
 * (2026-10-23).
 */
export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    // what the source store's inbox names as its writer (src/preview/inbox.ts), the commit at 8 characters as the
    // Offline history job's writer has it (scripts/offline-history.mjs), where the page names 7
    __STUB_VERSION__: JSON.stringify(version),
    __STUB_COMMIT__: JSON.stringify(commitOf(8)),
  },
  publicDir: false,
  // urql's entry names react, as in the app's build
  resolve: { alias: { react: 'preact/compat', 'react-dom': 'preact/compat' } },
  build: {
    target: 'esnext',
    outDir: OUT,
    emptyOutDir: true,
    minify: true,
    lib: { entry: 'src/preview/index.ts', formats: ['iife'], name: 'StubPreview', fileName: () => 'preview.js' },
    rollupOptions: { output: { codeSplitting: false } },
  },
  plugins: [
    {
      // the page's cloud.fetch, which the worker reaches over osra, becomes src/preview/fetch.ts
      name: 'preview-fetch',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!importer || !source.endsWith('/fetch')) return
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
        if (resolved?.id === WORKER_FETCH) return resolve(__dirname, 'src/preview/fetch.ts')
      },
    },
    {
      // the libraries' own `new URL('x.wasm', import.meta.url)` default is never taken here, and would inline the bytes
      name: 'preview-wasm-default',
      enforce: 'pre',
      transform: {
        filter: { id: /\/node_modules\/(frizbee|sacha)\// },
        handler: code => ({ code: code.replace(/new URL\('[^']+\.wasm', import\.meta\.url\)/g, 'undefined'), map: null }),
      },
    },
    {
      name: 'preview-factory',
      apply: 'build',
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const chunk = bundle['preview.js']
          if (chunk?.type !== 'chunk') throw new Error('the preview build emitted no preview.js')
          // An instance serves no page, and anything of it that listens on the Worker's global stays alive with the whole
          // instance: about 18 MB more heap after every preview (measured 2026-10-23). @fkn/lib's file systems listen
          // for `pagehide` through the bare `addEventListener`, and its page channel through `self`, so inside the
          // instance both name nothing. scripts/preview-heap.mjs measures it.
          chunk.code = `export const createPreview = () => {\nconst addEventListener = () => {}, removeEventListener = () => {}, self = undefined\n${chunk.code}\nreturn StubPreview\n}\n`
        },
      },
    },
    {
      name: 'preview-wasm-files',
      closeBundle() {
        mkdirSync(OUT, { recursive: true })
        for (const [name, from] of Object.entries(WASM)) copyFileSync(from, resolve(OUT, name))
      },
    },
  ],
})
