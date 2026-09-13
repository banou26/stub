import type { ColumnType } from './ast'

import { CypherError } from './ast'

/**
 * The value model: what a column holds, what a row hands back, and how two values compare.
 *
 * THIS FILE IS THE CONTRACT WITH THE REST OF THE APP, and it is the one place where a wrong decision
 * is invisible rather than loud. Every caller in `src/worker/graph` was written against what
 * LadybugDB returns, so the shapes here are not a design: they are a specification taken from the
 * engine being replaced, measured column type by column type.
 *
 * | declared      | in a row                                                     |
 * | ------------- | ------------------------------------------------------------ |
 * | `STRING`      | `string` or null                                              |
 * | `INT64`       | `number`, integral. Never a BigInt and never a boxed Number.   |
 * | `DOUBLE`      | `number`                                                      |
 * | `BOOLEAN`     | primitive `boolean` or null                                   |
 * | `JSON`        | **the stored string**, byte for byte. Never parsed, never re-serialised. |
 * | `STRING[]`    | `string[]` or null, and an EMPTY LIST READS AS NULL            |
 * | `MAP`         | a plain object with `Object.prototype`                        |
 * | `TIMESTAMP`   | a `Date`                                                      |
 *
 * Two of those are load bearing in ways that look like bugs if you get them wrong.
 *
 * JSON IS TEXT. `plugins/writer.ts` decides whether a row changed by comparing `JSON.stringify` of
 * what it wants against the string the store gave back. An engine that parsed and re-serialised a
 * JSON column would produce equal objects with different text, so every pass would rewrite every row
 * forever while every test still passed.
 *
 * AN EMPTY LIST READS AS NULL. That is the engine's measured behaviour rather than a choice, and
 * three callers depend on it (`read.ts` `stringsOf`, the writer's comparison, and a `??` in
 * `plugins/profile.ts`). Storing `[]` and handing back `[]` would be the more obvious implementation
 * and would silently change what those three do.
 */

/** Anything a column can hold or an expression can evaluate to. */
export type Value =
  | string
  | number
  | boolean
  | null
  | Date
  | readonly Value[]
  | { readonly [key: string]: Value }

/** A row as it leaves the store: the RETURN aliases, in projection order, absent values as null. */
export type Row = Record<string, Value>

const isInteger = (value: number): boolean => Number.isFinite(value) && Math.floor(value) === value

/**
 * Put a value into a column, or refuse.
 *
 * REFUSING IS THE POINT. The engine being replaced throws `Binder exception` for a string in an INT64
 * column, `tests/unit/worker/graph/engine.test.ts` pins that, and `plugins/ingest.ts` relies on the
 * type system rather than checking every field itself. A store that coerced quietly would turn a
 * source sending `"twenty six"` into a silent zero somewhere downstream.
 *
 * Each value is typed ON ITS OWN. The engine infers an UNWIND struct field's type from the FIRST row
 * and then reinterprets later rows' bits against it, which corrupts a `0.5` following a `3`
 * (`plugins/ingest.ts:34-44` documents the workaround). Nothing here carries state between rows, so
 * that class of corruption cannot occur.
 */
export const coerce = (value: Value, type: ColumnType, where: string, statement: string): Value => {
  if (value === null || value === undefined) return null
  const refuse = (saw: string): never => {
    throw new CypherError('run', `Binder exception: ${where} expected ${describe(type)} but got ${saw}`, statement)
  }

  switch (type.kind) {
    case 'STRING':
      return typeof value === 'string' ? value : refuse(typeof value)
    case 'INT64': {
      if (typeof value === 'number') {
        return isInteger(value) && Number.isSafeInteger(value) ? value : refuse('a non integer')
      }
      // A STRING THAT IS SPELLED AS AN INTEGER is accepted, because the ingest and the writer both
      // hand integers over as text and cast them, and that convention predates this store.
      //
      // SPELLED, not "parses": `Number('1e+21')` is 1e21, which passes an integer test and is exactly
      // what the reference engine refuses with `Could not convert "1e+21" to INT64`. Accepting it
      // would take a value the old engine rejected loudly and write it silently, which is the wrong
      // direction for a replacement to be lenient in.
      // NO EXPONENT, and an integral decimal is fine. `'12.0'` is twelve and the app does hand those
      // over; `'1e+21'` is what the reference refuses with `Could not convert "1e+21" to INT64`, and
      // it slips through any test based on `Number()` because 1e21 passes an integer check.
      if (typeof value === 'string' && /^[+-]?\d+(\.0+)?$/.test(value.trim())) {
        const parsed = Number(value.trim())
        if (Number.isSafeInteger(parsed)) return parsed
      }
      return refuse(typeof value === 'string' ? `the string ${JSON.stringify(value)}` : typeof value)
    }
    case 'DOUBLE': {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
      return refuse(typeof value)
    }
    case 'BOOLEAN':
      return typeof value === 'boolean' ? value : refuse(typeof value)
    case 'JSON':
      // TEXT, exactly as handed in. See the file header: the writer compares this byte for byte.
      return typeof value === 'string' ? value : refuse(typeof value)
    case 'TIMESTAMP':
      if (value instanceof Date) return value
      if (typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? refuse('an unparseable timestamp') : parsed
      }
      return refuse(typeof value)
    case 'LIST': {
      if (!Array.isArray(value)) return refuse(typeof value)
      // AN EMPTY LIST IS NULL, in and out. See the file header.
      if (!value.length) return null
      return value.map(entry => coerce(entry, type.of, `${where} element`, statement))
    }
    case 'MAP': {
      if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date) {
        return refuse(typeof value)
      }
      const out: Record<string, Value> = {}
      for (const [key, entry] of Object.entries(value as Record<string, Value>)) {
        out[key] = coerce(entry, type.value, `${where}[${key}]`, statement)
      }
      return out
    }
  }
}

export const describe = (type: ColumnType): string => {
  switch (type.kind) {
    case 'LIST': return `${describe(type.of)}[]`
    case 'MAP': return `MAP(${describe(type.key)}, ${describe(type.value)})`
    default: return type.kind
  }
}

/**
 * Cypher equality, which is NOT `===`: null is never equal to anything, including null.
 *
 * A predicate over a null column is therefore UNKNOWN rather than false, which is what makes
 * `WHERE n.col = $x` skip the rows where `col` is unset instead of matching the ones where `$x` is
 * also null. Three-valued logic lives in the executor; this returns null for unknown so it can.
 */
export const equals = (a: Value, b: Value): boolean | null => {
  if (a === null || b === null) return null
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false
    return a.getTime() === b.getTime()
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (equals(a[index]!, b[index]!) !== true) return false
    }
    return true
  }
  if (typeof a === 'object' || typeof b === 'object') {
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
    const left = Object.entries(a as Record<string, Value>).sort(byKey)
    const right = Object.entries(b as Record<string, Value>).sort(byKey)
    if (left.length !== right.length) return false
    return left.every(([key, value], index) =>
      right[index]![0] === key && equals(value, right[index]![1]) === true)
  }
  return a === b
}

const byKey = (a: readonly [string, unknown], b: readonly [string, unknown]): number =>
  a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0

/**
 * String order as UTF-8 BYTES, which is what the engine sorts by and what JS does not do natively.
 *
 * JavaScript compares strings by UTF-16 code unit, and the two orders disagree on exactly one thing:
 * a surrogate pair (any character above U+FFFF) sorts by its leading surrogate, which sits in
 * U+D800..U+DFFF, BELOW the U+E000..U+FFFF block. In UTF-8 bytes those astral characters sort ABOVE
 * everything in the basic plane. Remapping the surrogate range above U+FFFF restores byte order.
 *
 * Measured: against a `TextEncoder` memcmp over 2,000 randomised pairs drawn from a pool including
 * U+FFFD, U+1F600, U+10FFFF and U+FFFF, this agrees 2000 of 2000. Plain `<` agrees 1895 of 2000, so
 * the control fails and the remap is what fixes it.
 */
export const compareStrings = (a: string, b: string): number => {
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = remap(a.charCodeAt(index))
    const right = remap(b.charCodeAt(index))
    if (left !== right) return left < right ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

const remap = (unit: number): number => (unit >= 0xd800 && unit <= 0xdfff ? unit + 0x10000 : unit)

/**
 * The ORDER BY comparator: ascending, with null LAST.
 *
 * Null sorting last ascending (and therefore first descending) is the engine's behaviour and several
 * reads lean on it. Ties are left to the caller's stable sort, which keeps natural order, and that is
 * what makes every ORDER BY in the app a total order without any statement changing.
 */
export const compareValues = (a: Value, b: Value): number => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === 'string' && typeof b === 'string') return compareStrings(a, b)
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? 1 : -1
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime() ? 0 : a.getTime() < b.getTime() ? -1 : 1
  }
  // mixed or structured: compare their text, so the order is at least total and deterministic
  return compareStrings(String(a), String(b))
}

/**
 * An EXPLICIT `cast(x AS T)`, which is deliberately more permissive than writing into a column.
 *
 * The two are different operations and conflating them was the first real divergence the differential
 * harness caught: the ingest writes `m.owned = cast(r.owned AS BOOLEAN)` with `r.owned` the STRING
 * `"true"`, because a batch parameter carries every field as text and the statement converts it. A
 * column assignment refusing a string is right (`values.ts` header); a cast refusing one makes the
 * convention the whole ingest is built on impossible.
 *
 * So `cast` parses, and `coerce` still refuses. A value that has been cast is then written by
 * `coerce` as the type it now is, which means the type check still happens, one step later.
 */
export const castValue = (value: Value, type: ColumnType, statement: string): Value => {
  if (value === null) return null
  if (typeof value === 'string') {
    switch (type.kind) {
      case 'BOOLEAN': {
        const text = value.trim().toLowerCase()
        if (text === 'true') return true
        if (text === 'false') return false
        throw new CypherError('run', `Conversion exception: Cast failed. Could not convert "${value}" to BOOLEAN.`, statement)
      }
      case 'INT64': case 'DOUBLE': case 'TIMESTAMP':
        // these already accept a well spelled string, and refuse the same way the reference does
        return coerce(value, type, 'cast', statement)
      default:
        return coerce(value, type, 'cast', statement)
    }
  }
  if (typeof value === 'number' && type.kind === 'STRING') return String(value)
  if (typeof value === 'boolean' && type.kind === 'STRING') return String(value)
  if (typeof value === 'number' && type.kind === 'INT64' && !Number.isInteger(value)) {
    // a cast TRUNCATES where an assignment refuses, which is what `cast(x AS INT64)` is usually for
    return Math.trunc(value)
  }
  return coerce(value, type, 'cast', statement)
}

