import { expect, test } from 'vite-plus/test'

import type { Media } from '../../../../src/worker/store/types'

import { clusterAnomalies } from '../../../../src/worker/store/anomalies'

const anomaliesOf = (...uris: string[]) =>
  clusterAnomalies(uris.map(uri => ({
    uri,
    origin: uri.slice(0, uri.indexOf(':')),
    id: uri.slice(uri.indexOf(':') + 1),
    score: 0.5,
    episodeCount: null,
  }) as unknown as Media)).map(anomaly => anomaly.detail)

test('two ids of one origin in one cluster are an anomaly naming both', () => {
  expect(anomaliesOf('cr:G1', 'cr:G2', 'mal:1')).toEqual(['cr names G1 and G2, which are different runs to that source'])
})

test('a season id beside its own series id is one id at two precisions, a shared prefix is not', () => {
  expect(anomaliesOf('cr:G24H1N3MP', 'cr:G24H1N3MP-GS00374452')).toEqual([])
  expect(anomaliesOf('cr:G24H1N3MP', 'cr:G24H1N3MPX'))
    .toEqual(['cr names G24H1N3MP and G24H1N3MPX, which are different runs to that source'])
})

// One-way: reading the precision rule both ways drops every id here, so the shared parent would hide
// the two seasons it sits between.
test('two season ids are an anomaly even beside their shared series id', () => {
  expect(anomaliesOf('cr:G1', 'cr:G1-S1', 'cr:G1-S2')).toEqual(['cr names G1-S1 and G1-S2, which are different runs to that source'])
})

test('a repeated id is not a disagreement with itself', () => {
  expect(anomaliesOf('cr:G1', 'cr:G1')).toEqual([])
})
