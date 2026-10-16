// Where the viewer stopped in each episode, kept in this browser per source until the episode is watched.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { newestPosition, readPositions, savePosition, WATCH_POSITIONS_KEY } from '../../../src/utils/watch-positions'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

const kept = () => JSON.parse(stored.get(WATCH_POSITIONS_KEY) ?? 'null')

test('a point between 30 s and 85% is kept as [source, time, length], moved to the newest place', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  savePosition('cr:2', { time: 300, duration: 1200 })
  expect(kept()).toEqual([['nf:1', 700, 1400], ['cr:2', 300, 1200]])
  savePosition('nf:1', { time: 800, duration: 1400 })
  expect(kept()).toEqual([['cr:2', 300, 1200], ['nf:1', 800, 1400]])
  expect(readPositions()).toEqual(kept())
})

test('85% played forgets the point, and so does the end', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  savePosition('nf:1', { time: 1189, duration: 1400 })
  expect(kept(), 'the control: just under 85%').toEqual([['nf:1', 1189, 1400]])
  savePosition('nf:1', { time: 1190, duration: 1400 })
  expect(kept()).toEqual([])
  savePosition('nyaa:a', { time: 700 })
  savePosition('nyaa:a', { time: 1400, ended: true })
  expect(kept()).toEqual([])
})

test('under 30 s, or before a player with a length has said it, nothing is written and an older point stays where it is', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  savePosition('cr:2', { time: 300, duration: 1200 })
  savePosition('nf:1', { time: 10, duration: 1400 })
  savePosition('nf:1', { time: 900, duration: 0 })
  savePosition('nf:3', { time: 29, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 700, 1400], ['cr:2', 300, 1200]])
})

test('a player that never says its length is kept with a length of 0, and only its end forgets it', () => {
  savePosition('nyaa:a', { time: 1300 })
  expect(kept()).toEqual([['nyaa:a', 1300, 0]])
})

test('the 200 newest are kept', () => {
  for (let index = 0; index < 201; index++) savePosition(`nf:${index}`, { time: 100, duration: 1400 })
  expect(kept()).toHaveLength(200)
  expect(kept()[0]).toEqual(['nf:1', 100, 1400])
  expect(kept()[199]).toEqual(['nf:200', 100, 1400])
})

test('each save reads what is stored, so another tab\'s point is never undone', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:1', 700, 1400], ['cr:2', 300, 1200]]))
  savePosition('nf:3', { time: 400, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 700, 1400], ['cr:2', 300, 1200], ['nf:3', 400, 1400]])
})

test('the newest point among a row\'s sources', () => {
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['cr:4', 300, 1200], ['nf:4', 600, 1200], ['nf:5', 900, 1200]]))
  expect(newestPosition(['cr:4', 'nf:4'])).toEqual(['nf:4', 600, 1200])
  expect(newestPosition(['cr:4'])).toEqual(['cr:4', 300, 1200])
  expect(newestPosition(['nf:6'])).toBeUndefined()
})

test('storage that holds something else, or throws, reads as empty, and a save to it throws nothing', () => {
  stored.set(WATCH_POSITIONS_KEY, '{oops')
  expect(readPositions()).toEqual([])
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:1', 700, 1400], ['nf:2', '700', 1400], null, 'nf:3']))
  expect(readPositions()).toEqual([['nf:1', 700, 1400]])
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
  expect(readPositions()).toEqual([])
  expect(newestPosition(['nf:1'])).toBeUndefined()
  expect(() => savePosition('nf:1', { time: 700, duration: 1400 })).not.toThrow()
})
