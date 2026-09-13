import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import preact from '@preact/preset-vite'

// read rather than imported so the manifest does not end up in the bundle
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

// Cloudflare Pages hands the sha in as an env var, and its checkout may carry no usable git metadata, so
// that is the source to trust there. Falls back to git for a local build, and to 'dev' when neither
// answers, because a footer that renders `undefined` is worse than one that admits it does not know.
const commit = (() => {
  const fromPages = process.env.CF_PAGES_COMMIT_SHA
  if (fromPages) return fromPages.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'dev'
  }
})()

export default defineConfig((_) => ({
  define: {
    __STUB_VERSION__: JSON.stringify(version),
    __STUB_COMMIT__: JSON.stringify(commit),
  },
  fmt: { semi: false, singleQuote: true },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts', 'examples/**'],
        rules: {
          'no-floating-promises': 'off',
          'no-unused-vars': 'off',
          'no-unused-expressions': 'off',
        },
      },
    ],
  },
  experimental: {
  },
  build: {
    target: 'esnext',
    outDir: 'build',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'embed.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  // the file:-linked @fkn/lib goes stale when the lib is rebuilt, but its nested CJS dep still needs pre-bundling, else named imports (Address4) break in dev
  //
  // react and react-dom are named although neither package is installed: the alias below rewrites
  // them to preact/compat, and naming them gives every pre-bundled dependency ONE shared compat
  // chunk rather than a copy inlined into each. @banou/media-player's own React deps are pulled in
  // through it, because a dependency of an un-optimised dependency is not discovered by the scanner.
  optimizeDeps: {
    exclude: ['@fkn/lib'],
    include: [
      '@fkn/lib > ip-address',
      'react',
      'react-dom',
      '@banou/media-player > react-tooltip',
      '@banou/media-player > react-feather',
    ],
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
    // One @videojs/core is load-bearing: two means the chrome subscribes to one store while the
    // player writes the other, and nothing throws, the controls simply stop responding. Same for
    // emotion, whose second copy would inject into a different cache and lose the styles.
    dedupe: ['react', 'react-dom', '@emotion/react', '@videojs/core', '@videojs/react'],
  },
  plugins: lazyPlugins(() => [
    // the shim's dual exports map bundles buffer twice unless pinned to one build, and a resolve.alias won't do it: rolldown doesn't re-alias
    {
      name: 'fkn-resolve-node-polyfill-buffer-shim',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'vite-plugin-node-polyfills/shims/buffer') {
          return resolve(
            __dirname,
            'node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js',
          )
        }
      },
    },
    nodePolyfills(),
    preact({
      jsxImportSource: '@emotion/react',
    }),
  ]),
}))
