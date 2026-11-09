import { expect, test } from 'vitest'

import { upsertMedia, findAggregatedMedia, findAllAggregatedMedia, findPartOfMedia } from '../../../../src/worker/store/db'
import { fuzzyMergeMediaClusters, profileCluster } from '../../../../src/worker/store/fuzzy-merge'

const SPRING_2026 = '2026-04-03T15:00:00Z'
const SUMMER_2026 = '2026-07-05T15:00:00Z'

const media = (uri: string, titles: [string, number][], startDate: string) => ({
  uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1),
  type: 'TV', categories: ['ANIME', 'SERIES'], startDate,
  titles: titles.map(([title, score]) => ({ language: 'ja', title, score })),
}) as any

// Normalizing a title to [a-z0-9] erased ani.zip's "転生したらスライムだった件 (2026)" down to the string
// "2026", which was equal to every other show airing that year: Slime's 4th season absorbed an unrelated
// TV_SHORT, and the same key put 31 shows in one component.
test('a japanese title that shares only its year does not weld two shows', async () => {
  const slime = [
    media('anilist:182205', [['Tensei Shitara Slime Datta Ken 4th Season', 0.7], ['転生したらスライムだった件 第4期', 0.7]], SPRING_2026),
    media('anizip:18884', [['That Time I Got Reincarnated as a Slime (2026)', 0.9], ['転生したらスライムだった件 (2026)', 0.9]], SPRING_2026),
  ]
  const aware = [media('anilist:205116', [['Aware! Meisaku-kun (2026)', 0.7], ['あはれ！名作くん (2026)', 0.7]], SUMMER_2026)]

  await upsertMedia([...slime, ...aware], [{ mediaUri: 'anilist:182205', handleUri: 'anizip:18884' }])
  await fuzzyMergeMediaClusters([await findAggregatedMedia('anilist:182205'), await findAggregatedMedia('anilist:205116')])

  const cluster = await findAggregatedMedia('anilist:182205')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:182205', 'anizip:18884'])
})

// Dropping non-latin titles instead of keeping them also stops the weld, and silently costs every merge
// two sources reach by agreeing on the japanese title, which is the one they agree on most often.
test('two sources that agree on the same japanese title still merge', async () => {
  const anilist = [media('anilist:1000', [['転生したらスライムだった件 第4期', 0.7]], SPRING_2026)]
  const anizip = [media('anizip:1001', [['転生したらスライムだった件 第4期', 0.9]], SPRING_2026)]

  await upsertMedia([...anilist, ...anizip], [])
  await fuzzyMergeMediaClusters([anilist, anizip])

  const cluster = await findAggregatedMedia('anilist:1000')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:1000', 'anizip:1001'])
})

test('two sources that agree on the same latin title still merge', async () => {
  const anilist = [media('anilist:2000', [['That Time I Got Reincarnated as a Slime (2026)', 0.7]], SPRING_2026)]
  const kitsu = [media('kitsu:2001', [['That Time I Got Reincarnated as a Slime 2026', 0.3]], SPRING_2026)]

  await upsertMedia([...anilist, ...kitsu], [])
  await fuzzyMergeMediaClusters([anilist, kitsu])

  const cluster = await findAggregatedMedia('anilist:2000')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:2000', 'kitsu:2001'])
})

// "第2期" and "第2クール" both left "2" behind, so it was the busiest key of all: 60 shows, among them
// Dandadan, Frieren and Kusuriya no Hitorigoto.
test('a bare number title is not an identity', async () => {
  const slave = [media('anilist:3000', [['Mato Seihei no Slave 2', 0.7], ['2', 0.9]], SPRING_2026)]
  const medalist = [media('anilist:3001', [['Medalist 2nd Season', 0.7], ['2', 0.9]], SPRING_2026)]

  await upsertMedia([...slave, ...medalist], [])
  await fuzzyMergeMediaClusters([slave, medalist])

  const cluster = await findAggregatedMedia('anilist:3000')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:3000'])
})

// A season number is identity, not similarity. `Slime Season 3` and `Season 4` score 0.929 and
// `Onii-chan!` and `Oniichan` score 0.833, so no threshold tells them apart: alignment charges the
// same for the digit that IS the identity as for the hyphen that is noise.
test('two seasons of one show do not merge on a shared alias', async () => {
  const third = [media('anilist:4000', [['Slime Season 3', 0.7], ['TenSura', 0.9]], SPRING_2026)]
  const fourth = [media('anilist:4001', [['Slime Season 4', 0.7], ['TenSura', 0.9]], SPRING_2026)]

  await upsertMedia([...third, ...fourth], [])
  await fuzzyMergeMediaClusters([third, fourth])

  const cluster = await findAggregatedMedia('anilist:4000')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:4000'])
})

// `第4期` and `Season 4` are the same claim, so the gate has to read both and let the pair through.
// Same shape as the test above with only the season changed, which is the whole difference.
test('the same season spelled two ways still merges', async () => {
  const romaji = [media('anilist:4100', [['Slime Season 4', 0.7], ['TenSura', 0.9]], SPRING_2026)]
  const native = [media('anizip:4101', [['転生したらスライムだった件 第4期', 0.9], ['TenSura', 0.9]], SPRING_2026)]

  await upsertMedia([...romaji, ...native], [])
  await fuzzyMergeMediaClusters([romaji, native])

  const cluster = await findAggregatedMedia('anilist:4100')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:4100', 'anizip:4101'])
})

// A bare trailing number is not a season (284 of 4159 real titles end in one and most name no
// season), so the season gate cannot see this pair. The values still have to be compared as numbers.
test('a bare trailing number is compared as a value', async () => {
  const sixteen = [media('anilist:4200', [['Yami Shibai 16', 0.9]], SPRING_2026)]
  const seventeen = [media('anilist:4201', [['Yami Shibai 17', 0.9]], SPRING_2026)]

  await upsertMedia([...sixteen, ...seventeen], [])
  await fuzzyMergeMediaClusters([sixteen, seventeen])

  const cluster = await findAggregatedMedia('anilist:4200')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:4200'])
})

// The guard above must not cost the merges the whole pass exists for: punctuation is still the
// normalizer's job and still free.
test('punctuation differences still merge', async () => {
  const hyphen = [media('anilist:4300', [['Onii-chan wa Oshimai!', 0.7]], SPRING_2026)]
  const joined = [media('mal:4301', [['Oniichan wa Oshimai', 0.9]], SPRING_2026)]

  await upsertMedia([...hyphen, ...joined], [])
  await fuzzyMergeMediaClusters([hyphen, joined])

  const cluster = await findAggregatedMedia('anilist:4300')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:4300', 'mal:4301'])
})

// Crunchyroll names most seasons by their position alone, so it publishes a media titled "Season 3",
// and HAS_LETTER waves that through because it is full of letters. Two unrelated shows on their third
// season then hold an IDENTICAL title and merge on the exact-title shortcut, no similarity needed.
// Measured live: "[MERGE] EXACT "season 3" :: anilist:199111 <> anilist:178789" put Grand Blue Dreaming
// and Mushoku Tensei in one cluster, and the modal rendered one under the other's name.
test('a title that is only a season label does not weld two shows', async () => {
  const grandBlue = [
    media('anilist:199111', [['Grand Blue Dreaming Season 3', 0.7]], SUMMER_2026),
    media('cr:GNVHKN94W', [['Season 3', 0.5]], SUMMER_2026),
  ]
  const mushoku = [
    media('anilist:178789', [['Mushoku Tensei: Jobless Reincarnation Season 3', 0.7]], SUMMER_2026),
    media('cr:G24H1N3MP', [['Season 3', 0.5]], SUMMER_2026),
  ]

  await upsertMedia([...grandBlue, ...mushoku], [
    { mediaUri: 'anilist:199111', handleUri: 'cr:GNVHKN94W' },
    { mediaUri: 'anilist:178789', handleUri: 'cr:G24H1N3MP' },
  ])
  await fuzzyMergeMediaClusters([grandBlue, mushoku])

  const cluster = await findAggregatedMedia('anilist:199111')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:199111', 'cr:GNVHKN94W'])
})

// and the same for the forms the other markers take, since one regex covers them all
test('the other season-only labels are refused too', async () => {
  // the SAME label on both, which is what the exact-title shortcut needs and what two shows on their
  // second season actually get from Crunchyroll
  const a = [media('anilist:4400', [['Some Show 2nd Season', 0.7]], SPRING_2026), media('cr:AAA', [['2nd Season', 0.5]], SPRING_2026)]
  const b = [media('anilist:4401', [['Another Show 2nd Season', 0.7]], SPRING_2026), media('cr:BBB', [['2nd Season', 0.5]], SPRING_2026)]

  await upsertMedia([...a, ...b], [
    { mediaUri: 'anilist:4400', handleUri: 'cr:AAA' },
    { mediaUri: 'anilist:4401', handleUri: 'cr:BBB' },
  ])
  await fuzzyMergeMediaClusters([a, b])

  const cluster = await findAggregatedMedia('anilist:4400')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:4400', 'cr:AAA'])
})

// `media` above types everything TV, and these three need the type to differ per member.
const typed = (uri: string, type: string | null, titles: [string, number][], startDate: string | null) => ({
  ...media(uri, titles, startDate ?? ''), type, startDate,
}) as any

// The class the date axis cannot reach: a work and its own companion entry share a year, often share
// a DAY, and share the native title unchanged, so the exact-title shortcut fires on 「ヴァンキッシュド
// クイーンズ」 while the latin titles that do distinguish them are never the pair that matches. Both
// signals are present here and both are needed: anilist calls the second one "Specials" and the two
// catalogues type it OVA against SPECIAL.
test('a work does not weld to its own companion entry', async () => {
  const ova = [
    typed('anilist:5000', 'OVA', [['Vanquished Queens', 0.8], ['ヴァンキッシュドクイーンズ', 0.8]], SPRING_2026),
    typed('kitsu:5001', 'OVA', [['Vanquished Queens', 0.3]], SPRING_2026),
  ]
  const specials = [
    typed('anilist:5002', 'SPECIAL', [['Vanquished Queens Specials', 0.8], ['ヴァンキッシュドクイーンズ', 0.8]], SPRING_2026),
    typed('kitsu:5003', 'SPECIAL', [['Vanquished Queens Specials', 0.3]], SPRING_2026),
  ]

  await upsertMedia([...ova, ...specials], [
    { mediaUri: 'anilist:5000', handleUri: 'kitsu:5001' },
    { mediaUri: 'anilist:5002', handleUri: 'kitsu:5003' },
  ])
  await fuzzyMergeMediaClusters([ova, specials])

  const cluster = await findAggregatedMedia('anilist:5000')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:5000', 'kitsu:5001'])
})

// ...and the marker on its own must not block, which is the whole reason the type disagreement is
// required. One catalogue writing "Mirai Nikki OVA" where the other writes "Mirai Nikki" for THE SAME
// entry is a naming convention, and the marker alone destroys 136 correct merges over the corpus
// against the 2 the pair of signals costs. Measured on anilist 8460 against its kitsu record.
test('one catalogue appending OVA to its own title still merges', async () => {
  const anilist = [typed('anilist:5100', 'OVA', [['Mirai Nikki OVA', 0.8], ['未来日記', 0.8]], SPRING_2026)]
  const kitsu = [typed('kitsu:5101', 'OVA', [['Mirai Nikki', 0.3], ['未来日記', 0.3]], SPRING_2026)]

  await upsertMedia([...anilist, ...kitsu], [])
  await fuzzyMergeMediaClusters([anilist, kitsu])

  const cluster = await findAggregatedMedia('anilist:5100')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:5100', 'kitsu:5101'])
})

// A streaming catalogue fills no `type`, so silence never blocks and the attach the pass exists for
// survives even when the metadata cluster's own title carries a marker. 0 of 17946 attaches lost.
test('a streaming cluster still attaches to a cluster whose title carries a marker', async () => {
  const metadata = [
    typed('anilist:5200', 'SPECIAL', [['Keijo!!!!!!!! Specials', 0.8], ['競女 specials', 0.8]], SPRING_2026),
    typed('kitsu:5201', 'SPECIAL', [['Keijo!!!!!!!!', 0.3], ['競女', 0.3]], SPRING_2026),
  ]
  const justwatch = [typed('jw:tskeijo', null, [['Keijo!!!!!!!!', 0.2]], '2026-01-01')]

  await upsertMedia([...metadata, ...justwatch], [{ mediaUri: 'anilist:5200', handleUri: 'kitsu:5201' }])
  await fuzzyMergeMediaClusters([metadata, justwatch])

  const cluster = await findAggregatedMedia('anilist:5200')
  expect(cluster.map(m => m.uri).sort()).toEqual(['anilist:5200', 'jw:tskeijo', 'kitsu:5201'])
})

// Seeded, because the property under test is that the outcome does not vary: an unseeded shuffle that
// only sometimes picks the arrival order that flips it is a flake, and a flake here reads as noise
// rather than as the regression it is.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const swap = shuffled[i]!
    shuffled[i] = shuffled[j]!
    shuffled[j] = swap
  }
  return shuffled
}

// Mushoku Tensei as the store actually holds it: two MAL cours and ani.zip's record already welded into
// one component by their handles, EIGHT distinct normalized titles all carrying the same score 0.9,
// against a cap of six. Only ani.zip renders the short name, and the short name is the only title
// JustWatch carries, so which two of the eight get sliced off decides whether JustWatch attaches.
const MUSHOKU: [string, [string, number][]][] = [
  ['mal:39535', [
    ['Mushoku Tensei: Jobless Reincarnation', 0.9],
    ['Mushoku Tensei: Isekai Ittara Honki Dasu', 0.9],
    ['無職転生 異世界行ったら本気だす', 0.9],
  ]],
  ['mal:45576', [
    ['Mushoku Tensei: Jobless Reincarnation Part 2', 0.9],
    ['Mushoku Tensei: Isekai Ittara Honki Dasu Part 2', 0.9],
    ['無職転生 異世界行ったら本気だす 第2クール', 0.9],
  ]],
  ['anizip:15669', [
    ['Mushoku Tensei', 0.9],
    ['無職転生', 0.9],
  ]],
]

// Every ordering in this test is one an extractor response can actually produce: the member order of a
// union-find component is [surviving root's members..., absorbed root's members...], so it is decided by
// which handle link was made first and with which argument first, i.e. by which HTTP response landed
// first. Measured before the fix: the component order [mal, mal, anizip] leaves ani.zip's two titles at
// positions 7 and 8 of the tied block, both are sliced off, and the only comparison left for
// "mushoku tensei" is against the long renderings, whose upper bound is 0.389, 0.359 and 0.326 against
// SIMILARITY_THRESHOLD 0.9. Any other order keeps the short name and the pair matches exactly. Same
// inputs, opposite result, chosen by the network.
test('the merge outcome does not depend on the order the medias arrived in', async () => {
  const random = mulberry32(20260829)
  const outcomes = new Set<string>()

  for (let permutation = 0; permutation < 24; permutation++) {
    const run = `-p${permutation}`
    const component = MUSHOKU.map(([uri, titles]) => media(uri + run, shuffle(titles, random), SPRING_2026))
    const justwatch = media(`jw:tsmushokutensei${run}`, [['Mushoku Tensei', 0.2]], SPRING_2026)
    const handles =
      shuffle([
        { mediaUri: `mal:39535${run}`, handleUri: `mal:45576${run}` },
        { mediaUri: `mal:39535${run}`, handleUri: `anizip:15669${run}` },
      ], random)
        .map(handle =>
          random() < 0.5 ? { mediaUri: handle.handleUri, handleUri: handle.mediaUri } : handle
        )

    await upsertMedia(shuffle([...component, justwatch], random), handles)
    await fuzzyMergeMediaClusters(
      shuffle([
        await findAggregatedMedia(`mal:39535${run}`),
        await findAggregatedMedia(`jw:tsmushokutensei${run}`),
      ], random)
    )

    const merged = await findAggregatedMedia(`jw:tsmushokutensei${run}`)
    outcomes.add(merged.map(m => m.uri.replace(/-p\d+$/, '')).sort().join(' '))
  }

  expect([...outcomes]).toEqual([
    'anizip:15669 jw:tsmushokutensei mal:39535 mal:45576',
  ])
})

// The cap has to fall on the SET of titles, so the same six survive whichever member of the component
// happens to render them first.
test('the profile of a cluster is a function of its titles, not of their order', async () => {
  const random = mulberry32(4159)
  const cluster = MUSHOKU.map(([uri, titles]) => media(uri, titles, SPRING_2026))
  const expected = profileCluster(cluster)

  for (let permutation = 0; permutation < 50; permutation++) {
    const shuffled =
      shuffle(cluster, random)
        .map(member => ({ ...member, titles: shuffle(member.titles, random) }))
    const profile = profileCluster(shuffled)
    expect(profile.titles).toEqual(expected.titles)
    expect(profile.cacheKey).toEqual(expected.cacheKey)
  }

  // and the six keep the SHORT name of each script, which is the name a catalogue lists the show
  // under and the one JustWatch's 0.2 title has to meet. Ordering a tier by the title is prefix order
  // inside a script, so "mushoku tensei" sorts above its own longer forms and 無職転生 above its own,
  // and the cap falls on the long ones. Eight titles tie at 0.9 here, so two are genuinely dropped.
  expect(expected.titles).toContain('mushoku tensei')
  expect(expected.titles).toContain('無職転生')
})

// A verdict is computed against a snapshot taken before the first await, and the pass then awaits the
// matcher hundreds of times while extractor.ts keeps flushing its 50ms DataLoader batch, so a component
// judged season-less can carry a second cour by the time the link is applied. Here ani.zip is welded to
// the second cour after its profile was taken, exactly as that batch does it, and the season
// disagreement it now has with Crunchyroll's season 1 has to be read before the link goes in: there is
// no way back out of graph.link.
test('a verdict is applied only if the two components still agree when it lands', async () => {
  const crunchyroll = [media('cr:GRQ8VE29Y-s1', [['Mushoku Tensei', 0.5], ['Season 1', 0.5]], SPRING_2026)]
  const anizip = media('anizip:20001', [['Mushoku Tensei', 0.9]], SPRING_2026)
  const secondCour = media('mal:20002', [['Mushoku Tensei Part 2', 0.9]], SPRING_2026)

  await upsertMedia([anizip, ...crunchyroll], [])
  const staleProfile = await findAggregatedMedia('anizip:20001')

  await upsertMedia([secondCour], [{ mediaUri: 'anizip:20001', handleUri: 'mal:20002' }])
  await fuzzyMergeMediaClusters([staleProfile, crunchyroll])

  const cluster = await findAggregatedMedia('cr:GRQ8VE29Y-s1')
  expect(cluster.map(m => m.uri).sort()).toEqual(['cr:GRQ8VE29Y-s1'])
})

// A title match between a run and a show is a guess at CONTAINMENT, and the pass used to spend it as a
// union: crunchyroll's bare series id and tvmaze's bare show id both matched season 1's title and both
// entered its cluster, which is the door season 3 then walked through. A verdict is a verdict whatever
// the scopes are; what it is allowed to do depends on them.
const scoped = (m: any, scope: 'RUN' | 'CONTAINER') => ({ ...m, scope })

test('a run and a container that agree on title and year hang on an edge, never a union', async () => {
  const run = [scoped(media('anilist:7000', [['Mushoku Tensei', 0.8]], SPRING_2026), 'RUN')]
  const show = [scoped(media('tvmaze:7001', [['Mushoku Tensei', 0.3]], SPRING_2026), 'CONTAINER')]

  await upsertMedia([...run, ...show], [])
  await fuzzyMergeMediaClusters([run, show])

  const cluster = await findAggregatedMedia('anilist:7000')
  expect(cluster.map(m => m.uri), 'the run cluster is unchanged').toEqual(['anilist:7000'])
  expect(findPartOfMedia(cluster).map(m => m.uri), 'the match survives as containment').toEqual(['tvmaze:7001'])
  expect((await findAggregatedMedia('tvmaze:7001')).map(m => m.uri)).toEqual(['tvmaze:7001'])
})

test('two containers that agree on title and year union in the container space', async () => {
  const crunchyroll = [scoped(media('cr:7100', [['Mushoku Tensei', 0.5]], SPRING_2026), 'CONTAINER')]
  const tvmaze = [scoped(media('tvmaze:7101', [['Mushoku Tensei', 0.3]], SPRING_2026), 'CONTAINER')]

  await upsertMedia([...crunchyroll, ...tvmaze], [])
  await fuzzyMergeMediaClusters([crunchyroll, tvmaze])

  expect((await findAggregatedMedia('cr:7100')).map(m => m.uri).sort()).toEqual(['cr:7100', 'tvmaze:7101'])
  const listed = await findAllAggregatedMedia(['cr:7100', 'tvmaze:7101'])
  expect(listed.map(cluster => cluster.map(m => m.uri).sort()), 'one container cluster').toEqual([['cr:7100', 'tvmaze:7101']])
})

// A row unioned as a run and flipped CONTAINER since (the flip is sticky) leaves a MIXED cluster, and
// when the container member is its lowest uri it was also its key. The store answers a container uri
// in the container space, so re-reading the cluster by that key found a singleton show, and the
// link that followed was an edge from the other run to it: two runs that agreed on title and year
// could never union. The link goes through the lowest RUN member instead.
test('a mixed cluster keyed by its container member still unions with a run', async () => {
  await upsertMedia(
    [scoped(media('cr:7300', [['Mushoku Tensei', 0.5]], SPRING_2026), 'RUN'), scoped(media('kitsu:7301', [['Mushoku Tensei', 0.3]], SPRING_2026), 'RUN')],
    [{ mediaUri: 'kitsu:7301', handleUri: 'cr:7300' }]
  )
  await upsertMedia([scoped(media('cr:7300', [['Mushoku Tensei', 0.5]], SPRING_2026), 'CONTAINER')], [])
  const mixed = await findAggregatedMedia('kitsu:7301')
  expect(mixed.map(m => `${m.uri}=${m.scope}`).sort(), 'the setup: one mixed cluster keyed by the container').toEqual(['cr:7300=CONTAINER', 'kitsu:7301=RUN'])

  const mal = [scoped(media('mal:7302', [['Mushoku Tensei', 0.9]], SPRING_2026), 'RUN')]
  await upsertMedia(mal, [])
  await fuzzyMergeMediaClusters([mixed, mal])

  expect((await findAggregatedMedia('mal:7302')).map(m => m.uri).sort(), 'two runs that agree on title and year union')
    .toEqual(['cr:7300', 'kitsu:7301', 'mal:7302'])
})

// the control, or the two above are indistinguishable from a pass that links nothing
test('control: two runs that agree on title and year still union', async () => {
  const anilist = [scoped(media('anilist:7200', [['Mushoku Tensei', 0.8]], SPRING_2026), 'RUN')]
  const kitsu = [scoped(media('kitsu:7201', [['Mushoku Tensei', 0.3]], SPRING_2026), 'RUN')]

  await upsertMedia([...anilist, ...kitsu], [])
  await fuzzyMergeMediaClusters([anilist, kitsu])

  expect((await findAggregatedMedia('anilist:7200')).map(m => m.uri).sort()).toEqual(['anilist:7200', 'kitsu:7201'])
})

// TV_SHORT was added to MediaType for the search page's format filter, and AniList stopped collapsing
// it into TV. Every gate in fuzzy-merge.ts was calibrated on a corpus where those rows arrived spelled
// TV, so the new member must be invisible here: `mergeType` folds it back. Read straight off
// profileCluster, because the veto it feeds only misfires on clusters that no other source has typed,
// which is exactly the case a merge fixture would not happen to contain.
test('a short profiles for the merge exactly as the TV it used to be spelled', () => {
  const row = (type: string) => [{
    uri: 'anilist:1', origin: 'anilist', id: '1', type,
    categories: ['ANIME', 'SERIES'], startDate: SPRING_2026,
    titles: [{ language: 'ja', title: 'Aru Short', score: 0.7 }],
  }] as any

  const short = profileCluster(row('TV_SHORT'))
  const tv = profileCluster(row('TV'))

  expect([...short.types]).toEqual([...tv.types])
  expect([...short.formats]).toEqual([...tv.formats])
  // an empty work-kind set is the failure that matters: `differentWork` only vetoes when BOTH sides
  // name one, so a short profiling as nothing would stop refusing anything
  expect(short.types.size).toBe(1)
})

// STUB-374, behind `?store=legacy`. Mutation: read every title in `selectTitles` or the seasons, and the French title
// and the Chinese one's season join the profile.
test('a translation is in no cluster profile', () => {
  const profile = profileCluster([{
    uri: 'anizip:18886', origin: 'anizip', id: '18886', type: 'TV', categories: ['ANIME', 'SERIES'], startDate: SPRING_2026,
    titles: [
      { language: 'en', title: 'Frieren: Beyond Journey\'s End (2026)', score: 0.9 },
      { language: 'fr', title: 'Frieren saison 2', score: 0.09, class: 'TRANSLATED' },
      { language: 'zh-Hans', title: '葬送的芙莉莲 第二季', score: 0.09, class: 'TRANSLATED' },
    ],
  }] as any)

  expect(profile.titles).toHaveLength(1)
  expect([...profile.seasons]).toEqual([])
})
