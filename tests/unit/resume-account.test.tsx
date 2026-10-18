// FIRST: ./components/dom installs the document the watch page's hook mounts in.
import { mount, unmount } from './components/dom'

// The watch page's resume over the page's own @fkn/lib realm: a point another device saved on the FKN
// account resumes the player here, and one played here reaches the account at a pause, when the page is
// hidden and when the player goes, sooner than its pace.
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { PlaybackLink } from '../../src/party/bridge'
import type { PlaybackState } from '../../src/party/protocol'
import type { KeptPosition } from '../../src/utils/watch-positions'

// FKN's storage faked at @fkn/lib's surface, signed in to the viewer's account
const account = await vi.hoisted(async () => {
  const { fknWorld } = await import('./tracking/fkn-fake')
  const { fknTrackerCloud } = await import('../../src/tracking/fkn-cloud')
  const world = fknWorld()
  const browser = world.browser({ account: 'alice' })
  return { world, browser, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }) }
})
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: account.cloud, onTrackerAccountChange: account.browser.onChange }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

const { checkPositions } = await import('../../src/settings-account')
const { useResume } = await import('../../src/router/watch/resume')
const { POSITIONS_PATH } = await import('../../src/settings-sync')
const { newestPosition, WATCH_POSITIONS_KEY } = await import('../../src/utils/watch-positions')

const fileOf = (): KeptPosition[] => {
  const file = account.world.storageOf('alice').get(POSITIONS_PATH)
  return file ? JSON.parse(JSON.parse(file.text)[WATCH_POSITIONS_KEY]) : []
}
const timeOf = (uri: string) => fileOf().findLast(([kept]) => kept === uri)?.[1]
const holds = (kept: KeptPosition[]) => account.world.storageOf('alice').set(POSITIONS_PATH, {
  text: JSON.stringify({ [WATCH_POSITIONS_KEY]: JSON.stringify(kept) }),
  updatedAt: new Date(0).toISOString(),
})
const writes = () => account.browser.state.writes.filter(({ path }) => path === POSITIONS_PATH).length
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const fakeLink = () => {
  const listeners = new Set<(state: PlaybackState) => void>()
  return {
    apply: vi.fn<PlaybackLink['apply']>(),
    onReport: (listener: (state: PlaybackState) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ended: () => false,
    duration: () => 1400,
    dispose: () => listeners.clear(),
    report: ({ paused = false, time }: { paused?: boolean, time: number }) => act(() => {
      for (const listener of listeners) listener({ paused, time, rate: 1, at: Date.now() })
    }),
  }
}
const Resume = ({ link, uri }: { link: PlaybackLink, uri: string }) => {
  useResume(link, uri, [uri, 'cr:1'], false)
  return null
}
const hosts: HTMLElement[] = []
const page = (uri: string) => {
  const link = fakeLink()
  hosts.push(mount(<Resume link={link} uri={uri}/>))
  return link
}
const visibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  visibility('visible')
})

test('a point another device saved on the account resumes the player here, once this page checked the account', async () => {
  holds([['cr:1', 600, 1400, 1_000]])
  const before = page('nf:1')
  await before.report({ time: 2 })
  expect(before.apply, 'the control: not before the check').not.toHaveBeenCalled()
  unmount(hosts.pop()!)

  await checkPositions()
  const link = page('nf:1')
  await link.report({ time: 2 })
  expect(link.apply.mock.calls.map(([state]) => state.time)).toEqual([600])
})

test('a point played here reaches the account at a pause, when the page is hidden and when the player goes, sooner than its pace', async () => {
  await checkPositions()
  const link = page('nf:2')
  await link.report({ time: 700 })
  await vi.waitFor(() => expect(timeOf('nf:2')).toBe(700))
  await link.report({ time: 705 })
  await wait(100)
  expect(timeOf('nf:2'), 'the control: paced while playing').toBe(700)

  await link.report({ paused: true, time: 706 })
  await vi.waitFor(() => expect(timeOf('nf:2')).toBe(706))

  await link.report({ time: 710 })
  visibility('hidden')
  await vi.waitFor(() => expect(timeOf('nf:2')).toBe(710))

  await link.report({ time: 720 })
  unmount(hosts.pop()!)
  await vi.waitFor(() => expect(timeOf('nf:2')).toBe(720))
})

test('a paused player that reports again without moving leaves the episode another device finished since', async () => {
  await checkPositions()
  const link = page('nf:9')
  await link.report({ time: 590 })
  await link.report({ paused: true, time: 600 })
  await vi.waitFor(() => expect(timeOf('nf:9')).toBe(600))
  const [, , , savedAt] = fileOf().findLast(([uri]) => uri === 'nf:9') as [string, number, number, number]
  holds([...fileOf(), ['nf:9', savedAt + 1]])
  await checkPositions()
  expect(newestPosition(['nf:9']), 'the control: finished here too').toBeUndefined()
  await wait(5)

  // a party starting makes the player report again where it is
  await link.report({ paused: true, time: 600 })
  await wait(100)
  expect(newestPosition(['nf:9'])).toBeUndefined()
  expect(fileOf().findLast(([uri]) => uri === 'nf:9')).toEqual(['nf:9', savedAt + 1])
  await link.report({ paused: true, time: 650 })
  expect(newestPosition(['nf:9']), 'the control: a seek keeps its place').toEqual(['nf:9', 650, 1400, expect.any(Number)])
})

test('seeking while paused waits for the pace, and the page hidden sends the last place', async () => {
  await checkPositions()
  const link = page('nf:4')
  await link.report({ time: 700 })
  await link.report({ paused: true, time: 701 })
  await vi.waitFor(() => expect(timeOf('nf:4')).toBe(701))
  const before = writes()
  for (let time = 710; time <= 750; time += 10) {
    await link.report({ paused: true, time })
    await wait(20)
  }
  expect(writes()).toBe(before)
  visibility('hidden')
  await vi.waitFor(() => expect(timeOf('nf:4')).toBe(750))
})
