import { describe, expect, test } from 'vite-plus/test'

import { fetchOpenSubtitles, openSubtitlesUrl } from '../../../src/subtitles/opensubtitles'

describe('openSubtitlesUrl', () => {
  test('builds movie and series Stremio OpenSubtitles v3 endpoints', () => {
    expect(openSubtitlesUrl({ kind: 'movie', imdbId: 'tt15239678' })).toBe(
      'https://opensubtitles-v3.strem.io/subtitles/movie/tt15239678.json',
    )
    expect(openSubtitlesUrl({ kind: 'series', imdbId: 'tt0903747', season: 2, episode: 5 })).toBe(
      'https://opensubtitles-v3.strem.io/subtitles/series/tt0903747:2:5.json',
    )
  })
})

describe('fetchOpenSubtitles', () => {
  test('filters to subs5.strem.io downloads, prioritizes preferred languages and release matches, and caps per language', async () => {
    const asked: string[] = []
    const payload = {
      subtitles: [
        { id: 1, url: 'https://subs5.strem.io/1.srt', lang: 'fre', subtitleFileName: 'Show.1080p.srt', releaseGroup: 'Other' },
        { id: 2, url: 'https://subs5.strem.io/2.srt', lang: 'eng', subtitleFileName: 'Show.S01E01.WEB.srt', releaseGroup: 'WEB' },
        { id: 3, url: 'https://subs5.strem.io/3.ass', lang: 'eng', subtitleFileName: 'Show.S01E01.SubsPlease.1080p.ass', releaseGroup: 'SubsPlease' },
        { id: 4, url: 'https://subs5.strem.io/4.srt', lang: 'eng', subtitleFileName: 'Show.S01E01.Third.srt', releaseGroup: 'Third' },
        { id: 5, url: 'https://evil.example/5.srt', lang: 'eng', subtitleFileName: 'Evil.srt' },
        { id: 6, url: 'https://subs5.strem.io/6.zip', lang: 'eng', subtitleFileName: 'Archive.zip' },
        { id: 7, url: 'https://subs5.strem.io/7.vtt', lang: 'pob', subtitleFileName: 'Show.ptbr.vtt' },
      ],
    }

    const tracks = await fetchOpenSubtitles(
      { kind: 'series', imdbId: 'tt0903747', season: 1, episode: 1 },
      {
        fetch: async url => {
          asked.push(url)
          return Response.json(payload)
        },
        preferredLanguages: ['en'],
        releaseName: 'Show.S01E01.SubsPlease.1080p',
        locale: 'en',
      },
    )

    expect(asked).toEqual(['https://opensubtitles-v3.strem.io/subtitles/series/tt0903747:1:1.json'])
    // Only 2 English tracks kept (SubsPlease scored highest), plus French and Portuguese (Brazil), rejecting evil host and .zip
    expect(tracks.map(t => ({ id: t.id, language: t.language, format: t.format, url: t.url }))).toEqual([
      { id: 'opensubtitles:en:3', language: 'en', format: 'ass', url: 'https://subs5.strem.io/3.ass' },
      { id: 'opensubtitles:en:2', language: 'en', format: 'srt', url: 'https://subs5.strem.io/2.srt' },
      { id: 'opensubtitles:fr:1', language: 'fr', format: 'srt', url: 'https://subs5.strem.io/1.srt' },
      { id: 'opensubtitles:pt-BR:7', language: 'pt-BR', format: 'vtt', url: 'https://subs5.strem.io/7.vtt' },
    ])
    for (const track of tracks) {
      expect(track.label).not.toMatch(/[\u2013\u2014]/)
    }
  })

  test('returns empty list on HTTP errors or network failure', async () => {
    expect(await fetchOpenSubtitles({ kind: 'movie', imdbId: 'tt1' }, { fetch: async () => new Response('', { status: 500 }) })).toEqual([])
    expect(await fetchOpenSubtitles({ kind: 'movie', imdbId: 'tt1' }, { fetch: async () => { throw new Error('offline') } })).toEqual([])
  })
})
