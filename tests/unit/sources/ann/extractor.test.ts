// Anime News Network: one title's credits read off its encyclopedia XML, asked only by the title page.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { parseCredits, resolvers } from '../../../../src/sources/ann/extractor'

const fixture = (show: string) => readFileSync(new URL(`../../../fixtures/credits/ann-${show}.xml`, import.meta.url), 'utf8')
const people = (id: number) => `https://www.animenewsnetwork.com/encyclopedia/people.php?id=${id}`

test('the cast is grouped by role string, each actor with a language code and an ANN page', () => {
  const { characters, staff } = parseCredits(fixture('bebop'))

  expect(characters.map(({ names }) => names)).toEqual([['Spike Spiegel'], ['Jet Black'], ['Lin']])
  const jet = characters[1]!
  expect(jet.id).toBeUndefined()
  expect(jet.voiceActors).toHaveLength(12)
  expect(jet.voiceActors.find(({ language }) => language === 'ja'))
    .toEqual({ language: 'ja', person: { id: 'ann:1178', name: 'Unshō Ishizuka', url: people(1178) } })
  expect(staff).toEqual([{
    person: { id: 'ann:774', name: 'Shinichirō Watanabe', url: people(774) },
    roles: ['Series Director', 'Script', 'Storyboard', 'Unit Director'],
  }])
})

test('a name, a role and a task are read with their entities decoded', () => {
  const hughes = parseCredits(fixture('fmab')).characters.find(({ names }) => names[0] === 'Maes Hughes')!
  expect(hughes.voiceActors.map(({ person }) => person.name)).toContain('Alessandro D\'Errico')

  const { characters, staff } = parseCredits(
    '<cast lang="EN"><role>Ed&#039;s Father</role><person id="1">A</person></cast><staff><task>Director &amp; Script</task><person id="2">B</person></staff>',
  )
  expect(characters.map(({ names }) => names)).toEqual([['Ed\'s Father']])
  expect(staff.map(({ roles }) => roles)).toEqual([['Director & Script']])
})

const ask = async (input: { uri: string, details?: boolean }, body = fixture('bebop')) => {
  const asked: string[] = []
  const fetch = async (url: string) => {
    asked.push(url)
    return new Response(body)
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input }, { fetch } as never).next()
  return { asked, media: value.media }
}

test('nothing is asked without `details`, nor for a title with no ANN id', async () => {
  expect(await ask({ uri: 'ag:(anilist:1,ann:13)' })).toEqual({ asked: [], media: null })
  expect(await ask({ uri: 'ag:(anilist:1,mal:1)', details: true })).toEqual({ asked: [], media: null })

  const { asked, media } = await ask({ uri: 'ag:(anilist:1,ann:13)', details: true })
  expect(asked, 'the control: the title page asks once').toEqual(['https://cdn.animenewsnetwork.com/encyclopedia/api.xml?anime=13'])
  expect(media).toMatchObject({ uri: 'ann:13', url: 'https://www.animenewsnetwork.com/encyclopedia/anime.php?id=13', titles: [], handles: [] })
  expect(media.credits.characters).toHaveLength(3)
})

test('an id ANN does not know answers nothing', async () => {
  const { media } = await ask({ uri: 'ann:14385', details: true }, '<ann><warning>no result for anime=14385</warning></ann>')
  expect(media).toBeNull()
})
