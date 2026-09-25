import { describe, expect, test } from 'vitest'

import { EMBED_PAGE, embedPage, embedPageExpression, renderBuiltUrl } from '../../scripts/embed-page'

// Under fkn.app/app the tenant serves the PACKAGE root, so stub's player page is /build/embed.html and
// the origin-root /embed.html answers `502 not-listed` (measured on 0.0.27, 2026-09-26). anime.fkn.app
// serves build/ as its root and must keep resolving exactly what it did.

/** what the expression evaluates to in a chunk served from `chunkUrl` */
const resolveIn = (expression: string, chunkUrl: string): string =>
  new Function('importMetaUrl', `return ${expression.replace('import.meta.url', 'importMetaUrl')}`)(chunkUrl)

type RenderChunk = (code: string, chunk: { fileName: string }) => { code: string } | null
type Config = (config: object, env: { command: 'build' | 'serve' }) => { define?: Record<string, string> } | undefined

describe('the embed page url', () => {
  test('resolves beside the lib entry, which is where fkn.app/app serves the page', () => {
    expect(resolveIn(embedPageExpression('index.js'), 'https://0x3lk9k4779agjbj1og4i6hu.sdbx.app/build/index.js'))
      .toBe('https://0x3lk9k4779agjbj1og4i6hu.sdbx.app/build/embed.html')
  })

  test('resolves from a chunk under assets/ to the page above it, at any prefix', () => {
    expect(resolveIn(embedPageExpression('assets/lib-watch-Dx0.js'), 'https://tenant.example/build/assets/lib-watch-Dx0.js'))
      .toBe('https://tenant.example/build/embed.html')
    expect(resolveIn(embedPageExpression('assets/main-D0k.js'), 'https://example.test/some/prefix/assets/main-D0k.js'))
      .toBe('https://example.test/some/prefix/embed.html')
  })

  test('resolves to the same url anime.fkn.app already served, whatever route the document is on', () => {
    expect(resolveIn(embedPageExpression('assets/main-D0k.js'), 'https://anime.fkn.app/assets/main-D0k.js'))
      .toBe('https://anime.fkn.app/embed.html')
  })

  test('replaces every mention in a chunk, and leaves a chunk that names none untouched', () => {
    const renderChunk = embedPage().renderChunk as unknown as RenderChunk
    const rendered = renderChunk(`a(\`\${${EMBED_PAGE}}?x\`);b(${EMBED_PAGE})`, { fileName: 'index.js' })
    expect(rendered?.code).not.toContain(EMBED_PAGE)
    expect(rendered?.code.split(embedPageExpression('index.js')).length).toBe(3)
    expect(renderChunk('export const a = 1', { fileName: 'index.js' })).toBeNull()
  })

  test('is the origin-root page on the dev server, which has no chunks to be relative to', () => {
    const config = embedPage().config as unknown as Config
    expect(config({}, { command: 'serve' })?.define?.[EMBED_PAGE]).toBe('"/embed.html"')
    expect(config({}, { command: 'build' })).toBeUndefined()
  })
})

describe('the app build urls', () => {
  // anime.fkn.app answers every route with index.html, so a relative url there would resolve under
  // /watch/... and the app would not boot. undefined leaves it to the build's base, '/'.
  test('index.html keeps origin-root urls', () => {
    expect(renderBuiltUrl('assets/main-D0k.js', { hostType: 'html', hostId: 'index.html' })).toBeUndefined()
  })

  test('embed.html names its files relative to itself', () => {
    expect(renderBuiltUrl('assets/embed-D1N.js', { hostType: 'html', hostId: 'embed.html' })).toBe('./assets/embed-D1N.js')
  })

  test('a chunk or a stylesheet names what it loads relative to itself', () => {
    expect(renderBuiltUrl('assets/remote-CVV.js', { hostType: 'js', hostId: 'assets/embed-D1N.js' })).toEqual({ relative: true })
    expect(renderBuiltUrl('assets/font-Bx1.woff2', { hostType: 'css', hostId: 'assets/embed-3a7.css' })).toEqual({ relative: true })
  })
})
