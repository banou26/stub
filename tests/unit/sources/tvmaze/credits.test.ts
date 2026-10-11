// Breaking Bad as TVmaze answered the title page's request on 2026-10-12, trimmed to a few episodes
// and to each person's name, page and face.
import { expect, test } from 'vite-plus/test'

import { parseCredits, resolvers } from '../../../../src/sources/tvmaze/extractor'
import BREAKING_BAD from '../../../fixtures/credits/tvmaze-breaking-bad.json'

const portrait = (path: string) => `https://static.tvmaze.com/uploads/images/medium_portrait/${path}.jpg`

test('each actor stands under their character with no language, and the crew are staff', () => {
  const { characters, staff } = parseCredits(BREAKING_BAD._embedded)

  expect(characters).toHaveLength(11)
  expect(characters[0]).toEqual({
    id: 'tvmaze:45529',
    names: ['Walter White'],
    image: portrait('0/2404'),
    url: 'https://www.tvmaze.com/characters/45529/breaking-bad-walter-white',
    voiceActors: [{
      language: null,
      person: { id: 'tvmaze:14245', name: 'Bryan Cranston', image: portrait('195/488839'), url: 'https://www.tvmaze.com/people/14245/bryan-cranston' },
    }],
  })
  expect(staff.map(({ person, roles }) => [person.name, roles])).toEqual([
    ['Michelle MacLaren', ['Co-Executive Producer']],
    ['Michelle MacLaren', ['Executive Producer']],
    ['Vince Gilligan', ['Creator']],
    ['Vince Gilligan', ['Executive Producer']],
    ['Dave Porter', ['Music']],
  ])
})

const open = async (details?: boolean) => {
  const urls: string[] = []
  const context = { fetch: async (url: string) => (urls.push(url), { json: async () => BREAKING_BAD }) }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: 'tvmaze:169-s1', details } }, context).next()
  return { urls, media: value.media }
}

// the relay caches on the url, so the modal's must not move
test('the cast and crew are asked only by the title page, and the modal\'s url is unchanged', async () => {
  const modal = await open()
  expect(modal.urls).toEqual(['https://api.tvmaze.com/shows/169?embed=episodes'])
  expect(modal.media.credits).toBeUndefined()

  const page = await open(true)
  expect(page.urls).toEqual(['https://api.tvmaze.com/shows/169?embed[]=episodes&embed[]=cast&embed[]=crew'])
  expect(page.media.credits.characters).toHaveLength(11)
})
