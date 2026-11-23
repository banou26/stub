import { describe, expect, test } from 'vite-plus/test'

import { fetchXunleiSubtitles, xunleiSubtitleUrl } from '../../../src/subtitles/xunlei'

describe('xunleiSubtitleUrl', () => {
  test('encodes oracle subtitle lookup query', () => {
    expect(xunleiSubtitleUrl('Dune Part Two')).toBe(
      'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=Dune%20Part%20Two',
    )
  })
})

describe('fetchXunleiSubtitles', () => {
  test('filters hosts and formats, normalizes Traditional/Simplified Chinese, maps ssa->ass, deduplicates by cid, and caps to 8', async () => {
    const items = [
      { cid: 'c1', url: 'http://subtitle.v.geilijiasu.com/a.ssa', ext: 'ssa', langs: '繁体', languages: ['繁体'], score: 90 },
      { cid: 'c1', url: 'https://subtitle.v.geilijiasu.com/a-dup.srt', ext: 'srt', langs: '繁体', score: 95 },
      { cid: 'c2', url: 'https://subtitle.v.geilijiasu.com/b.srt', ext: 'srt', langs: '简英双语', languages: ['英文', '简体'], score: 99 },
      { cid: 'bad-ext', url: 'https://subtitle.v.geilijiasu.com/bad.idx', ext: 'idx', langs: '简体', score: 100 },
      { cid: 'bad-host', url: 'https://other.example.com/x.srt', ext: 'srt', langs: '简体', score: 100 },
      ...Array.from({ length: 10 }, (_, idx) => ({
        cid: `extra-${idx}`,
        url: `https://subtitle.v.geilijiasu.com/e-${idx}.vtt`,
        ext: 'vtt',
        langs: '简体',
        score: idx,
      })),
    ]

    const tracks = await fetchXunleiSubtitles('Show S01E01', {
      fetch: async () => Response.json({ code: 0, data: items }),
      preferredLanguages: ['zh-Hant'],
      locale: 'en',
    })

    expect(tracks).toHaveLength(8)
    expect(tracks[0]).toMatchObject({
      id: 'xunlei:c1',
      language: 'zh-Hant',
      format: 'ass',
      url: 'https://subtitle.v.geilijiasu.com/a.ssa',
    })
    expect(tracks[1]).toMatchObject({
      id: 'xunlei:c2',
      language: 'zh-Hans',
      format: 'srt',
      url: 'https://subtitle.v.geilijiasu.com/b.srt',
    })
    expect(tracks.some(t => t.id === 'xunlei:bad-ext' || t.id === 'xunlei:bad-host')).toBe(false)
    for (const track of tracks) {
      expect(track.label).not.toMatch(/[\u2013\u2014]/)
    }
  })

  test('returns empty list for blank query or errors', async () => {
    expect(await fetchXunleiSubtitles('   ', { fetch: async () => new Response('') })).toEqual([])
    expect(await fetchXunleiSubtitles('Title', { fetch: async () => new Response('', { status: 502 }) })).toEqual([])
  })
})
