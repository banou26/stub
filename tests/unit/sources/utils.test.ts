import { describe, expect, test } from 'vite-plus/test'

import type { ExtractorServerContext } from '../../../src/worker/extractor'

import { buildHandlesFromUri, desc, dropCredit, makeMedia, mergeHandles, partOf, pickTitleMatch, searchScore, searchRelevance, simplifyTitle, stripTitle, titleSimilarity, waitForMedia } from '../../../src/sources/utils'
import SAMPLES from '../../fixtures/descriptions/samples.json'

// The home and search pages filter on searchRelevance at 0.7, so a query that normalizes to nothing
// returns an empty page and a query that normalizes to one letter returns nearly the whole catalogue.
// Measured over 903 real media before this: 587 could not be found by their own native title, and
// "Aランクパーティを離脱した俺は、元教え子たちと迷宮深部を目指す。" reduced to "a" and scored 1.0 against 841 of them.
test('a native-script query finds its own show', async () => {
  expect(await searchScore('鬼滅の刃', '鬼滅の刃')).toBe(1)
  expect(await searchScore('進撃の巨人', '進撃の巨人 Season 2')).toBe(1)
  expect(await searchRelevance('呪術廻戦', ['Jujutsu Kaisen', '呪術廻戦'])).toBe(1)
})

test('a query does not collapse to its latin residue', async () => {
  expect(await searchScore('Aランクパーティを離脱した俺は', 'Attack on Titan')).toBeLessThan(0.7)
  expect(await searchScore('鬼滅の刃 (2019)', 'Random 2019 Show')).toBeLessThan(0.7)
  expect(await searchScore('Re:ゼロから始める異世界生活', 'Rebuild of Evangelion')).toBeLessThan(0.7)
})

test('a latin query is unchanged', async () => {
  expect(await searchScore('frieren', 'Sousou no Frieren')).toBe(1)
  expect(await searchScore('one piece', 'One Piece')).toBe(1)
  expect(await searchScore('frieren', 'Cowboy Bebop')).toBeLessThan(0.7)
})

// the matcher counts code points; String.length counts utf-16 units, so an astral-plane title used to
// score 0.5 against itself and sat below the 0.7 filter.
test('an astral-plane title matches itself exactly', async () => {
  expect(await searchScore('𩸽', '𩸽')).toBe(1)
  expect(await titleSimilarity('𠮷野家', '𠮷野家')).toBe(1)
})

test('stripTitle keeps letters of every script and drops only punctuation', () => {
  expect(stripTitle('Onii-chan wa Oshimai!')).toBe('oniichan wa oshimai')
  expect(stripTitle('転生したらスライムだった件 (2026)')).toBe('転生したらスライムだった件 2026')
  expect(stripTitle('あはれ！名作くん (2026)')).toBe('あはれ名作くん 2026')
})

describe('simplifyTitle', () => {
  // The two links an anchored season pattern used to lose, measured live against unOGS.
  test('reaches a season sitting behind a decorated subtitle', () => {
    expect(simplifyTitle('Solo Leveling Season 2 -Arise from the Shadow-'))
      .toEqual(['Solo Leveling Season 2', 'Solo Leveling'])
    expect(simplifyTitle('Ace of the Diamond act II -Second Season-'))
      .toEqual(['Ace of the Diamond act II', 'Ace of Diamond act II'])
  })

  test('the rungs get shorter, never longer', () => {
    for (const title of [
      'Mission: Yozakura Family Season 2 Part 2',
      'Kaguya-sama: Love Is War -Stairway to Adulthood-',
      '転生したらスライムだった件 第4期',
      'Frieren: Beyond Journey’s End Season 2',
    ]) {
      const rungs = simplifyTitle(title)
      for (const [index, rung] of rungs.entries()) {
        expect(rung.length).toBeLessThan((rungs[index - 1] ?? title).length)
      }
    }
  })

  test('keeps what the shipped behaviour already found', () => {
    expect(simplifyTitle('Naruto: Shippuden')).toEqual(['Naruto'])
    expect(simplifyTitle('That Time I Got Reincarnated as a Slime Season 4'))
      .toContain('That Time I Got Reincarnated as a Slime')
    expect(simplifyTitle('転生したらスライムだった件 第4期')).toEqual(['転生したらスライムだった件'])
  })

  test('a title with nothing to strip yields nothing', () => {
    expect(simplifyTitle('One Piece')).toEqual([])
    expect(simplifyTitle('BEASTARS')).toEqual([])
    expect(simplifyTitle('鬼滅の刃')).toEqual([])
  })

  // A hyphen inside a word is not a subtitle delimiter, and a lone trailing one opens nothing.
  test('an internal hyphen is not a decoration', () => {
    expect(simplifyTitle('Onii-chan wa Oshimai!')).toEqual([])
    expect(simplifyTitle('Hi-Score Girl')).toEqual([])
    expect(simplifyTitle('BAKI-DOU')).toEqual([])
  })
})

// Taking results[0] from a catalogue search unchecked welded the wrong Netflix title onto 14 of 62 live
// unOGS queries, and the edge is permanent: graph.link has no inverse.
describe('pickTitleMatch', () => {
  const series = ['ANIME', 'SERIES']
  const hit = (title: string, categories = ['SERIES']) => ({ title, categories })

  test('accepts a catalogue title that merely extends ours', async () => {
    // Netflix concatenates the two names our sources carry separately, so a correct hit covers only
    // about half the query. This pair is 0.552, which is what pins the threshold from above.
    expect(await pickTitleMatch('Kimetsu no Yaiba', [hit('Demon Slayer: Kimetsu no Yaiba')], series))
      .toEqual(hit('Demon Slayer: Kimetsu no Yaiba'))
  })

  test('rejects a different show that merely shares words', async () => {
    expect(await pickTitleMatch('Naruto', [hit('Naruto Shippuden')], series)).toBeUndefined()
    expect(await pickTitleMatch('Bleach', [hit('Bleach: Thousand-Year Blood War')], series)).toBeUndefined()
    expect(await pickTitleMatch('Demon Slayer', [hit('Woochi - The Demon Slayer', ['MOVIE'])], series)).toBeUndefined()
  })

  test('a format disagreement blocks a title that would otherwise pass', async () => {
    const film = hit('One Piece Film: Red', ['MOVIE'])
    expect(await pickTitleMatch('One Piece', [film], series)).toBeUndefined()
    // absent categories are unknown, not a veto, the same rule the fuzzy merge uses
    expect(await pickTitleMatch('One Piece', [{ title: 'One Piece Film: Red' }], series))
      .toEqual({ title: 'One Piece Film: Red' })
  })

  test('takes the best candidate, not the first one the catalogue ranked', async () => {
    const candidates = [hit('Cowboy Bebop: The Movie'), hit('Cowboy Bebop')]
    expect(await pickTitleMatch('Cowboy Bebop', candidates, series)).toEqual(hit('Cowboy Bebop'))
  })

  test('nothing at all is a valid answer', async () => {
    expect(await pickTitleMatch('Frieren', [], series)).toBeUndefined()
    expect(await pickTitleMatch('Frieren', [hit('Breaking Bad')], series)).toBeUndefined()
  })
})

// Sources stamp scope on the rows they mint, and the store derives every relation from it. A run is
// the default; a PART_OF target is by definition a container of this run, so `partOf` IS the stamp.
describe('scope stamps', () => {
  test('makeMedia defaults scope to RUN, and a caller can say otherwise', () => {
    expect(makeMedia({ origin: 'anilist', id: '108465' }).scope).toBe('RUN')
    expect(makeMedia({ origin: 'cr', id: 'G24H1N3MP', scope: 'CONTAINER' }).scope).toBe('CONTAINER')
  })

  test('partOf stamps CONTAINER on a copy and leaves the original untouched', () => {
    const show = makeMedia({ origin: 'cr', id: 'G24H1N3MP', url: 'https://www.crunchyroll.com/series/G24H1N3MP' })
    const handle = partOf(show)

    expect(handle.relation).toBe('PART_OF')
    expect(handle.node.scope).toBe('CONTAINER')
    expect(handle.node.url, 'everything else rides along').toBe(show.url)
    expect(handle.node, 'a copy, so the input is not rewritten under its owner').not.toBe(show)
    expect(show.scope).toBe('RUN')
  })

  // The uri is user input, and a sibling rebuilt from it is a BARE node: no url, no title, no scope
  // beyond makeMedia's default. The caller's own scope is never stamped on it, because the caller has
  // read nothing about those ids: a CONTAINER caller stamping its run siblings CONTAINER flipped them
  // for good (scope is sticky that way in the store) and welded them in the container space.
  test('buildHandlesFromUri rebuilds bare SAME_AS siblings and stamps no scope of its own', () => {
    const handles = buildHandlesFromUri('ag:(anilist:108465,cr:G24H1N3MP,tvmaze:52279)', 'cr')

    expect(handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:108465', 'tvmaze:52279'])
    expect(handles.map(handle => handle.relation)).toEqual(['SAME_AS', 'SAME_AS'])
    for (const { node } of handles) {
      expect(node.scope, `${node.uri} carries no scope claim`).not.toBe('CONTAINER')
      expect(node.url, `${node.uri} is bare`).toBeUndefined()
      expect(node.titles).toEqual([])
    }
  })

  test('mergeHandles from a container does not stamp CONTAINER on the siblings it adds', () => {
    const show = makeMedia({ origin: 'tvmaze', id: '52279', scope: 'CONTAINER' })
    mergeHandles(show, 'ag:(anilist:108465,kitsu:42323,tvmaze:52279)')

    expect(show.handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:108465', 'kitsu:42323'])
    expect(show.handles.map(handle => handle.node.scope), 'the siblings are not the container\'s to scope').not.toContain('CONTAINER')
  })

  // The address names WHICH sources to ask and asserts nothing about how their rows relate (the
  // owner's decision, 2026-09-12), so every handle rebuilt from it carries the stamp that says so.
  // The ingest reads it into `CLAIMS.provenance` and `plugin:direct` consumes no claim that has it.
  // Mutation: drop `provenance: 'address'` from the push in `buildHandlesFromUri` and this goes red
  // on the first handle.
  test('buildHandlesFromUri stamps every handle it mints as an address pointer', () => {
    const handles = buildHandlesFromUri('ag:(anilist:108465,cr:G24H1N3MP,kitsu:42323,tvmaze:52279)', 'cr')

    expect(handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:108465', 'kitsu:42323', 'tvmaze:52279'])
    expect(handles.map(handle => handle.provenance), 'every one, not the first').toEqual(['address', 'address', 'address'])
  })

  // Two rules in one case because they are the pair that can break each other: keeping the stamp is
  // new, deduping by origin AND relation is the rule that was already there, and a merge that took
  // either half of the key would silently drop one of these handles.
  // Mutation: strip the stamp in `mergeHandles` (the first expectation goes red) or key the dedupe on
  // the origin alone (the imdb SAME_AS is refused and the second goes red).
  test('mergeHandles keeps the stamp and still dedupes by origin and relation', () => {
    const season = makeMedia({
      origin: 'tvmaze',
      id: '52279',
      handles: [partOf(makeMedia({ origin: 'imdb', id: 'tt10005350' }))],
    })
    mergeHandles(season, 'ag:(anilist:108465,imdb:tt10005350,tvmaze:52279)')

    expect(season.handles.filter(handle => handle.provenance === 'address').map(handle => handle.node.uri).sort())
      .toEqual(['anilist:108465', 'imdb:tt10005350'])
    expect(
      season.handles.map(handle => `${handle.node.origin} ${handle.relation}`).sort(),
      'imdb PART_OF does not block imdb SAME_AS'
    ).toEqual(['anilist SAME_AS', 'imdb PART_OF', 'imdb SAME_AS'])
    expect(
      season.handles.find(handle => handle.relation === 'PART_OF')!.provenance,
      'the source\'s own handle is never stamped'
    ).toBeUndefined()
  })
})

// An address names the sources a cluster was built from, and asserts nothing about how they relate.
// Two ids of ONE source inside it is `disagreeingIds`' shape (src/worker/store/anomalies.ts): that
// source names one thing once, so the pair is a union the cluster has not settled. Rebuilding a
// SAME_AS for both made the answering source settle it, with no inverse. Measured on the recorded
// season corpus: the JustWatch season jw:531130-580247 (One-Room TA) claimed SAME_AS to mal:64683 and
// mal:63225 at once, and one of the three addresses carrying two mal ids held a mis-minted mal:202717.
describe('an address naming two ids of one origin', () => {
  test('mints neither of them, and leaves the origins it names once alone', () => {
    const handles = buildHandlesFromUri('ag:(anilist:205068,kitsu:50932,mal:64683,mal:63225,jw:531130-580247)', 'jw')

    expect(handles.map(handle => handle.node.origin), 'mal is refused whole').not.toContain('mal')
    expect(handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:205068', 'kitsu:50932'])
  })

  // The precision case, which is not a disagreement: `mostSpecific` in utils/uri.ts already prefers
  // the season-scoped form, and refusing the pair here would throw that precision away.
  test('keeps the most specific id when one extends the other', () => {
    const handles = buildHandlesFromUri('ag:(anilist:108465,cr:G24H1N3MP,cr:G24H1N3MP-GS00374452)', 'anilist')

    expect(handles.map(handle => handle.node.uri)).toEqual(['cr:G24H1N3MP-GS00374452'])
    expect(handles.map(handle => handle.relation)).toEqual(['SAME_AS'])
  })

  // One-way, the same reading `disagreeingIds` takes: the shared parent must not hide the two seasons
  // welded under it.
  test('refuses a series id sitting between two of its own seasons', () => {
    const handles = buildHandlesFromUri('ag:(cr:G24H1N3MP,cr:G24H1N3MP-GS00374452,cr:G24H1N3MP-GS00374453,tvmaze:52279)', 'tvmaze')

    expect(handles.map(handle => handle.node.uri)).toEqual([])
  })

  test('the same id twice is not a disagreement', () => {
    const handles = buildHandlesFromUri('ag:(mal:64683,mal:64683)', 'jw')

    expect(handles.map(handle => handle.node.uri)).toEqual(['mal:64683'])
  })

  // The control for the rule not overreaching: one id per origin is minted exactly as it always was.
  test('one id per origin still mints one handle each', () => {
    const handles = buildHandlesFromUri('ag:(anilist:108465,kitsu:42323,mal:40748,tvmaze:52279)', 'kitsu')

    expect(handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:108465', 'mal:40748', 'tvmaze:52279'])
    expect(handles.map(handle => handle.relation)).toEqual(['SAME_AS', 'SAME_AS', 'SAME_AS'])
  })

  // The exclusion is read before the rule, so a caller whose OWN origin is the doubled one is neither
  // rebuilt nor rescued by the refusal.
  test('the caller is still the one origin never rebuilt', () => {
    expect(buildHandlesFromUri('ag:(mal:64683,mal:63225,tvmaze:52279)', 'mal').map(handle => handle.node.uri))
      .toEqual(['tvmaze:52279'])
    expect(buildHandlesFromUri('ag:(anilist:108465,tvmaze:52279)', 'tvmaze').map(handle => handle.node.uri))
      .toEqual(['anilist:108465'])
  })

  test('mergeHandles adds nothing for the disagreeing origin', () => {
    const season = makeMedia({ origin: 'jw', id: '531130-580247' })
    mergeHandles(season, 'ag:(anilist:205068,mal:64683,mal:63225,jw:531130-580247)')

    expect(season.handles.map(handle => handle.node.uri)).toEqual(['anilist:205068'])
  })
})

// Real descriptions as each source answered on 2026-10-12: AniList's and Kitsu's APIs, MyAnimeList's
// season page as the scrape reads it, and ani.zip's episode summaries.
describe('the source credit ending a description', () => {
  const drops = ({ description }: { description: string }, credit: string) => {
    expect(description).toContain(credit)
    expect(dropCredit(description)).toBe(description.replace(credit, ''))
  }

  test('AniList\'s goes, with the breaks leading into it', () => {
    drops(SAMPLES.anilistFrieren, '\n<br><br>\n(Source: Crunchyroll)')
    drops(SAMPLES.anilistMononoke, '<br><br>\n[Written by MAL Rewrite]')
    drops(SAMPLES.anilistKimiToNami, '<br></br>(Source: Toho)')
    drops(SAMPLES.anilistKooriNoJouheki, '\n<BR><BR>\n(Source: Margaret, translated)')
  })

  test('and with the breaks after it', () => {
    drops(SAMPLES.anilistSoloLeveling, '<br>\n<br>\n(Source: Crunchyroll) <br><br>')
  })

  test('one with no space after its colon goes too', () => {
    drops(SAMPLES.anilistGhostInTheShell, '  <br><br>\n(Source:攻殻機動隊 THE GHOST IN THE SHELL Site)')
  })

  test('one before AniList\'s closing note goes, and the note stays', () => {
    drops(SAMPLES.anilistJujutsuKaisen, '\n<br><br>\n(Source: Crunchyroll)')
    drops(SAMPLES.anilistKoyomimonogatari, '\n<br><br>\n(Source: Aniplex)')
  })

  test('MyAnimeList\'s goes, and a parenthesis of the story before it stays', () => {
    drops(SAMPLES.malSpyFamily, ' [Written by MAL Rewrite]')
    drops(SAMPLES.malTaneko, ' (Source: ANN)')
  })

  test('Kitsu\'s goes', () => {
    drops(SAMPLES.kitsuDemonSlayer, '\n\n(Source: Crunchyroll)')
    drops(SAMPLES.kitsuBakemonogatari, '\n\n[Written by MAL Rewrite] ')
  })

  test('ani.zip\'s last line goes', () => {
    drops(SAMPLES.anizipOnePieceUrl, '\nSource: http://onepiece.fandom.com/')
  })

  test('one in the middle stays', () => {
    const { description } = SAMPLES.anilistMekakucityActors
    expect(description).toContain('(Source: Aniplex USA)')
    expect(dropCredit(description)).toBe(description)
  })

  test('a sentence naming the Source is not a credit', () => {
    expect(dropCredit('They reach the Source: a city of light.')).toBe('They reach the Source: a city of light.')
  })

  test('a last line of the story starting with Source stays', () => {
    expect(dropCredit('A hacker tale.\nSource code holds the key to everything.')).toBe('A hacker tale.\nSource code holds the key to everything.')
  })

  test('a description with none is unchanged', () => {
    const { description } = SAMPLES.anilistCowboyBebop
    expect(dropCredit(description)).toBe(description)
  })

  test('desc publishes the description without it', () => {
    const { description } = SAMPLES.kitsuDemonSlayer
    const { descriptions, shortDescriptions } = desc(description, 0.5)
    expect(descriptions?.[0]?.description).toBe(dropCredit(description))
    expect(shortDescriptions?.[0]?.shortDescription).toBe(dropCredit(description))
  })
})

describe('a wait for the media', () => {
  // a media nobody has described yet: the changes are read once, then listened for until the wait is aborted
  const asked = (signal: AbortSignal) => ({
    request: new Request('http://d/graphql', { signal }),
    findAggregatedMedia: async () => undefined,
    listenForMediaChanges: async function* (_: { uri: string }, { abortSignal }: { abortSignal: AbortSignal }) {
      yield undefined
      await new Promise(resolve => abortSignal.addEventListener('abort', resolve))
    },
  }) as unknown as ExtractorServerContext

  const within = <T>(work: Promise<T>, ms: number) =>
    Promise.race([work, new Promise(resolve => setTimeout(resolve, ms, 'still waiting'))])

  test('ends as its ask is dropped, long before its own timeout', async () => {
    const ask = new AbortController()
    const waiting = waitForMedia('ag:(none:0)', asked(ask.signal), media => media, 60_000)
    setTimeout(() => ask.abort(), 20)
    expect(await within(waiting, 1_000)).toBeUndefined()
  })

  test('ends at once when its ask was dropped before it began', async () => {
    const ask = new AbortController()
    ask.abort()
    expect(await within(waitForMedia('ag:(none:0)', asked(ask.signal), media => media, 60_000), 1_000)).toBeUndefined()
  })
})
