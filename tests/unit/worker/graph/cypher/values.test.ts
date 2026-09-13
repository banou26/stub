/**
 * The value model: what a column accepts, what it REFUSES, what shape a row hands back, and how two
 * values compare.
 *
 * WHY THIS FILE IS WORTH MORE THAN THE REST OF THE LIBRARY'S TESTS. Every other part of the store
 * fails loudly: a statement outside the subset is refused by name, a bad pattern throws. A wrong
 * decision here is SILENT. A JSON column that came back parsed and re-serialised still equals what
 * the writer wanted as an object, so the writer rewrites every row on every pass forever while every
 * test stays green. An empty list handed back as `[]` rather than null flips three callers that read
 * it through `??`. A comparator that is one pair wrong reorders a page nobody is looking at. So the
 * cases below are not "does coerce work": each one is a caller that would go wrong, named.
 *
 * THE REFUSAL MESSAGES ARE PART OF THE CONTRACT. `tests/unit/worker/graph/engine.test.ts` asserts
 * `/Binder exception/` against a STRING param in an INT64 column, which is the wording the engine
 * being replaced used. That test does not import this module, so nothing but the cases here connects
 * the string it matches to the string this file produces.
 *
 * THE COMPARATOR TRIAL AT THE BOTTOM IS THE CENTREPIECE. `compareStrings` exists because JS compares
 * by UTF-16 code unit and the store has to order by UTF-8 bytes, and the two disagree on astral
 * characters. The trial reproduces the measurement in the values.ts header, and it carries the
 * control that makes it mean anything: plain `<` has to DISAGREE on at least one pair. Without that,
 * the trial would pass just as happily over a pool of ASCII, where the two orders cannot be told
 * apart, and it would then survive the removal of the very remap it is there to protect.
 */
import { describe, expect, test } from 'vitest'

import type { ColumnType } from '../../../../../src/worker/graph/cypher/ast'
import type { Value } from '../../../../../src/worker/graph/cypher/values'

import { CypherError } from '../../../../../src/worker/graph/cypher/ast'
import {
  coerce, compareStrings, compareValues, describe as describeType, equals,
} from '../../../../../src/worker/graph/cypher/values'

const STRING: ColumnType = { kind: 'STRING' }
const INT64: ColumnType = { kind: 'INT64' }
const DOUBLE: ColumnType = { kind: 'DOUBLE' }
const BOOLEAN: ColumnType = { kind: 'BOOLEAN' }
const JSON_COLUMN: ColumnType = { kind: 'JSON' }
const TIMESTAMP: ColumnType = { kind: 'TIMESTAMP' }
const listOf = (of: ColumnType): ColumnType => ({ kind: 'LIST', of })
const mapOf = (key: ColumnType, value: ColumnType): ColumnType => ({ kind: 'MAP', key, value })

const STATEMENT = 'MERGE (m:Media {uri: $uri}) ON CREATE SET m.n = $n'

const put = (value: Value, type: ColumnType, where = 'm.n'): Value =>
  coerce(value, type, where, STATEMENT)

/** What `coerce` threw, or a sentinel, so a case can assert on the message without a try in its body. */
const refusal = (value: Value, type: ColumnType, where = 'm.n'): CypherError => {
  try {
    put(value, type, where)
  } catch (error) {
    if (error instanceof CypherError) return error
    throw error
  }
  throw new Error(`${where} accepted ${globalThis.JSON.stringify(value)} as ${describeType(type)}`)
}

// ---------------------------------------------------------------------------------------------
// coerce, per column type

describe('coerce', () => {
  test('a null goes into any column as null, whatever the column declared', () => {
    for (const type of [STRING, INT64, DOUBLE, BOOLEAN, JSON_COLUMN, TIMESTAMP, listOf(STRING), mapOf(STRING, INT64)]) {
      expect(put(null, type), describeType(type)).toBe(null)
    }
  })

  // The parameter type says `Value`, which has no `undefined` in it, and the body checks for it
  // anyway. It is right to: params arrive from callers as a plain object, and a key nobody set reads
  // as undefined at run time however the type is written. The cast is the only way to say that from
  // inside the type.
  test('a missing param arrives as undefined and lands as null rather than throwing', () => {
    expect(put(undefined as unknown as Value, STRING)).toBe(null)
    expect(put(undefined as unknown as Value, INT64)).toBe(null)
  })

  test('a STRING column takes a string and refuses a number, so a uri cannot silently become a count', () => {
    expect(put('mal:39535', STRING)).toBe('mal:39535')
    expect(put('', STRING)).toBe('')
    expect(refusal(39535, STRING).message).toContain('Binder exception')
    expect(refusal(39535, STRING).message).toContain('expected STRING but got number')
  })

  test('an INT64 column takes an integral number and hands back that same primitive number', () => {
    const stored = put(26, INT64)
    expect(stored).toBe(26)
    // the engine being replaced returned a BigInt in the browser and a boxed Number under node, and
    // engine.test.ts pins `typeof === 'number'` for exactly that reason
    expect(typeof stored).toBe('number')
    expect(put(0, INT64)).toBe(0)
    expect(put(-12, INT64)).toBe(-12)
  })

  test('an INT64 column takes a numeric string, which is how the ingest and the writer hand integers over', () => {
    expect(put('26', INT64)).toBe(26)
    expect(put('-12', INT64)).toBe(-12)
    // a trailing `.0` still names an integer, and the writer's cast produces exactly this
    expect(put('12.0', INT64)).toBe(12)
  })

  test('an INT64 column refuses a non integer rather than truncating it', () => {
    expect(refusal(0.5, INT64).message).toContain('Binder exception')
    expect(refusal(0.5, INT64).message).toContain('expected INT64 but got a non integer')
    expect(refusal(Number.NaN, INT64).message).toContain('a non integer')
    expect(refusal(Number.POSITIVE_INFINITY, INT64).message).toContain('a non integer')
    expect(refusal('12.5', INT64).message).toContain('the string "12.5"')
  })

  // This is the case engine.test.ts drives end to end: `SET t.n = $n` with `n: 'twenty six'`. It
  // asserts the statement and `/Binder exception/` are both in the message, and the statement gets
  // there through the `statement` argument rather than through the text.
  test('an INT64 column refuses a word, with Binder exception and the statement that engine.test.ts matches', () => {
    const error = refusal('twenty six', INT64)
    expect(error).toBeInstanceOf(CypherError)
    expect(error.message).toMatch(/Binder exception/)
    expect(error.message).toContain('the string "twenty six"')
    expect(error.statement).toBe(STATEMENT)
    // `run`, not `bind`: the statement is fine and the DATA is wrong, which is the distinction the
    // phase exists to draw
    expect(error.phase).toBe('run')
  })

  test('an INT64 column refuses an empty or blank string, which Number would have turned into 0', () => {
    expect(Number('')).toBe(0)
    expect(refusal('', INT64).message).toContain('the string ""')
    expect(refusal('   ', INT64).message).toContain('Binder exception')
  })

  test('a DOUBLE column takes both a number and a numeric string', () => {
    expect(put(0.5, DOUBLE)).toBe(0.5)
    expect(put(3, DOUBLE)).toBe(3)
    expect(put('0.5', DOUBLE)).toBe(0.5)
    expect(put('-1.25', DOUBLE)).toBe(-1.25)
  })

  test('a DOUBLE column refuses a word and an empty string, so a score cannot arrive as 0', () => {
    expect(refusal('very good', DOUBLE).message).toContain('Binder exception')
    expect(refusal('very good', DOUBLE).message).toContain('expected DOUBLE but got string')
    expect(refusal('', DOUBLE).message).toContain('expected DOUBLE but got string')
    expect(refusal(true, DOUBLE).message).toContain('expected DOUBLE but got boolean')
  })

  test('a BOOLEAN column takes a primitive boolean and refuses the string "true"', () => {
    expect(put(true, BOOLEAN)).toBe(true)
    expect(put(false, BOOLEAN)).toBe(false)
    // the writer round trips booleans through text (`travelled === 'true'`), so the string reaching a
    // column means a cast was forgotten, and taking it would hide that
    expect(refusal('true', BOOLEAN).message).toContain('Binder exception')
    expect(refusal('true', BOOLEAN).message).toContain('expected BOOLEAN but got string')
    expect(refusal(1, BOOLEAN).message).toContain('expected BOOLEAN but got number')
  })

  test('a TIMESTAMP column takes a Date and hands the same instant back', () => {
    const when = new Date('2026-09-13T12:00:00.000Z')
    const stored = put(when, TIMESTAMP)
    expect(stored).toBeInstanceOf(Date)
    expect((stored as Date).getTime()).toBe(when.getTime())
  })

  test('a TIMESTAMP column parses a string and refuses one that is not a date', () => {
    const stored = put('2026-09-13T12:00:00.000Z', TIMESTAMP)
    expect(stored).toBeInstanceOf(Date)
    expect((stored as Date).toISOString()).toBe('2026-09-13T12:00:00.000Z')
    expect(refusal('not a date', TIMESTAMP).message).toContain('an unparseable timestamp')
    expect(refusal(1757764800000, TIMESTAMP).message).toContain('expected TIMESTAMP but got number')
  })
})

// ---------------------------------------------------------------------------------------------
// JSON is TEXT

/** What a store that parsed a JSON column would hand back, which is the mutation every case controls for. */
const roundTrip = (text: string): string => globalThis.JSON.stringify(globalThis.JSON.parse(text))

/**
 * EVERY TEXT HERE HAS TO BE ONE A ROUND TRIP WOULD CHANGE, and that is not a detail.
 *
 * The first version of this block used `{"episodes":[1,2,3],"title":"Re:ZERO"}` and the two key orders
 * `{"a":1,"b":2}` / `{"b":2,"a":1}`, and a mutation that replaced the column with
 * `JSON.stringify(JSON.parse(value))` passed ALL 43 CASES. Those strings are fixed points of the
 * round trip: `JSON.stringify` emits no spaces and `JSON.parse` keeps key insertion order, so the
 * parse was invisible in every one of them. A test of "byte for byte" whose bytes cannot change is
 * decoration, so each case below pairs its assertion with the control that the round trip really
 * does alter that text.
 */
describe('a JSON column', () => {
  // `plugins/writer.ts` decides whether a row changed by comparing `JSON.stringify` of what it wants
  // against the string the store gave back. Parse and re-serialise and those two are equal objects
  // with different text, so every pass rewrites every row forever and nothing goes red.
  test('hands the stored string back byte for byte, whitespace included, because the writer diffs it as text', () => {
    const text = '{\n  "episodes": [1, 2, 3],\n  "title": "Re:ZERO"\n}'
    const stored = put(text, JSON_COLUMN)
    expect(stored).toBe(text)
    expect(typeof stored).toBe('string')
    // the control: this text is NOT a fixed point of a parse and re-serialise, so the assertion above
    // is about the column rather than about a string that could not have changed
    expect(roundTrip(text)).not.toBe(text)
  })

  test('keeps the spelling of a number, which a re-serialise would normalise away', () => {
    for (const text of ['{"score":1.0}', '{"score":1e3}', '{"score":0.50}']) {
      expect(put(text, JSON_COLUMN), text).toBe(text)
      expect(roundTrip(text), text).not.toBe(text)
    }
  })

  test('keeps an escape as it was written rather than as the character it names', () => {
    const text = '{"title":"Re:\\u007aERO"}'
    expect(put(text, JSON_COLUMN)).toBe(text)
    expect(roundTrip(text)).toBe('{"title":"Re:zERO"}')
  })

  test('keeps two spellings of the same object distinct, which is what makes the diff work at all', () => {
    const first = '{"a":1,"b":2}'
    const second = '{"a": 1, "b": 2}'
    const third = '{"b":2,"a":1}'
    expect(put(first, JSON_COLUMN)).toBe(first)
    expect(put(second, JSON_COLUMN)).toBe(second)
    expect(put(third, JSON_COLUMN)).toBe(third)
    expect(put(first, JSON_COLUMN)).not.toBe(put(second, JSON_COLUMN))
    expect(put(first, JSON_COLUMN)).not.toBe(put(third, JSON_COLUMN))
    // the control on the case above: as PARSED objects all three are the same value, so a store that
    // parsed would collapse them and report no change where the text differs. `JSON.parse` is typed
    // `any`, which is the one thing `equals` cannot take, so the cast is how the result is named.
    const parsed = [first, second, third].map(text => globalThis.JSON.parse(text) as Value)
    expect(equals(parsed[0]!, parsed[1]!)).toBe(true)
    expect(equals(parsed[0]!, parsed[2]!)).toBe(true)
  })

  // Proof that nothing parses, rather than proof that junk is welcome. A store that parsed would
  // throw a SyntaxError from somewhere with no statement attached, which is not even a refusal.
  test('never parses at all, so a text that is not JSON still goes in and comes back unchanged', () => {
    expect(put('not json', JSON_COLUMN)).toBe('not json')
    expect(put('', JSON_COLUMN)).toBe('')
    expect(() => globalThis.JSON.parse('not json')).toThrow()
  })

  test('refuses an object, so a caller that forgot to stringify is told rather than guessed at', () => {
    expect(refusal({ a: 1 }, JSON_COLUMN).message).toContain('Binder exception')
    expect(refusal({ a: 1 }, JSON_COLUMN).message).toContain('expected JSON but got object')
    expect(refusal(1, JSON_COLUMN).message).toContain('expected JSON but got number')
  })
})

// ---------------------------------------------------------------------------------------------
// the empty list

describe('a LIST column', () => {
  /**
   * AN EMPTY LIST READS AS NULL. This is the single least obvious line in values.ts and the one most
   * likely to be "fixed" by someone who reads `[]` in and `null` out as a bug.
   *
   * It is the measured behaviour of the engine being replaced, and three callers are written against
   * it rather than against the obvious version:
   * - `read.ts` `stringsOf` turns a null column into `[]` and says so in a comment above itself,
   * - `plugins/writer.ts` `canonical` and `readBack` both normalize an empty list to null so the
   *   desired set and the current set compare like with like,
   * - `plugins/profile.ts` reads claims and sayings through `?? []`.
   *
   * Hand `[]` back instead and none of those three go red: they each already handle a null, so the
   * suite stays green while the writer's diff starts seeing `[]` against null and rewriting rows.
   */
  test('an empty list reads back as null, which is the engine behaviour three callers are written against', () => {
    expect(put([], listOf(STRING))).toBe(null)
    expect(put([], listOf(INT64))).toBe(null)
    // and the thing that makes it matter: the writer compares an empty desired list against what the
    // column read back, and null against `[]` is a difference where there is none
    expect(equals(put([], listOf(STRING)), [])).toBe(null)
  })

  test('a non empty list keeps every entry and coerces each one to the element type', () => {
    expect(put(['a', 'b'], listOf(STRING))).toEqual(['a', 'b'])
    expect(put(['1', '2'], listOf(INT64))).toEqual([1, 2])
    expect(put(['x'], listOf(STRING))).toEqual(['x'])
  })

  test('a bad entry names the element in the refusal rather than the column alone', () => {
    const error = refusal(['1', 'two'], listOf(INT64), 'm.tags')
    expect(error.message).toContain('Binder exception')
    expect(error.message).toContain('m.tags element')
    expect(error.message).toContain('the string "two"')
  })

  test('a LIST column refuses a bare string, so a joined list cannot land unsplit', () => {
    // the writer travels lists as one separator joined STRING and splits them in the statement, so a
    // string arriving here means the split was skipped
    expect(refusal('a,b', listOf(STRING)).message).toContain('expected STRING[] but got string')
  })
})

// ---------------------------------------------------------------------------------------------
// MAP

describe('a MAP column', () => {
  test('produces a plain object carrying Object.prototype, not a null prototype bag', () => {
    const stored = put({ ep: '1', other: 2 }, mapOf(STRING, INT64))
    expect(stored).toEqual({ ep: 1, other: 2 })
    // a caller that reads a map does `row.map.x`, `'x' in row.map` and `JSON.stringify`: a null
    // prototype object survives the first two and loses `hasOwnProperty` and every Object method
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
  })

  test('an empty map stays an empty map, unlike an empty list', () => {
    expect(put({}, mapOf(STRING, INT64))).toEqual({})
    expect(put({}, mapOf(STRING, INT64))).not.toBe(null)
  })

  test('a bad entry names the key in the refusal', () => {
    const error = refusal({ ep: 'one' }, mapOf(STRING, INT64), 'c.slots')
    expect(error.message).toContain('Binder exception')
    expect(error.message).toContain('c.slots[ep]')
    expect(error.message).toContain('the string "one"')
  })

  test('a MAP column refuses an array and a Date, both of which typeof calls an object', () => {
    expect(refusal(['a'], mapOf(STRING, INT64)).message).toContain('Binder exception')
    expect(refusal(new Date(), mapOf(STRING, INT64)).message).toContain('Binder exception')
    expect(refusal('ep=1', mapOf(STRING, INT64)).message).toContain('expected MAP(STRING, INT64) but got string')
  })
})

// ---------------------------------------------------------------------------------------------
// equals

describe('equals', () => {
  /**
   * Null is never equal to anything, INCLUDING null, and the return is null rather than false because
   * the executor needs to tell unknown from no. That is what makes `WHERE n.col = $x` skip the rows
   * where `col` is unset instead of matching the ones where `$x` happens to be unset too.
   */
  test('null is equal to nothing at all, including null, and says unknown rather than no', () => {
    expect(equals(null, null)).toBe(null)
    expect(equals(null, 1)).toBe(null)
    expect(equals(1, null)).toBe(null)
    expect(equals(null, '')).toBe(null)
    expect(equals(null, false)).toBe(null)
    // the control that separates unknown from no: a real mismatch answers false, so a caller reading
    // `=== true` and a caller reading `=== false` do not see the same thing for the two cases
    expect(equals(1, 2)).toBe(false)
  })

  test('two values of different types are not equal, so a numeric string never matches its number', () => {
    expect(equals(1, '1')).toBe(false)
    expect(equals(true, 1)).toBe(false)
    expect(equals('true', true)).toBe(false)
    expect(equals([1], 1)).toBe(false)
    expect(equals({ a: 1 }, [1])).toBe(false)
    expect(equals(new Date(0), 0)).toBe(false)
  })

  test('scalars of the same type compare by value', () => {
    expect(equals('mal:1', 'mal:1')).toBe(true)
    expect(equals('mal:1', 'mal:2')).toBe(false)
    expect(equals(26, 26)).toBe(true)
    expect(equals(false, false)).toBe(true)
    expect(equals(true, false)).toBe(false)
  })

  test('two Dates compare by instant, not by identity', () => {
    expect(equals(new Date('2026-09-13T00:00:00Z'), new Date('2026-09-13T00:00:00Z'))).toBe(true)
    expect(equals(new Date(0), new Date(1))).toBe(false)
    expect(equals(new Date(0), '1970-01-01T00:00:00.000Z')).toBe(false)
  })

  test('lists compare by value and by order, one level and nested', () => {
    expect(equals(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(equals(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(equals(['a'], ['a', 'b'])).toBe(false)
    expect(equals([['a'], ['b']], [['a'], ['b']])).toBe(true)
    expect(equals([{ a: 1 }], [{ a: 1 }])).toBe(true)
    expect(equals([], [])).toBe(true)
  })

  // A null entry makes the whole list NOT equal rather than unknown, because the loop reads each
  // entry as `!== true`. It is worth stating because it is the one place three valued logic stops:
  // a list with a null in it answers no, and the executor will treat that as a real mismatch.
  test('a null inside a list answers no rather than unknown', () => {
    expect(equals([null], [null])).toBe(false)
    expect(equals([1, null], [1, null])).toBe(false)
  })

  test('maps compare by value whatever order their keys were built in', () => {
    expect(equals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(equals({ a: 1 }, { a: 2 })).toBe(false)
    expect(equals({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(equals({ a: 1 }, { b: 1 })).toBe(false)
    expect(equals({ a: { b: ['c'] } }, { a: { b: ['c'] } })).toBe(true)
    expect(equals({}, {})).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// compareValues

const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0)

describe('compareValues', () => {
  test('null sorts LAST ascending, which is the order several reads lean on', () => {
    expect(sign(compareValues(null, 1))).toBe(1)
    expect(sign(compareValues(1, null))).toBe(-1)
    expect(sign(compareValues(null, null))).toBe(0)
    expect([3, null, 1, null, 2].sort(compareValues)).toEqual([1, 2, 3, null, null])
    // and therefore FIRST descending, which is what a caller gets by reversing the comparator
    expect([3, null, 1].sort((a, b) => compareValues(b, a))).toEqual([null, 3, 1])
  })

  test('numbers sort numerically rather than as text, so 9 comes before 10', () => {
    expect([10, 9, 100, -1].sort(compareValues)).toEqual([-1, 9, 10, 100])
    // the control: the same array under the default sort, which is the bug this comparator avoids
    expect([10, 9, 100, -1].sort()).toEqual([-1, 10, 100, 9])
  })

  test('booleans sort false before true', () => {
    expect(sign(compareValues(false, true))).toBe(-1)
    expect(sign(compareValues(true, false))).toBe(1)
    expect(sign(compareValues(true, true))).toBe(0)
    expect([true, false, true].sort(compareValues)).toEqual([false, true, true])
  })

  test('Dates sort by instant', () => {
    const early = new Date('2026-01-01T00:00:00Z')
    const late = new Date('2026-09-13T00:00:00Z')
    expect(sign(compareValues(early, late))).toBe(-1)
    expect(sign(compareValues(late, early))).toBe(1)
    expect(sign(compareValues(early, new Date(early.getTime())))).toBe(0)
  })

  test('strings sort by the UTF-8 order of compareStrings, astral characters included', () => {
    expect(['b', 'a', 'A'].sort(compareValues)).toEqual(['A', 'a', 'b'])
    expect(sign(compareValues('\u{FFFF}', '\u{1F600}'))).toBe(-1)
    // the control: JS's own comparison puts them the other way round, so this is reading
    // compareStrings and not `<`
    expect(sign('\u{FFFF}' < '\u{1F600}' ? -1 : 1)).toBe(1)
  })

  test('a mixed column still orders deterministically and antisymmetrically', () => {
    const pool: Value[] = [1, 'a', true, null, new Date(0), ['b'], { k: 1 }, 'mal:1', 0]
    for (const a of pool) {
      for (const b of pool) {
        // summed rather than negated, because `-0` and `0` are different under Object.is and a
        // comparator that answers 0 both ways is the case this is checking
        expect(sign(compareValues(a, b)) + sign(compareValues(b, a)), `${String(a)} against ${String(b)}`)
          .toBe(0)
      }
    }
    const first = [...pool].sort(compareValues).map(String)
    const second = [...pool].reverse().sort(compareValues).map(String)
    expect(second).toEqual(first)
  })
})

// ---------------------------------------------------------------------------------------------
// the comparator trial

/**
 * A seeded PRNG (mulberry32), because an unseeded shuffle makes this a FLAKE, and a flake in a trial
 * whose whole job is to catch a regression reads as noise and gets retried away.
 */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The pool the values.ts header names, plus the ordinary things a column actually holds.
 *
 * U+FFFD and U+FFFF are the point: they sit at the TOP of the basic plane, above the surrogate
 * block, so an astral character compares below them by code unit and above them by byte. Without at
 * least one of them in the pool the two orders cannot disagree and the trial proves nothing.
 */
const ATOMS = [
  '', 'a', 'A', 'z', 'Z', '0', '9', ':', '-', ' ',
  'mal:39535', 'mal:1', 'anilist:21', 'Re:ZERO', 're:zero',
  'é', 'ß', 'ア', '漢', 'ก',
  '\u{E000}', '\u{FFFD}', '\u{FFFF}',
  '\u{1F600}', '\u{1F4A9}', '\u{10FFFF}', '\u{20000}',
]

const encoder = new TextEncoder()

/** The thing `compareStrings` claims to be: a memcmp over the UTF-8 encoding. */
const memcmp = (a: string, b: string): number => {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1
}

/** What JS gives you for free, which is the control: it is wrong, and the trial has to show it. */
const plain = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const PAIRS = 2000

const trial = () => {
  const random = mulberry32(0x5eed)
  const pick = (): string => {
    let out = ''
    for (let part = 0, parts = 1 + Math.floor(random() * 3); part < parts; part += 1) {
      out += ATOMS[Math.floor(random() * ATOMS.length)]!
    }
    return out
  }

  // a failure has to name the pair in code points: the strings themselves are unprintable here, and
  // a diff of two invisible characters is what makes this class of bug expensive to read
  const codePoints = (text: string): string =>
    [...text].map(character => character.codePointAt(0)!.toString(16)).join(' ')
  const shown = (left: string, right: string): string => `${codePoints(left)} vs ${codePoints(right)}`

  let agreed = 0
  let plainAgreed = 0
  const disagreed: string[] = []
  const plainDisagreed: string[] = []
  for (let index = 0; index < PAIRS; index += 1) {
    const a = pick()
    const b = pick()
    const truth = sign(memcmp(a, b))
    if (sign(compareStrings(a, b)) === truth) agreed += 1
    else disagreed.push(shown(a, b))
    if (sign(plain(a, b)) === truth) plainAgreed += 1
    else plainDisagreed.push(shown(a, b))
  }
  return { agreed, disagreed, plainAgreed, plainDisagreed }
}

describe('compareStrings', () => {
  /**
   * The trial the values.ts header cites, reproduced. Measured here on 2026-09-13, seed 0x5eed:
   * `compareStrings` agrees 2000 of 2000 and plain `<` agrees 1925 of 2000, so 75 pairs separate the
   * two orders. The exact control figure moves with the pool and the seed (the header's own run
   * measured 1895 of 2000), which is why only the 2000 of 2000 is asserted as a number while the
   * control is asserted as "at least one".
   */
  test('agrees with a UTF-8 memcmp on all 2000 randomised pairs, where plain < does not', () => {
    const { agreed, disagreed, plainAgreed, plainDisagreed } = trial()

    expect(disagreed.slice(0, 5), 'pairs where compareStrings and a memcmp disagree').toEqual([])
    expect(agreed).toBe(PAIRS)

    // THE CONTROL, and the reason this test is not decoration. A pool that cannot tell UTF-16 order
    // from UTF-8 order would pass the assertion above with the remap deleted. This says the pool CAN
    // tell them apart, so the agreement above is a fact about compareStrings rather than about the
    // strings it was handed.
    expect(
      plainAgreed,
      `plain < agreed on ${plainAgreed} of ${PAIRS}, first disagreement ${plainDisagreed[0] ?? 'none'}`,
    ).toBeLessThan(PAIRS)
  })

  test('every ordered pair of the pool itself agrees with a memcmp, not just the sampled ones', () => {
    const wrong: string[] = []
    for (const a of ATOMS) {
      for (const b of ATOMS) {
        if (sign(compareStrings(a, b)) !== sign(memcmp(a, b))) wrong.push(`${a} vs ${b}`)
      }
    }
    expect(wrong).toEqual([])
  })

  /**
   * The one disagreement the remap exists for, stated without a PRNG so a failure names the cause.
   *
   * A character above U+FFFF is a surrogate PAIR in JS, and its leading unit sits in U+D800..U+DFFF,
   * which is BELOW U+E000..U+FFFF. In UTF-8 those same characters are four bytes starting 0xF0 and
   * sort above every three byte character in the basic plane.
   */
  test('an astral character sorts above U+FFFF, which is exactly where plain < is wrong', () => {
    expect(sign(compareStrings('\u{FFFF}', '\u{1F600}'))).toBe(-1)
    expect(sign(memcmp('\u{FFFF}', '\u{1F600}'))).toBe(-1)
    expect(plain('\u{FFFF}', '\u{1F600}')).toBe(1)

    expect(sign(compareStrings('\u{FFFD}', '\u{10FFFF}'))).toBe(-1)
    expect(sign(memcmp('\u{FFFD}', '\u{10FFFF}'))).toBe(-1)
    expect(plain('\u{FFFD}', '\u{10FFFF}')).toBe(1)

    expect(sign(compareStrings('\u{E000}', '\u{1F600}'))).toBe(-1)
    expect(plain('\u{E000}', '\u{1F600}')).toBe(1)
  })

  test('two astral characters order by code point among themselves', () => {
    expect(sign(compareStrings('\u{1F4A9}', '\u{1F600}'))).toBe(-1)
    expect(sign(memcmp('\u{1F4A9}', '\u{1F600}'))).toBe(-1)
    expect(sign(compareStrings('\u{10FFFF}', '\u{1F600}'))).toBe(1)
    expect(sign(memcmp('\u{10FFFF}', '\u{1F600}'))).toBe(1)
  })

  test('a prefix sorts before the string that extends it, and equal strings tie', () => {
    expect(sign(compareStrings('', 'a'))).toBe(-1)
    expect(sign(compareStrings('mal:1', 'mal:10'))).toBe(-1)
    expect(sign(compareStrings('mal:39535', 'mal:39535'))).toBe(0)
    expect(sign(compareStrings('', ''))).toBe(0)
    expect(sign(compareStrings('\u{1F600}', '\u{1F600}a'))).toBe(-1)
  })

  test('ordinary uris sort the way a page expects, uppercase before lowercase', () => {
    expect(['mal:9', 'mal:10', 'mal:1', 'anilist:21'].sort(compareStrings))
      .toEqual(['anilist:21', 'mal:1', 'mal:10', 'mal:9'])
    expect(['b', 'A', 'a', 'B'].sort(compareStrings)).toEqual(['A', 'B', 'a', 'b'])
  })
})
