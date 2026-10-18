// Where the viewer stopped in each episode, kept per source until the episode is watched. Signed out,
// as here, in this browser alone; ../positions-sync.test.ts has them on the FKN account.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { newestPosition, readPositions, savePosition, WATCH_POSITIONS_KEY } from '../../../src/utils/watch-positions'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const kept = () => JSON.parse(stored.get(WATCH_POSITIONS_KEY) ?? 'null')
const later = () => vi.setSystemTime(Date.now() + 1_000)

test('a point between 30 s and 85% is kept as [source, time, length, when], moved to the newest place', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  later()
  savePosition('cr:2', { time: 300, duration: 1200 })
  expect(kept()).toEqual([['nf:1', 700, 1400, 1_000], ['cr:2', 300, 1200, 2_000]])
  later()
  savePosition('nf:1', { time: 800, duration: 1400 })
  expect(kept()).toEqual([['cr:2', 300, 1200, 2_000], ['nf:1', 800, 1400, 3_000]])
  expect(readPositions()).toEqual(kept())
})

test('85% played marks the source finished, and so does the end; through the credits it stays finished when it first was', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  savePosition('nf:1', { time: 1189, duration: 1400 })
  expect(kept(), 'the control: just under 85%').toEqual([['nf:1', 1189, 1400, 1_000]])
  later()
  savePosition('nf:1', { time: 1190, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 2_000]])
  later()
  savePosition('nf:1', { time: 1300, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 2_000]])
  savePosition('nyaa:a', { time: 700 })
  savePosition('nyaa:a', { time: 1400, ended: true })
  expect(kept()).toEqual([['nf:1', 2_000], ['nyaa:a', 3_000]])
})

test('under 30 s, or before a player with a length has said it, nothing is written and an older point stays where it is', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  savePosition('cr:2', { time: 300, duration: 1200 })
  later()
  savePosition('nf:1', { time: 10, duration: 1400 })
  savePosition('nf:1', { time: 900, duration: 0 })
  savePosition('nf:3', { time: 29, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 700, 1400, 1_000], ['cr:2', 300, 1200, 1_000]])
})

test('a player that never says its length is kept with a length of 0, and only its end marks it finished', () => {
  savePosition('nyaa:a', { time: 1300 })
  expect(kept()).toEqual([['nyaa:a', 1300, 0, 1_000]])
})

test('the 200 newest are kept, and as many finished sources beside them', () => {
  for (let index = 0; index < 201; index++) {
    later()
    savePosition(`nf:${index}`, { time: 100, duration: 1400 })
  }
  expect(kept()).toHaveLength(200)
  expect(kept()[0]).toEqual(['nf:1', 100, 1400, 3_000])
  expect(kept()[199]).toEqual(['nf:200', 100, 1400, 202_000])
  for (let index = 0; index < 201; index++) {
    later()
    savePosition(`cr:${index}`, { time: 1400, ended: true })
  }
  expect(readPositions().filter(entry => entry.length === 4), 'the points stay').toHaveLength(200)
  expect(readPositions().filter(entry => entry.length === 2).map(([uri]) => uri)).toEqual(Array.from({ length: 200 }, (_, index) => `cr:${index + 1}`))
})

test('each save reads what is stored, so another tab\'s point is never undone', () => {
  savePosition('nf:1', { time: 700, duration: 1400 })
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:1', 700, 1400, 1_000], ['cr:2', 300, 1200, 1_000]]))
  later()
  savePosition('nf:3', { time: 400, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 700, 1400, 1_000], ['cr:2', 300, 1200, 1_000], ['nf:3', 400, 1400, 2_000]])
})

test('the newest point among a row\'s sources, and none once the newest of them is finished', () => {
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['cr:4', 300, 1200, 1], ['nf:4', 600, 1200, 2], ['nf:5', 900, 1200, 3], ['cr:5', 4]]))
  expect(newestPosition(['cr:4', 'nf:4'])).toEqual(['nf:4', 600, 1200, 2])
  expect(newestPosition(['cr:4'])).toEqual(['cr:4', 300, 1200, 1])
  expect(newestPosition(['nf:6'])).toBeUndefined()
  expect(newestPosition(['nf:5']), 'the control: its own point').toEqual(['nf:5', 900, 1200, 3])
  expect(newestPosition(['nf:5', 'cr:5'])).toBeUndefined()
})

test('a point kept before points had a time reads as the oldest', () => {
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:1', 700, 1400], ['cr:2', 300, 1200]]))
  expect(readPositions()).toEqual([['nf:1', 700, 1400, 0], ['cr:2', 300, 1200, 0]])
  savePosition('nf:3', { time: 400, duration: 1400 })
  expect(kept()).toEqual([['nf:1', 700, 1400, 0], ['cr:2', 300, 1200, 0], ['nf:3', 400, 1400, 1_000]])
})

test('storage that holds something else, or throws, reads as empty, and a save to it throws nothing', () => {
  stored.set(WATCH_POSITIONS_KEY, '{oops')
  expect(readPositions()).toEqual([])
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:1', 700, 1400, 5], ['nf:2', '700', 1400, 5], null, 'nf:3', ['nf:4'], ['nf:5', 1, 2, 3, 4]]))
  expect(readPositions()).toEqual([['nf:1', 700, 1400, 5]])
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
  expect(readPositions()).toEqual([])
  expect(newestPosition(['nf:1'])).toBeUndefined()
  expect(() => savePosition('nf:1', { time: 700, duration: 1400 })).not.toThrow()
})
