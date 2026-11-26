import type { SubtitleQueryContext } from '../../../src/plugin-api'

import { afterEach, expect, test, vi } from 'vite-plus/test'

vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

const port = vi.hoisted(() => ({ payload: {} as object }))
vi.mock('@fkn/lib/packages', () => ({ attach: async () => port.payload }))

const {
  extractors,
  findRemoteSubtitles,
  loadRemoteSubtitle,
  registerRemoteExtractor,
  selectRemoteSubtitle,
  unregisterRemoteExtractor,
} = await import('../../../src/worker/extractor')
const { setDisabledOrigins } = await import('../../../src/worker/disabled-origins')

const PKG_SUBS = 'https:subtitles.spec.test'
const PKG_HYBRID = 'https:hybrid.spec.test'

const BASE_CONTEXT: SubtitleQueryContext = {
  mediaUri: 'ag:(imdb:tt15239678)',
  episodeUri: 'ag:(imdb:tt15239678)',
  imdbId: 'tt15239678',
  isAnime: false,
  film: true,
  title: 'Dune',
  preferredLanguages: ['en'],
  locale: 'en',
}

afterEach(() => {
  setDisabledOrigins([])
  unregisterRemoteExtractor(PKG_SUBS)
  unregisterRemoteExtractor(PKG_HYBRID)
})

test('registers subtitlesOnly plugins outside extractors, rejects missing subtitle callbacks and origin collisions, and finds/loads/selects subtitles', async () => {
  const emptyFind = {
    origin: 'badsub',
    originUrl: 'https://badsub.test',
    name: 'Bad Sub',
    isApiOnly: true,
    subtitlesOnly: true,
  }
  port.payload = { sources: [emptyFind] }
  await expect(registerRemoteExtractor(new MessageChannel().port1, PKG_SUBS)).rejects.toThrow('findSubtitles or selectSubtitle')

  const findSubtitles = vi.fn(async (ctx: SubtitleQueryContext) => [
    {
      id: 'sub-1',
      language: 'eng',
      label: 'English \u2014 SubsOnly',
      format: 'srt',
      release: `Dune.${ctx.query ?? 'Auto'}.1080p`,
      group: 'GroupA',
      hearingImpaired: true,
      downloads: 42,
    },
    {
      id: 'sub-bad',
      language: 'en',
      label: 'Invalid',
      format: 'txt',
    },
  ])
  const loadSubtitle = vi.fn(async (trackId: string) =>
    trackId === 'sub-1' ? '1\n00:00:01,000 --> 00:00:02,000\nLoaded\n' : '',
  )
  const selectSubtitle = vi.fn(async () => ({
    id: 'picked-1',
    language: 'ja',
    label: 'Japanese (Picker)',
    format: 'ass',
    content: '[Events]\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hi',
  }))

  port.payload = {
    sources: [{
      origin: 'opensub-plugin',
      originUrl: 'https://opensub-plugin.test',
      name: 'OpenSub Plugin',
      isApiOnly: true,
      subtitlesOnly: true,
      findSubtitles,
      loadSubtitle,
      selectSubtitle,
    }],
  }

  const registered = await registerRemoteExtractor(new MessageChannel().port1, PKG_SUBS)
  expect(registered.sources).toEqual([{
    origin: 'opensub-plugin',
    name: 'OpenSub Plugin',
    icon: null,
    isApiOnly: true,
    access: 'none',
    subtitlesOnly: true,
    hasSubtitles: true,
    hasSubtitlePicker: true,
  }])
  expect(extractors.some(entry => entry.extractor.origin === 'opensub-plugin')).toBe(false)

  // Another package trying to register the same origin as a video extractor must collide.
  port.payload = {
    sources: [{
      origin: 'opensub-plugin',
      originUrl: 'https://other.test',
      name: 'Clash',
      isApiOnly: false,
      resolvers: {},
    }],
  }
  await expect(registerRemoteExtractor(new MessageChannel().port1, PKG_HYBRID)).rejects.toThrow('already registered')

  const tracks = await findRemoteSubtitles({ ...BASE_CONTEXT, query: 'HDR' })
  expect(tracks).toEqual([{
    id: 'plugin:opensub-plugin:sub-1',
    language: 'en',
    label: 'English - SubsOnly',
    format: 'srt',
    hasLoader: true,
    source: 'plugin',
    sourceName: 'OpenSub Plugin',
    pluginOrigin: 'opensub-plugin',
    remoteTrackId: 'sub-1',
    release: 'Dune.HDR.1080p',
    group: 'GroupA',
    hearingImpaired: true,
    downloads: 42,
  }])

  // URL-only track without loadSubtitle omits hasLoader, while oversized inline content is dropped.
  port.payload = {
    sources: [{
      origin: 'url-only-subs',
      originUrl: 'https://url-subs.test',
      name: 'URL Subs',
      subtitlesOnly: true,
      findSubtitles: async () => [
        { id: 'u1', language: 'en', label: 'English URL', format: 'srt', url: 'https://url-subs.test/1.srt' },
        { id: 'huge', language: 'en', label: 'Too Big', format: 'srt', content: 'x'.repeat(5 * 1024 * 1024 + 1) },
        { id: 'huge-cjk', language: 'ja', label: 'Too Big CJK', format: 'srt', content: '日'.repeat(2 * 1024 * 1024) },
      ],
    }],
  }
  await registerRemoteExtractor(new MessageChannel().port1, 'https:url-subs.spec.test')
  const urlTracks = await findRemoteSubtitles(BASE_CONTEXT, ['url-only-subs'])
  expect(urlTracks).toEqual([{
    id: 'plugin:url-only-subs:u1',
    language: 'en',
    label: 'English URL',
    format: 'srt',
    url: 'https://url-subs.test/1.srt',
    source: 'plugin',
    sourceName: 'URL Subs',
    pluginOrigin: 'url-only-subs',
    remoteTrackId: 'u1',
  }])
  unregisterRemoteExtractor('https:url-subs.spec.test')

  // Multi-byte UTF-8 inline subtitles > 5 MiB returned from loadSubtitle are also rejected.
  port.payload = {
    sources: [{
      origin: 'cjk-load-subs',
      originUrl: 'https://cjk-subs.test',
      name: 'CJK Load Subs',
      subtitlesOnly: true,
      findSubtitles: async () => [{ id: 'cjk', language: 'ja', label: 'Too Big CJK', format: 'srt' }],
      loadSubtitle: async () => '日'.repeat(2 * 1024 * 1024),
    }],
  }
  await registerRemoteExtractor(new MessageChannel().port1, 'https:cjk-subs.spec.test')
  await expect(loadRemoteSubtitle('cjk-load-subs', 'cjk')).rejects.toThrow('no content')
  unregisterRemoteExtractor('https:cjk-subs.spec.test')

  expect(await loadRemoteSubtitle('opensub-plugin', 'sub-1')).toContain('Loaded')
  await expect(loadRemoteSubtitle('opensub-plugin', 'empty')).rejects.toThrow('no content')

  const picked = await selectRemoteSubtitle('opensub-plugin', BASE_CONTEXT)
  expect(picked).toHaveLength(1)
  expect(picked[0]).toMatchObject({
    id: 'plugin:opensub-plugin:picked-1',
    language: 'ja',
    format: 'ass',
    pluginOrigin: 'opensub-plugin',
  })

  // Disabling the subtitle plugin skips findRemoteSubtitles until re-enabled.
  setDisabledOrigins(['opensub-plugin'])
  expect(await findRemoteSubtitles(BASE_CONTEXT)).toEqual([])

  unregisterRemoteExtractor(PKG_SUBS)
  await expect(loadRemoteSubtitle('opensub-plugin', 'sub-1')).rejects.toThrow('unavailable')
})
