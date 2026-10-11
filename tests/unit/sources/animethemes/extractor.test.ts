// AnimeThemes, on its GraphQL answer for Frieren (MyAnimeList 52991) as graphql.animethemes.moe gave it
// on 2026-10-12.
import { expect, test } from 'vite-plus/test'

import { normalizeThemes, resolvers, type AnimeThemesAnime } from '../../../../src/sources/animethemes/extractor'
import FRIEREN from '../../../fixtures/themes/animethemes-frieren.json'

const anime = FRIEREN.data.findAnimeByExternalSite[0] as AnimeThemesAnime

test('the themes read openings first, each with its song, artists and first video', () => {
  const themes = normalizeThemes(anime)
  expect(themes.map(theme => `${theme.kind}${theme.sequence ?? ''} ${theme.title} / ${theme.artists.join(', ')}`)).toEqual([
    'OP1 Yuusha / YOASOBI',
    'OP2 Haru / Yorushika',
    'ED1 Anytime Anywhere / milet',
    'ED bliss / milet',
  ])
  expect(themes.map(theme => theme.video)).toEqual([
    'https://v.animethemes.moe/SousouNoFrieren-OP1.webm',
    'https://v.animethemes.moe/SousouNoFrieren-OP2.webm',
    'https://v.animethemes.moe/SousouNoFrieren-ED1.webm',
    'https://v.animethemes.moe/SousouNoFrieren-ED1-TV.webm',
  ])
})

test('a later opening listed first still comes second', () => {
  const [op1, , , op2] = anime.animethemes
  expect(normalizeThemes({ ...anime, animethemes: [op2!, op1!] }).map(theme => theme.title)).toEqual(['Yuusha', 'Haru'])
})

test('the romaji title is read before the native one', () => {
  const [theme] = anime.animethemes
  const song = { ...theme!.song, title: { romaji: 'Yuusha', native: '勇者' } }
  expect(normalizeThemes({ ...anime, animethemes: [{ ...theme!, song }] })[0]!.title).toBe('Yuusha')
})

test('a group credited once per member is one artist', () => {
  const [theme] = anime.animethemes
  const group = { artist: { name: { main: 'Aqours' } } }
  const themes = normalizeThemes({ ...anime, animethemes: [{ ...theme!, song: { ...theme!.song, performances: [group, group, group] } }] })
  expect(themes[0]!.artists).toEqual(['Aqours'])
})

const rig = () => {
  const bodies: { query: string, variables: Record<string, unknown> }[] = []
  const ctx = {
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== 'https://graphql.animethemes.moe/') throw new Error(`fixture has no route for ${url}`)
      bodies.push(JSON.parse(init?.body ?? '{}'))
      return { ok: true, status: 200, json: async () => FRIEREN }
    },
  } as never
  return { bodies, ctx }
}

const open = async (ctx: never, uri: string, details?: boolean) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri, details } }, ctx).next()
  return value.media
}

test('only the title page asks, once, and the answer names back only the id it was asked with', async () => {
  const { bodies, ctx } = rig()
  expect(await open(ctx, 'ag:(anilist:154587,mal:52991)')).toBeNull()
  expect(bodies, 'the modal and the listing send nothing').toHaveLength(0)

  const media = await open(ctx, 'ag:(anilist:154587,mal:52991)', true)
  expect(bodies.map(body => body.variables)).toEqual([{ site: 'MAL', id: 52991 }])
  expect(media.uri).toBe('animethemes:4136')
  expect(media.url).toBe('https://animethemes.moe/anime/sousou_no_frieren')
  expect(media.handles.map((handle: { node: { uri: string } }) => handle.node.uri)).toEqual(['mal:52991'])
  expect(media.themes).toHaveLength(4)
})

test('a title with no MyAnimeList id is asked by its AniList id', async () => {
  const { bodies, ctx } = rig()
  const media = await open(ctx, 'ag:(anilist:154587)', true)
  expect(bodies.map(body => body.variables)).toEqual([{ site: 'ANILIST', id: 154587 }])
  expect(media.handles.map((handle: { node: { uri: string } }) => handle.node.uri)).toEqual(['anilist:154587'])
})
