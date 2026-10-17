import { expect, test } from 'vite-plus/test'

import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'

const member = (uri: string, score: number, startDate: string, endDate?: string) => {
  const origin = uri.slice(0, uri.indexOf(':'))
  const raw = { uri, origin, startDate, endDate, categories: ['MOVIE'] }
  return { uri, origin, id: uri.slice(origin.length + 1), owned: true, score, raw, fieldSeq: {} }
}

const aggregate = (...members: ReturnType<typeof member>[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
})

const DAY = 'Fri, 15 Oct 2027 00:00:00 GMT'

// MAL (0.9) knowing only the month or year kept AniList's (0.8) day off a film, which then read
// "Releases Oct 2027" and held Play until November
test('a day another member names wins over a higher-scored year or month it falls in, under its own rule', () => {
  for (const partial of ['2027-10', '2027']) {
    const media = aggregate(member('mal:1', 0.9, partial), member('anilist:1', 0.8, DAY))
    expect(media.startDate, partial).toBe(DAY)
    expect(media.provenance.find(entry => entry.field === 'startDate'), partial).toMatchObject({ uri: 'anilist:1', rule: 'day-in-partial' })
  }
  // IMDb's search knows only the year, Simkl the day (both 0.3, so the uri decides which is first)
  expect(aggregate(member('omdb:tt1', 0.3, '2027'), member('simkl:1', 0.3, '2027-12-17T00:00:00Z')).startDate).toBe('2027-12-17T00:00:00Z')
  expect(aggregate(member('mal:1', 0.9, '2027-10'), member('anilist:1', 0.8, 'Mon, 15 Nov 2027 00:00:00 GMT')).startDate, 'a day in another month').toBe('2027-10')
  const first = aggregate(member('mal:1', 0.9, '2027-10-20'), member('anilist:1', 0.8, DAY))
  expect(first.startDate, 'the control: a day from the first member stays').toBe('2027-10-20')
  expect(first.provenance.find(entry => entry.field === 'startDate')!.rule).toBe('first-non-null')
})

// read live 2026-10-17: kitsu's `unreleased` rows end their month or year (2027-01-31, 2027-12-31) and
// its `upcoming` ones also start it (2027-01-01, 2026-12-01)
test('kitsu\'s day does not stand in for a year or a month, while another source\'s first or last of a month does', () => {
  for (const [partial, placeholder] of [['2027-10', '2027-10-01'], ['2027-10', '2027-10-31'], ['2027', '2027-12-31'], ['2027', '2027-01-31'], ['2027', '2027-01-01'], ['2027-10', '2027-10-15']] as const) {
    expect(aggregate(member('mal:1', 0.9, partial), member('kitsu:1', 0.3, placeholder)).startDate, placeholder).toBe(partial)
  }
  // AniList's complete FuzzyDate, which `airedDate` writes as that day's midnight UTC
  for (const day of ['Fri, 01 Oct 2027 00:00:00 GMT', 'Sun, 31 Oct 2027 00:00:00 GMT']) {
    expect(aggregate(member('mal:1', 0.9, '2027-10'), member('anilist:1', 0.8, day)).startDate, day).toBe(day)
  }
  expect(aggregate(member('mal:1', 0.9, '2027'), member('anilist:1', 0.8, 'Fri, 01 Jan 2027 00:00:00 GMT')).startDate).toBe('Fri, 01 Jan 2027 00:00:00 GMT')
  // AniList's schedule airing it at 00:30 JST on Oct 2, still Oct 1 in UTC
  expect(aggregate(member('mal:1', 0.9, '2027-10'), member('anilist:1', 0.8, 'Fri, 01 Oct 2027 15:30:00 GMT')).startDate).toBe('Fri, 01 Oct 2027 15:30:00 GMT')
})

test('a month inside a higher-scored year wins, and a day inside that month after it', () => {
  expect(aggregate(member('mal:1', 0.9, '2027'), member('anilist:1', 0.8, '2027-10')).startDate).toBe('2027-10')
  expect(aggregate(member('mal:1', 0.9, '2027'), member('anilist:1', 0.8, '2027-10'), member('simkl:1', 0.3, '2027-10-17T00:00:00Z')).startDate).toBe('2027-10-17T00:00:00Z')
  expect(aggregate(member('mal:1', 0.9, '2027-10'), member('anilist:1', 0.8, '2027')).startDate, 'a year does not refine a month').toBe('2027-10')
  expect(aggregate(member('mal:1', 0.9, '2027'), member('anilist:1', 0.8, '2028-10')).startDate, 'nor a month of another year').toBe('2027')
  const same = aggregate(member('mal:1', 0.9, '2027'), member('anilist:1', 0.8, '2027'))
  expect(same.provenance.find(entry => entry.field === 'startDate'), 'nor the same year').toMatchObject({ uri: 'mal:1', rule: 'first-non-null' })
})

test('an end known only to its year takes a day inside it the same way', () => {
  const media = aggregate(member('mal:1', 0.9, '2027-01', '2027'), member('anilist:1', 0.8, '2027-01-08', '2027-03-26'))
  expect([media.startDate, media.endDate]).toEqual(['2027-01-08', '2027-03-26'])
})
