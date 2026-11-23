import { describe, expect, test, vi } from 'vite-plus/test'

import { SAUCENAO_DBS, createSauceNaoClient } from '../../../src/scene/saucenao'
import { clearPictures, readPicture, rememberPicture } from '../../../src/scene/picture-store'
import { mergeSceneMatches } from '../../../src/scene/search'

describe('mergeSceneMatches', () => {
  test('preserves primary order, merges matching URIs keeping earliest from, and appends new matches', () => {
    const merged = mergeSceneMatches(
      [{ anilist: 21034, moments: [{ episode: 1, from: 280 }] }],
      [
        { uri: 'anilist:21034', anilist: 21034, moments: [{ episode: 1, from: 270 }, { episode: 2, from: 15 }] },
        { uri: 'omdb:tt1475582', moments: [{ season: 1, episode: 2, from: 90 }] },
      ],
    )
    expect(merged).toEqual([
      { anilist: 21034, uri: 'anilist:21034', moments: [{ episode: 1, from: 270 }, { episode: 2, from: 15 }] },
      { uri: 'omdb:tt1475582', moments: [{ season: 1, episode: 2, from: 90 }] },
    ])
  })
})

describe('SAUCENAO_DBS and picture store', () => {
  test('selects site-appropriate SauceNAO databases and bounds in-memory pictures', () => {
    expect(SAUCENAO_DBS).toEqual({
      anime: [21],
      movie: [23],
      series: [24],
      stub: [21, 23, 24],
    })
    clearPictures()
    for (let i = 0; i < 12; i++) {
      rememberPicture(`code-${i}`.padEnd(28, 'a'), new Blob([new Uint8Array([i])]))
    }
    expect(readPicture(`code-0`.padEnd(28, 'a'))).toBeUndefined()
    expect(readPicture(`code-11`.padEnd(28, 'a'))).toBeDefined()
  })
})

describe('createSauceNaoClient', () => {
  test('sends prepared image bytes and site dbs through the attached frame and parses the HTML', async () => {
    const calls: { dbs: number[], length: number, mimeType: string }[] = []
    const search = createSauceNaoClient({
      frames: {
        use: async (_site, fn) => fn({
          search: async ({ bytes, mimeType, dbs }) => {
            calls.push({ dbs, length: bytes.byteLength, mimeType })
            return {
              status: 200,
              html: `
                <table class="resulttable"><tr><td>
                  <div class="resultsimilarityinfo">91.4%</div>
                  <div class="resulttitle">Movie Title</div>
                  <div class="resultcontentcolumn"><span class="subtext"><strong>Est Time: </strong>00:03:05 / 01:45:00</span></div>
                  <a href="https://www.imdb.com/title/tt1375666/">IMDb</a>
                </td></tr></table>
              `,
            }
          },
        }),
      },
      prepare: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' }),
    })

    const result = await search(new Blob(['x'], { type: 'image/png' }), 'movie')
    expect(calls).toEqual([{ dbs: [23], length: 3, mimeType: 'image/jpeg' }])
    expect(result).toEqual({
      matches: [{ uri: 'omdb:tt1375666', moments: [{ episode: null, from: 185 }] }],
    })
  })

  test('returns busy when frame attachment or RPC rejects', async () => {
    const search = createSauceNaoClient({
      frames: {
        use: vi.fn().mockRejectedValue(new Error('permission denied')),
      },
      prepare: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }),
    })
    await expect(search(new Blob(['x']), 'series')).resolves.toEqual({ error: 'busy' })
  })
})
