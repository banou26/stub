import { defineConfig } from 'vite-plus'

import appConfig, { commit } from './vite.config'

/**
 * The npm entry build, run after the app build and written beside it into `build/`.
 *
 * The platform loads an npm app by appending `<script type="module" src="<entry>">` to a sandbox
 * document, and the entry it reads is package.json's `main`. So the package has to ship a module that
 * mounts itself with no html around it, which `vp build` alone does not produce: that build's input
 * is index.html, and its js is reachable only through it. anime.fkn.app serves index.html and is
 * unaffected either way, which is how 0.0.18 came to ship with no entry at all while every check
 * stayed green.
 *
 * The player page, embed.html, is built here and not by the app build: a package frames it too, and
 * this way everything a package ever loads comes from this build alone. package.json's `files` leaves
 * the app build's chunks out, so each language costs a release two files (stub's catalogue and the
 * player's labels) and not four, against the file limit in scripts/check-npm-entry.mjs.
 *
 * Everything except the output shape is the app's, so the two builds cannot drift on aliases,
 * polyfills, `define` or dependency pre-bundling.
 */
export default defineConfig(env => {
  const app = appConfig(env)

  return {
    ...app,
    // RELATIVE, unlike the app build. The sandbox serves the tenant origin's root from the package
    // root and the entry sits at /build/index.js, so an absolute '/assets/x' asks for a path the
    // tarball does not have. With base '/' the worker is emitted as `new Worker("/assets/...")` and
    // 404s there while working perfectly from a server whose root IS build/, which is the shape of
    // check that reports success on a broken package.
    base: './',
    define: {
      ...app.define,
      // no html around the entry to carry it
      __STUB_COMMIT__: JSON.stringify(commit),
      // An app build has vite replace this and a LIB BUILD DELIBERATELY DOES NOT, because a library
      // is meant to leave the choice to whoever bundles it. Nothing bundles this one: it is loaded
      // as-is, so the reference survives to runtime and `process` does not exist in a browser. It
      // lands in the WORKER, where graphql-yoga reads process.env.NODE_ENV unguarded, so the worker
      // dies on its first message and the page stays blank with one ReferenceError to explain it.
      // The pre-188e538 lib config carried the same line for the same reason.
      'process.env.NODE_ENV': JSON.stringify(env.mode === 'development' ? 'development' : 'production'),
    },
    build: {
      ...app.build,
      // the app build ran first and owns build/; this one lands index.js next to its index.html
      emptyOutDir: false,
      lib: {
        entry: { index: 'src/index.tsx', embed: 'embed.html' },
        formats: ['es'],
        // package.json's `main` is build/index.js, and this is the half that names it
        fileName: (_format, name) => name === 'index' ? 'index.js' : `assets/lib-${name}-[hash].js`,
      },
      // NOT a spread of the app's rollupOptions: its `input` names index.html and embed.html, and
      // vite lets rollupOptions.input win over lib.entry, so carrying it would build the app again
      // under this config's output names.
      rollupOptions: {
        output: {
          // both builds write into assets/, so every name this one emits carries a prefix the app
          // build cannot produce. Two files agreeing on a name would have the second build silently
          // overwrite the first's, and only one of the two pages would still work.
          chunkFileNames: 'assets/lib-[name]-[hash].js',
          assetFileNames: 'assets/lib-[name]-[hash][extname]',
        },
      },
    },
    worker: {
      ...app.worker,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/lib-worker-[name]-[hash].js',
          chunkFileNames: 'assets/lib-worker-[name]-[hash].js',
          assetFileNames: 'assets/lib-worker-[name]-[hash][extname]',
        },
      },
    },
    plugins: [
      // nested rather than spread: the app's is a lazyPlugins() handle, and vite flattens nested
      // plugin arrays, so this appends without unwrapping it
      app.plugins,
      {
        // A lib build inlines every asset as base64, `assetsInlineLimit` notwithstanding, so jassub's two
        // `new URL('./wasm/*.wasm', import.meta.url)` put 6.2 MB (2.6 MB gzip) in the chunk behind the first
        // theme Play (measured 2026-10-12), for a subtitle renderer a theme never starts. `?no-inline` is
        // vite's per-import opt out, and the build strips it from the emitted url.
        name: 'stub-lib-wasm-files',
        enforce: 'pre',
        apply: 'build',
        transform: {
          filter: { id: /\/node_modules\/jassub\// },
          handler: code => ({ code: code.replace(/(new URL\(\s*['"][^'"?]+\.wasm)(['"])/g, '$1?no-inline$2'), map: null }),
        },
      },
      {
        name: 'stub-inline-lib-css',
        apply: 'build',
        generateBundle: {
          // after every other plugin, because vite emits the css assets from its own generateBundle
          order: 'post',
          handler(_options, bundle) {
            // The app build links its stylesheet from index.html. A lib build has no html to link it
            // from and emits it as an asset nothing loads, so the module has to carry it: measured on
            // 0.0.19, 36,709 bytes of @videojs/react skin that the entry never asked for.
            const sheets = Object.values(bundle).filter(output => output.type === 'asset' && output.fileName.endsWith('.css'))
            if (!sheets.length) return

            const entries = Object.values(bundle).filter(output => output.type === 'chunk' && output.isEntry)
            if (!entries.length) throw new Error('the lib build emitted css but no entry chunk to carry it')

            const text = sheets.map(sheet => (sheet.type === 'asset' ? String(sheet.source) : '')).join('\n')
            for (const sheet of sheets) delete bundle[sheet.fileName]

            // prepended so the sheet is in the document before the entry's own render, and before
            // emotion's runtime styles, which is the order index.html gives it
            for (const entry of entries) {
              if (entry.type === 'chunk') entry.code = `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(text)}; document.head.appendChild(s) })();\n${entry.code}`
            }

            // the player page's own link to the sheet deleted above
            const page = bundle['embed.html']
            if (page?.type === 'asset') page.source = String(page.source).replace(/\s*<link rel="stylesheet"[^>]*>/, '')
          },
        },
      },
    ],
  }
})
