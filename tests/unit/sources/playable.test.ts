/**
 * The two lists that must agree, checked without importing the expensive one.
 *
 * `sources/playable.ts` names the origins stub can play as plain strings so that asking the question
 * costs nothing; `sources/players.ts` maps the same origins to components that drag in
 * `@banou/media-player`, videojs, mux and libav. Keeping them apart is what keeps 353 kB off every
 * page load (see `playable.ts`), and the price is that they can drift: a third player added to the
 * registry and not to the set would simply never show a play button, which reads as a missing handle
 * rather than a missing entry.
 *
 * READ FROM SOURCE, not imported. `players.ts` cannot be imported here at all: under node it fails at
 * `Cannot find package 'react'` from inside `@banou/media-player`, because the alias to preact/compat
 * is a browser and bundler concern. Inlining the whole player stack into the unit run to check two
 * lists match would cost more than the check is worth, so the registry's keys are read out of its
 * text. The control below is what keeps that honest.
 */
import { expect, test } from 'vitest'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PLAYABLE_ORIGINS } from '../../../src/sources/playable'

const registrySource = readFileSync(
  fileURLToPath(new URL('../../../src/sources/players.ts', import.meta.url)),
  'utf-8'
)

/** The keys of the `players` record, read off the declaration rather than from a running module. */
const registryOrigins = (source: string): string[] => {
  // NOT `[^=]*` before the `=`: the record's type annotation is `(props: PlayerProps) => any`, whose
  // arrow contains an `=`, so a lazy scan for the assignment stops inside the type and finds nothing.
  const body = source.match(/const players\b[\s\S]*?=\s*\{([\s\S]*?)\n\}/)?.[1]
  if (body === undefined) throw new Error('the players record could not be found in players.ts')
  return [...body.matchAll(/^\s*(\w+)\s*:/gm)].map(match => match[1]!)
}

// MUTATED: drop 'nf' from PLAYABLE_ORIGINS and this names it; add 'tvdb' to it and this names that.
test('the cheap list and the player registry name exactly the same origins', () => {
  expect([...PLAYABLE_ORIGINS].sort()).toEqual(registryOrigins(registrySource).sort())
})

// THE CONTROL, because the whole case rests on a regex over someone else's file: if the reader stops
// finding anything, the comparison above passes by comparing two empty lists.
test('the reader really does find the registry, and really does fail when it cannot', () => {
  expect(registryOrigins(registrySource).length, 'it found entries').toBeGreaterThan(1)
  expect(() => registryOrigins('const notTheRecord = 1'), 'and it refuses rather than answering []')
    .toThrow('could not be found')
})
