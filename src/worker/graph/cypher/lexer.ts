/**
 * The token stream the parser reads, and the one function that produces it.
 *
 * KEYWORDS ARE NOT RESERVED HERE, which is why this file knows none of them. The schema declares
 * columns called `key`, `by`, `number`, `status` and `from`, and `MATCH (n:Slot) RETURN n.number`
 * has to mean the column. So every word arrives as one `word` token carrying both its source
 * spelling and an upper cased copy, and only the parser, which knows what it is looking at, decides
 * whether a word is a keyword in that position.
 *
 * `//` LINE COMMENTS SIT INSIDE STATEMENTS, not only around them: every DDL literal in
 * `src/worker/graph/schema.ts` documents its columns that way, so skipping them is a requirement and
 * not a convenience. A statement that reached the engine with a comment in it is the normal case.
 */
import { CypherError } from './ast'

export type TokenKind = 'word' | 'number' | 'string' | 'param' | 'symbol' | 'end'

/**
 * One token.
 *
 * `text` is the token's own content: an identifier or keyword as written, a number as written, a
 * string's DECODED body, a parameter name without its `$`, or the punctuation symbol itself.
 * `start` and `end` bound the raw source slice, which is what gives an un-aliased projection its
 * column name.
 */
export type Token = {
  readonly kind: TokenKind
  readonly text: string
  /** `text` upper cased once, so a keyword test is one string comparison. Only a word needs it. */
  readonly upper: string
  readonly start: number
  readonly end: number
}

/**
 * Splits one statement into tokens, or refuses it with `phase: 'parse'`.
 *
 * The only refusals here are about characters: an unterminated string or comment, and a character no
 * token can start with. Everything about shape is the parser's.
 */
export const tokenize = (statement: string): Token[] => {
  const tokens: Token[] = []
  let index = 0

  const fail = (message: string): never => {
    throw new CypherError('parse', `${message} at ${index}`, statement)
  }

  while (index < statement.length) {
    const char = statement[index]!

    if (WHITESPACE.test(char)) {
      index += 1
      continue
    }

    if (char === '/' && statement[index + 1] === '/') {
      while (index < statement.length && statement[index] !== '\n') index += 1
      continue
    }

    if (char === '/' && statement[index + 1] === '*') {
      const close = statement.indexOf('*/', index + 2)
      if (close < 0) fail('an unterminated block comment')
      index = close + 2
      continue
    }

    const start = index

    if (char === "'" || char === '"') {
      index += 1
      let text = ''
      for (;;) {
        if (index >= statement.length) fail(`an unterminated string that opened at ${start}`)
        const inner = statement[index]!
        if (inner === char) {
          index += 1
          break
        }
        if (inner === '\\') {
          const escaped = statement[index + 1]
          if (escaped === undefined) fail(`an unterminated string that opened at ${start}`)
          text += ESCAPES[escaped!] ?? escaped!
          index += 2
          continue
        }
        text += inner
        index += 1
      }
      tokens.push({ kind: 'string', text, upper: text, start, end: index })
      continue
    }

    if (DIGIT.test(char)) {
      while (index < statement.length && DIGIT.test(statement[index]!)) index += 1
      // a '.' only continues the number when a DIGIT follows it, which is what keeps the `..` of
      // `*0..8` out of `0.` and leaves it as its own symbol
      if (statement[index] === '.' && DIGIT.test(statement[index + 1] ?? '')) {
        index += 1
        while (index < statement.length && DIGIT.test(statement[index]!)) index += 1
      }
      const text = statement.slice(start, index)
      tokens.push({ kind: 'number', text, upper: text, start, end: index })
      continue
    }

    if (WORD_START.test(char)) {
      index += 1
      while (index < statement.length && WORD_PART.test(statement[index]!)) index += 1
      const text = statement.slice(start, index)
      tokens.push({ kind: 'word', text, upper: text.toUpperCase(), start, end: index })
      continue
    }

    if (char === '$') {
      index += 1
      const from = index
      while (index < statement.length && WORD_PART.test(statement[index]!)) index += 1
      if (index === from) fail('a $ with no parameter name after it')
      const text = statement.slice(from, index)
      tokens.push({ kind: 'param', text, upper: text.toUpperCase(), start, end: index })
      continue
    }

    const pair = statement.slice(index, index + 2)
    if (TWO_CHAR.includes(pair)) {
      index += 2
      tokens.push({ kind: 'symbol', text: pair, upper: pair, start, end: index })
      continue
    }

    if (ONE_CHAR.includes(char)) {
      index += 1
      tokens.push({ kind: 'symbol', text: char, upper: char, start, end: index })
      continue
    }

    fail(`the character ${JSON.stringify(char)} cannot start a token`)
  }

  tokens.push({ kind: 'end', text: '', upper: '', start: statement.length, end: statement.length })
  return tokens
}

const WHITESPACE = /\s/
const DIGIT = /[0-9]/
const WORD_START = /[A-Za-z_]/
const WORD_PART = /[A-Za-z0-9_]/

const TWO_CHAR = ['->', '<-', '<=', '>=', '<>', '..']

// '+', '/', '%' and ';' are here so the PARSER can name them in a refusal. Nothing in the subset
// uses them, and a lexer that rejected them would report "the character '+' cannot start a token"
// where "arithmetic is not supported" is what the reader needs.
const ONE_CHAR = '()[]{},.:|=<>*-+/%;'

const ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '\\': '\\', "'": "'", '"': '"',
}
