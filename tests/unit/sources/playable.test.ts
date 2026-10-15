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
import { afterEach, expect, test, vi } from 'vite-plus/test'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { PLAYABLE_ORIGINS, canPlay } from '../../../src/sources/playable'
import { viewerIn } from './justwatch/viewer'

const CR = 'https://www.crunchyroll.com/watch/GX1'

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

// a play button stub draws for a source the viewer turned off would load that source's player frame,
// so asking it again: the answer has to follow the switch at once, on data it answered before
test('a source turned off in Settings has no play button, and has one again when turned back on', () => {
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null })
  expect(canPlay('cr', CR, 'cloud')).toBe(true)
  stored.set('stub.sources.disabled', JSON.stringify(['cr']))
  expect(canPlay('cr', CR, 'cloud')).toBe(false)
  expect(canPlay('nf', 'https://www.netflix.com/watch/81', 'cloud'), 'only the source turned off').toBe(true)
  stored.delete('stub.sources.disabled')
  expect(canPlay('cr', CR, 'cloud')).toBe(true)
})

// a Prime account plays its own country's catalogue alone, so another country's link stays an outside link
test('with the extension, Prime Video plays the viewer\'s own country\'s site alone', () => {
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null })
  const LINKS = {
    primevideo: 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.1',
    us: 'https://watch.amazon.com/watch?gti=amzn1.dv.gti.1',
    uk: 'https://watch.amazon.co.uk/watch?gti=amzn1.dv.gti.1',
    de: 'https://watch.amazon.de/watch?gti=amzn1.dv.gti.1',
    jp: 'https://watch.amazon.co.jp/watch?gti=amzn1.dv.gti.1',
  }
  const playing = () => Object.entries(LINKS).filter(([, url]) => canPlay('amazon', url, 'extension')).map(([site]) => site)
  const cases = [
    ['America/Toronto', ['primevideo']],
    ['Europe/Amsterdam', ['primevideo']],
    ['America/New_York', ['us']],
    ['Europe/London', ['uk']],
    ['Europe/Berlin', ['de']],
    ['Europe/Vienna', ['de']],
    ['Asia/Tokyo', ['jp']],
    ['America/Puerto_Rico', ['us']],
    ['Asia/Ho_Chi_Minh', ['primevideo']],
  ] as const
  for (const [zone, sites] of cases) {
    viewerIn(zone)
    expect(playing(), zone).toEqual(sites)
  }
  viewerIn('America/Toronto')
  stored.set('stub.country', 'JP')
  expect(playing(), 'the country picked in Settings').toEqual(['jp'])
  expect(canPlay('amazon', 'not a url', 'extension')).toBe(false)
  expect(canPlay('cr', null, 'extension'), 'and nothing plays without a url').toBe(false)
})

// MUTATED: drop `backend === 'extension' ||` and the US and Canada go red with the extension; drop the
// cloud's amazon.co.jp condition and they go red on the cloud; make it refuse amazon.co.jp and Japan does.
// A Prime Video site picks its region from the connection, which on the cloud is a relay in Prague or Hong Kong.
test('on the cloud, Prime Video plays in stub in Japan alone, and with the extension in every country', () => {
  vi.stubGlobal('localStorage', { getItem: () => null })
  const cases = [
    ['Asia/Tokyo', 'https://watch.amazon.co.jp/watch?gti=amzn1.dv.gti.1', true],
    ['America/New_York', 'https://watch.amazon.com/watch?gti=amzn1.dv.gti.1', false],
    ['America/Toronto', 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.1', false],
  ] as const
  for (const [zone, url, onCloud] of cases) {
    viewerIn(zone)
    expect(canPlay('amazon', url, 'extension'), `${zone} with the extension`).toBe(true)
    expect(canPlay('amazon', url, 'cloud'), `${zone} on the cloud`).toBe(onCloud)
    expect(canPlay('amazon', url, undefined), `${zone} before the backend is known`).toBe(onCloud)
  }
})

afterEach(() => { vi.unstubAllGlobals() })
