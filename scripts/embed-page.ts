import type { Plugin } from 'vite-plus'

import { posix } from 'node:path'

/**
 * Where stub's own player page, `embed.html`, is served from, as seen by whichever build is running.
 *
 * The app build writes the page at the root of `build/`. anime.fkn.app serves that directory as its
 * origin root, while fkn.app/app serves the PACKAGE root, so there the page is `/build/embed.html` and
 * an origin-root `/embed.html` answers `502 not-listed embed.html` (measured on 0.0.27). The document
 * cannot say which, since the router moves it to `/watch/...`, and neither can `BASE_URL`, which is
 * `./` in the lib build. The chunk asking for the page can: every build here writes its html at the
 * outDir root, so the page sits at a fixed path from each chunk.
 */

/** The global the watch route names for the page's url, replaced by `embedPage` in every chunk. */
export const EMBED_PAGE = '__STUB_EMBED_PAGE__'

/** The page's absolute url, resolved at runtime against the chunk the expression is rendered into. */
export const embedPageExpression = (chunkFileName: string): string =>
  `new URL(${JSON.stringify(posix.relative(posix.dirname(chunkFileName), 'embed.html'))}, import.meta.url).href`

export const embedPage = (): Plugin => ({
  name: 'stub-embed-page',
  // the dev server has no chunks to be relative to, and serves the page from its root
  config: (_config, { command }) =>
    command === 'serve' ? { define: { [EMBED_PAGE]: JSON.stringify('/embed.html') } } : undefined,
  renderChunk: (code, chunk) =>
    code.includes(EMBED_PAGE)
      ? { code: code.replaceAll(EMBED_PAGE, embedPageExpression(chunk.fileName)), map: null }
      : null,
})

/**
 * `experimental.renderBuiltUrl` for the app build, whose base stays '/'.
 *
 * index.html keeps origin-root urls: anime.fkn.app answers every route with it, and at `/watch/...` a
 * relative `./assets/x` would ask for `/watch/.../assets/x`. embed.html is only ever loaded from the
 * directory it was built into, so its tags are relative to it. Everything a chunk or a stylesheet asks
 * for (a preloaded dependency, a worker) is relative to that file, which resolves to the same url at the
 * origin root and still works under `/build/`, where the embed page runs the app build's chunks.
 */
export const renderBuiltUrl = (filename: string, { hostType, hostId }: { hostType: 'js' | 'css' | 'html', hostId: string }) =>
  hostType !== 'html' ? { relative: true } : hostId === 'embed.html' ? `./${filename}` : undefined
