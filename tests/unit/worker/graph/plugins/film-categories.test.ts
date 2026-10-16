import { expect, test } from 'vite-plus/test'

import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'

const member = (uri: string, categories: string[]) => {
  const origin = uri.slice(0, uri.indexOf(':'))
  const raw = { uri, origin, categories }
  return { uri, origin, id: uri.slice(origin.length + 1), owned: true, score: 1, raw, fieldSeq: {} }
}

const categoriesOf = (...members: ReturnType<typeof member>[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
}).categories

test('a film Simkl files under movies outvotes JustWatch\'s animation tag', () => {
  expect(categoriesOf(member('jw:309774', ['ANIME', 'MOVIE']), member('simkl:1634342', ['MOVIE']))).toEqual(['MOVIE'])
})

test('an anime catalogue on the card keeps it anime, whatever Simkl files the film under', () => {
  for (const catalogue of ['anilist:199', 'mal:199', 'kitsu:176', 'anidb:112', 'offline:mal-199']) {
    expect(categoriesOf(member(catalogue, ['ANIME', 'MOVIE']), member('simkl:9001', ['MOVIE']))).toContain('ANIME')
  }
})
