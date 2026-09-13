/**
 * The differential harness, and above all the proof that it can FAIL.
 *
 * This file exists before any of the replacement engine does, on purpose. A harness that compares two
 * engines is the only practical way to establish that a query engine written from scratch agrees with
 * the one it replaces, and a harness nobody has watched report a difference is an assumption wearing
 * a test's clothes. So every case here plugs in a backend that is WRONG IN ONE NAMED WAY and asserts
 * the mode catches exactly that.
 *
 * The comparison is a MULTISET rather than an ordered list unless the statement says `ORDER BY`,
 * which is measured rather than assumed: LadybugDB returns tied rows in 4 to 15 distinct orders over
 * 20 to 40 runs of the same statement on the same graph. Comparing order would report differences
 * that are not differences, and nothing in the app can be depending on that order either.
 */
import { describe, expect, test } from 'vitest'

import type { Backend } from '../../../../src/worker/graph/backend'
import type { GraphRow } from '../../../../src/worker/graph/engine'

import { canonicalRow, diffQuery, rowsDiffer } from '../../../../src/worker/graph/backend'

/** A backend that answers from a table of statement to rows, so a case can make it wrong on purpose. */
const fake = (name: string, answers: (cypher: string) => GraphRow[] | Error): Backend => ({
  name,
  version: name,
  close: async () => {},
  query: async cypher => {
    const answer = answers(cypher)
    if (answer instanceof Error) throw answer
    return answer
  },
})

const rows = (...values: GraphRow[]) => values

describe('canonicalRow', () => {
  test('ignores key order, because two engines may build a row either way', () => {
    expect(canonicalRow({ a: 1, b: 2 })).toBe(canonicalRow({ b: 2, a: 1 }))
  })

  // the control: the whole point of a canonical form is that it still separates things that differ
  test('separates a number from the string of that number', () => {
    expect(canonicalRow({ a: 1 })).not.toBe(canonicalRow({ a: '1' }))
  })

  test('reads a BigInt and a number of the same value alike, which is what toPlain did', () => {
    expect(canonicalRow({ a: 3n })).toBe(canonicalRow({ a: 3 }))
  })

  test('separates null from absent-but-present and from an empty string', () => {
    expect(canonicalRow({ a: null })).not.toBe(canonicalRow({ a: '' }))
    expect(canonicalRow({ a: null })).toBe(canonicalRow({ a: undefined }))
  })

  // a JSON column is TEXT, and writer.ts decides whether a row moved by comparing that text, so two
  // spellings of the same object must NOT compare equal here
  test('compares a JSON column byte for byte', () => {
    expect(canonicalRow({ raw: '{"a":1,"b":2}' })).not.toBe(canonicalRow({ raw: '{"b":2,"a":1}' }))
  })
})

describe('rowsDiffer', () => {
  const READ = 'MATCH (m:Media) RETURN m.uri AS uri'
  const SORTED = 'MATCH (m:Media) RETURN m.uri AS uri ORDER BY uri'

  test('a different order is NOT a difference without ORDER BY', () => {
    expect(rowsDiffer(READ, rows({ uri: 'a' }, { uri: 'b' }), rows({ uri: 'b' }, { uri: 'a' })))
      .toBeUndefined()
  })

  // NOR WITH ONE, which is the uncomfortable half. The reference has no tie order to reproduce: the
  // same statement over the same graph returned 4 to 15 distinct orders across 20 to 40 runs, so a
  // comparison in order reports noise on every tie. Ordering is covered instead by
  // cypher/conformance.test.ts, which runs against BOTH engines over unambiguous sort keys.
  test('nor with one, because the reference has no order worth comparing against', () => {
    expect(rowsDiffer(SORTED, rows({ uri: 'a' }, { uri: 'b' }), rows({ uri: 'b' }, { uri: 'a' })))
      .toBeUndefined()
  })

  // and the same reasoning one level down: a collect gathers in match order, which is equally unstable
  test('a list inside a row is compared by content, not by the order it was gathered in', () => {
    expect(rowsDiffer(READ, rows({ uris: ['a', 'b'] }), rows({ uris: ['b', 'a'] })))
      .toBeUndefined()
  })

  test('but a list with different CONTENT is still caught, which is the control', () => {
    expect(rowsDiffer(READ, rows({ uris: ['a', 'b'] }), rows({ uris: ['a', 'c'] })))
      .toContain('row appears')
  })

  test('a missing row is caught', () => {
    expect(rowsDiffer(READ, rows({ uri: 'a' }, { uri: 'b' }), rows({ uri: 'a' })))
      .toContain('row count 2 against 1')
  })

  // the case a set comparison would miss: same rows, same count, different MULTIPLICITY
  test('a duplicated row is caught, which a set comparison would not see', () => {
    expect(rowsDiffer(READ, rows({ uri: 'a' }, { uri: 'a' }), rows({ uri: 'a' }, { uri: 'b' })))
      .toContain('appears 2 time(s) against 1')
  })

  test('two runs of the same rows agree', () => {
    expect(rowsDiffer(READ, rows({ uri: 'a' }, { uri: 'b' }), rows({ uri: 'a' }, { uri: 'b' })))
      .toBeUndefined()
  })
})

describe('diff mode', () => {
  const READ = 'MATCH (m:Media) RETURN m.uri AS uri'

  test('agreeing engines answer the reference rows', async () => {
    const answer = () => rows({ uri: 'mal:1' })
    const out = await diffQuery(fake('ref', answer), fake('cand', answer), READ)
    expect(out).toEqual(rows({ uri: 'mal:1' }))
  })

  // CHECK THE CHECKER. Each of these plugs in a candidate wrong in one way and asserts diff mode says
  // so. Without them this file asserts that two identical things are identical, which is free.
  test('CONTROL: a candidate that drops a row is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ uri: 'a' }, { uri: 'b' })),
      fake('cand', () => rows({ uri: 'a' })),
      READ
    )).rejects.toThrow(/graph diff: row count 2 against 1/)
  })

  test('CONTROL: a candidate that changes a value is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ uri: 'a', n: 1 })),
      fake('cand', () => rows({ uri: 'a', n: 2 })),
      READ
    )).rejects.toThrow(/graph diff: row appears/)
  })

  test('CONTROL: a candidate that returns a string where the reference returns a number is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ n: 1 })),
      fake('cand', () => rows({ n: '1' })),
      READ
    )).rejects.toThrow(/graph diff/)
  })

  test('CONTROL: a candidate that drops one of two rows with the same shape is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ uri: 'a' }, { uri: 'a' })),
      fake('cand', () => rows({ uri: 'a' })),
      READ
    )).rejects.toThrow(/graph diff: row count 2 against 1/)
  })

  test('CONTROL: a candidate that accepts what the reference refuses is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => new Error('Binder exception: no such property')),
      fake('cand', () => rows()),
      READ
    )).rejects.toThrow(/ladybug|ref.*threw/)
  })

  test('CONTROL: a candidate that refuses what the reference accepts is caught', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ uri: 'a' })),
      fake('cand', () => new Error('not supported: OPTIONAL MATCH')),
      READ
    )).rejects.toThrow(/cand threw and ref did not/)
  })

  // BOTH REFUSING IS AGREEMENT, and the reference's refusal is rethrown rather than swallowed. This
  // asserted `toEqual([])` until 2026-09-13, which meant diff mode turned every refused statement
  // into an empty success: the app behaved differently under the harness than under either engine,
  // and every assertion about a refusal passed for the wrong reason.
  test('both refusing is agreement, and the reference refusal is what the caller sees', async () => {
    await expect(diffQuery(
      fake('ref', () => new Error('the reference wording')),
      fake('cand', () => new Error('nope, differently worded')),
      READ
    )).rejects.toThrow('the reference wording')
  })

  test('the message names the statement and its params, or a divergence is unactionable', async () => {
    await expect(diffQuery(
      fake('ref', () => rows({ uri: 'a' })),
      fake('cand', () => rows()),
      'MATCH (m:Media {uri: $uri}) RETURN m.uri AS uri',
      { uri: 'mal:39535' }
    )).rejects.toThrow(/mal:39535/)
  })
})
