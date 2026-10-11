// Breaking Bad and Dune: Part Two as IMDb's GraphQL answered the title page's query on 2026-10-12,
// trimmed to the first actors and with no episodes.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { parseCredits, resolvers } from '../../../../src/sources/omdb/extractor'
import BREAKING_BAD from '../../../fixtures/credits/imdb-breaking-bad.json'
import DUNE from '../../../fixtures/credits/imdb-dune.json'

const face = (id: string) => `https://m.media-amazon.com/images/M/${id}._V1_UY256_.jpg`

test('a series\' actors stand under their parts with no language, its creator is staff, faces 256 px tall', () => {
  const { characters, staff } = parseCredits(BREAKING_BAD.data.title)

  expect(characters).toHaveLength(10)
  expect(characters[0]).toEqual({
    names: ['Walter White'],
    voiceActors: [{
      language: null,
      person: { id: 'imdb:nm0186505', name: 'Bryan Cranston', image: face('MV5BMTA2NjEyMTY4MTVeQTJeQWpwZ15BbWU3MDQ5NDAzNDc@'), url: 'https://www.imdb.com/name/nm0186505' },
    }],
  })
  expect(staff).toEqual([{
    person: { id: 'imdb:nm0319213', name: 'Vince Gilligan', image: face('MV5BNTUyNzUxOTAxMV5BMl5BanBnXkFtZTcwNzk0MDM0Nw@@'), url: 'https://www.imdb.com/name/nm0319213' },
    roles: ['Creator'],
  }])
})

test('a film\'s director and writers are staff, one row per job', () => {
  const { characters, staff } = parseCredits(DUNE.data.title)
  expect(characters.map(({ names }) => names[0])).toEqual(['Paul Atreides', 'Chani', 'Jessica', 'Stilgar', 'Gurney Halleck', 'Feyd-Rautha', 'Princess Irulan', 'Beast Rabban'])
  expect(staff.map(({ person, roles }) => [person.id, roles])).toEqual([
    ['imdb:nm0898288', ['Director']],
    ['imdb:nm0898288', ['Writer']],
    ['imdb:nm3123612', ['Writer']],
    ['imdb:nm0378541', ['Writer']],
  ])
})

// Orphan Black (tt2234222): IMDb lists every clone Tatiana Maslany plays; on a sketch show that runs to hundreds
test('an actor stands under the first part IMDb lists, not every part they played', () => {
  const { characters } = parseCredits({ cast: { edges: [{ node: {
    name: { id: 'nm1137209', nameText: { text: 'Tatiana Maslany' } },
    characters: [{ name: 'Sarah Manning' }, { name: 'Cosima Niehaus' }, { name: 'Alison Hendrix' }],
  } }] } })
  expect(characters.map(({ names }) => names)).toEqual([['Sarah Manning']])
})

const open = async (answer: unknown, id: string, details?: boolean) => {
  const bodies: string[] = []
  const context = { fetch: async (_: string, init: { body: string }) => (bodies.push(init.body), { json: async () => answer }) }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: `omdb:${id}`, details } }, context).next()
  return { bodies, media: value.media }
}

// the relay caches on the whole body, so the modal's must not move
test('the credits are asked only by the title page, and the modal\'s body is pinned', async () => {
  const modal = await open(BREAKING_BAD, 'tt0903747')
  expect(createHash('sha256').update(modal.bodies[0]!).digest('hex')).toBe('4e344bf92eadc3e1c229a569509ee94033d2e55209b552e2d3fd10506adce8f3')
  expect(modal.media.credits).toBeUndefined()

  const page = await open(DUNE, 'tt15239678', true)
  expect(page.bodies[0]).toContain('cast: credits(')
  expect(page.media.credits.characters).toHaveLength(8)
  expect(page.media.episodes, 'a film keeps its one episode').toHaveLength(1)
})
