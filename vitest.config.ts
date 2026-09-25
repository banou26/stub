import { defineConfig } from 'vitest/config'

// What cannot be imported here is a WORKER RESOLVER: src/worker/resolvers/*/index.ts reaches
// src/worker/extractor.ts and, through urql, a CommonJS `require('react')` that no resolve alias
// intercepts, so it dies with "Cannot find module 'react'".
//
// Extractors themselves import FINE, and this comment claimed the opposite until 2026-08-31.
// Measured that day, one dynamic import each: all 23 of src/sources/*/extractor.ts load and their
// exports are callable. The claim had already cost something, since it is the stated reason
// stream-id.ts, season.ts and catalogue-gate.ts were split out of their extractors, and it nearly
// cost the regression test in tests/unit/sources/crunchyroll/extractor.test.ts, which drives the real
// `getMedia` against a stubbed `ctx.fetch`. Those modules are still worth having on their own terms;
// the reason written beside them is just not true any more.
//
// RENDERING A COMPONENT here needs the four settings below, and each one fails by naming something
// else. tests/unit/components/error-boundary.test.tsx is the first test in this repo that renders a
// component rather than reading its source, and it is what they are for. The whole unit suite was
// measured green with them on 2026-09-12.
//
//  - tsconfig sets `jsx: preserve`, so with no `oxc.jsx` every .tsx file reaches import-analysis as
//    invalid JS: "make sure to not set jsx to preserve", pointing at the first tag.
//  - The aliases are vite.config.ts's, and vitest does NOT inherit them: this file REPLACES that
//    config rather than extending it, so `react` resolves to nothing.
//  - `browser` in the ssr conditions is what picks emotion's ESM build. Node's own conditions pick a
//    .cjs.js whose `require('react/jsx-dev-runtime')` runs under node and so reaches no alias, which
//    reads as a missing install and is not one.
//  - wouter and emotion have to be INLINED for any of those aliases to apply to them at all, since
//    an externalized dependency is resolved by node rather than by vite.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: '@emotion/react' } },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      // wouter reaches `useSyncExternalStore` through a CJS shim whose `require('react')` sits behind a
      // NODE_ENV branch, which no alias and no inlining can reach under node. preact/compat exports the
      // same hook, and is what the browser build runs there anyway once react is aliased.
      'use-sync-external-store/shim/index.js': 'preact/compat',
      // the SELECTOR entry cannot point at preact/compat the way its sibling above does, because
      // compat exports `useSyncExternalStore` and not the selector wrapper zustand 4 destructures
      // off it. @xyflow/react reaches it through zustand. See the shim for why the browser build
      // needs none of this.
      'use-sync-external-store/shim/with-selector.js': './tests/shims/use-sync-external-store-with-selector.ts',
    },
  },
  ssr: { resolve: { conditions: ['module', 'browser', 'development', 'import', 'default'] } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    environment: 'node',
    // The engine-backed graph suites seed a page and run a pass in `beforeAll`, and the first cold
    // transform of a run can spend the default 10 s before the hook's own work starts: measured
    // 2026-09-12 as `Hook timed out in 10000ms` on title.test.ts the first time a new engine suite
    // joined the pool, green alone and on every warm run since. 300 s is what the two newest suites
    // already pass per file; here it covers the older ones too.
    hookTimeout: 300_000,
    // The same suites run a whole pass inside a test body, and under the pool's parallel engine load
    // one such test hit the 5 s default (2026-09-12, a refused episode pair flipping to active: green
    // alone, red beside sixty other files). A hang in a plain unit test now costs two minutes to
    // surface instead of five seconds, which is the cheaper of the two mistakes.
    testTimeout: 120_000,
    // seeds sacha's wasm, which cannot self-init under node. See the file for why it is not inlined.
    setupFiles: ['./vitest.setup.ts'],
    // TWO GRAPHQL REALMS, or a yoga server cannot execute a document here. Externalized, yoga and
    // its plugins load graphql through node while a test's own `import ... from 'graphql'` resolves
    // through vite, so a schema built by one and a `getNamedType` from the other meet as strangers:
    // every field errors with "Cannot use GraphQLNonNull \"String!\" from another module or realm",
    // which reads as a duplicate install and is not one (there is exactly one graphql in the tree).
    // Inlining these makes vite resolve them, so the whole run shares one graphql.
    //
    // @banou/media-player and @videojs are inlined so their `react` imports reach the alias, which
    // is what lets tests/unit/sources/crunchyroll/seek-preview.test.tsx render the real seek bar. Its
    // CommonJS icon and tooltip libraries still cannot be, so that test mocks those two.
    server: { deps: { inline: [/graphql-yoga/, /@envelop\//, /@graphql-tools\//, /@whatwg-node\//, /@emotion\//, /wouter/, /use-sync-external-store/, /@xyflow\//, /zustand/, /classcat/, /@banou\/media-player/, /@videojs\//] } },
  },
})
