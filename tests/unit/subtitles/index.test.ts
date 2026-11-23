import { describe, expect, test } from 'vite-plus/test'

import {
  extractAniId,
  extractImdbId,
  extractReleaseName,
  extractSeasonNumber,
  fetchExternalSubtitles,
} from '../../../src/subtitles'

describe('subtitle metadata extractors', () => {
  test('extracts imdbId from direct uri or nested handles', () => {
    expect(extractImdbId({ uri: 'ag:(imdb:tt0944947,tmdb:1399)' })).toBe('tt0944947')
    expect(extractImdbId({
      uri: 'ag:(tmdb:1399)',
      handles: [{
        relation: 'SAME_AS',
        node: {
          uri: 'tmdb:1399',
          handles: [{ relation: 'SAME_AS', node: { uri: 'imdb:tt0944947', origin: 'imdb', id: 'tt0944947' } }],
        },
      }],
    })).toBe('tt0944947')
  })

  test('extracts aniId preferring anilist then mal then anidb', () => {
    expect(extractAniId({ uri: 'ag:(mal:5114,anilist:5114)' })).toEqual({ providerId: 'anilist', id: '5114' })
    expect(extractAniId({
      uri: 'ag:(cr:G1)',
      handles: [{ relation: 'SAME_AS', node: { origin: 'mal', id: '21' } }],
    })).toEqual({ providerId: 'mal', id: '21' })
  })

  test('extracts season number matching the active media uri', () => {
    expect(extractSeasonNumber({
      uri: 'ag:(tmdb:1399-3)',
      seasons: [
        { number: 1, uri: 'ag:(tmdb:1399-1)' },
        { number: 3, uri: 'tmdb:1399-3' },
      ],
    })).toBe(3)
    expect(extractSeasonNumber({ uri: 'ag:(anilist:1)', seasons: [] })).toBe(1)
  })

  test('extracts release name from handle shortDescription, magnet dn, or episode title', () => {
    expect(extractReleaseName({ shortDescriptions: [{ shortDescription: 'Show.1080p.WEB' }] }, { titles: [{ title: 'Ep 1' }] })).toBe('Show.1080p.WEB')
    expect(extractReleaseName({ url: 'magnet:?xt=urn:btih:abc&dn=Movie.2024.Remux' }, undefined)).toBe('Movie.2024.Remux')
  })
})

describe('fetchExternalSubtitles', () => {
  test('resolves anime imdbId via AniZip, fetches OpenSubtitles + Xunlei in parallel, and caches loaded decoded bytes', async () => {
    let subtitleDownloads = 0
    const mockFetch = async (url: string) => {
      if (url.startsWith('https://api.ani.zip/mappings?anilist_id=154587')) {
        return Response.json({ mappings: { imdb_id: 'tt21209876' }, episodes: {} })
      }
      if (url === 'https://opensubtitles-v3.strem.io/subtitles/series/tt21209876:1:3.json') {
        return Response.json({
          subtitles: [
            { id: 101, url: 'https://subs5.strem.io/sub101.srt', lang: 'eng', subtitleFileName: 'Frieren.S01E03.srt', releaseGroup: 'SubsPlease' },
          ],
        })
      }
      if (url.startsWith('https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=')) {
        return Response.json({
          data: [
            { cid: 'xl1', url: 'https://subtitle.v.geilijiasu.com/frieren.ass', ext: 'ass', langs: '简日双语', score: 88 },
          ],
        })
      }
      if (url === 'https://subs5.strem.io/sub101.srt') {
        subtitleDownloads++
        const body = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nFrieren\n')
        return new Response(new Uint8Array([0xef, 0xbb, 0xbf, ...body]))
      }
      if (url === 'https://subtitle.v.geilijiasu.com/frieren.ass') {
        // GB18030 "中文"
        return new Response(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))
      }
      return new Response('', { status: 404 })
    }

    const bundle = await fetchExternalSubtitles({
      fetch: mockFetch,
      aniId: { providerId: 'anilist', id: '154587' },
      isAnime: true,
      film: false,
      season: 1,
      episode: 3,
      title: 'Frieren',
      releaseName: 'Frieren.S01E03.SubsPlease.1080p',
      preferredLanguages: ['en'],
      locale: 'en',
    })

    expect(bundle.tracks.map(t => ({ id: t.id, language: t.language, format: t.format }))).toEqual([
      { id: 'opensubtitles:en:101', language: 'en', format: 'srt' },
      { id: 'xunlei:xl1', language: 'zh-Hans', format: 'ass' },
    ])

    expect(await bundle.load('opensubtitles:en:101')).toBe('1\n00:00:01,000 --> 00:00:02,000\nFrieren\n')
    expect(await bundle.load('opensubtitles:en:101')).toBe('1\n00:00:01,000 --> 00:00:02,000\nFrieren\n')
    expect(subtitleDownloads).toBe(1)

    expect(await bundle.load('xunlei:xl1')).toBe('中文')
    await expect(bundle.load('unknown')).rejects.toThrow()
  })

  test('ranks combined OpenSubtitles and Xunlei candidates by viewer preferred languages', async () => {
    const mockFetch = async (url: string) => {
      if (url.startsWith('https://opensubtitles-v3.strem.io/')) {
        return Response.json({
          subtitles: [{ id: 1, url: 'https://subs5.strem.io/en.srt', lang: 'eng', subtitleFileName: 'Show.srt' }],
        })
      }
      if (url.startsWith('https://api-shoulei-ssl.xunlei.com/')) {
        return Response.json({
          data: [{ cid: 'z1', url: 'https://subtitle.v.geilijiasu.com/zh.srt', ext: 'srt', langs: '简体', languages: ['英文', '简体'], score: 90 }],
        })
      }
      return new Response('', { status: 404 })
    }

    const bundle = await fetchExternalSubtitles({
      fetch: mockFetch,
      imdbId: 'tt15239678',
      film: true,
      title: 'Dune',
      preferredLanguages: ['zh-Hans'],
      locale: 'en',
    })

    expect(bundle.tracks.map(t => t.id)).toEqual(['xunlei:z1', 'opensubtitles:en:1'])
  })
})
