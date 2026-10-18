// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { PlaybackLink } from '../../../../src/party/bridge'
import type { PlaybackSource } from '../../../../src/party/plugin-link'
import type { PlaybackState } from '../../../../src/party/protocol'

import { pluginPlaybackLink } from '../../../../src/party/plugin-link'
import { useResume } from '../../../../src/router/watch/resume'
import { WATCH_POSITIONS_KEY } from '../../../../src/utils/watch-positions'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
})
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

type Report = { paused?: boolean, time: number, ended?: boolean, duration?: number }
// a player as the watch page hears it, as in components/media-tracking-watched.test.tsx; `duration` only where the player says how long it is
const fakeLink = (duration?: number) => {
  const listeners = new Set<(state: PlaybackState) => void>()
  let ended = false
  let length = duration
  return {
    apply: vi.fn<PlaybackLink['apply']>(),
    onReport: (listener: (state: PlaybackState) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    ended: () => ended,
    ...duration === undefined ? {} : { duration: () => length! },
    dispose: () => listeners.clear(),
    report: (...states: Report[]) => act(() => {
      for (const { paused = false, time, ended: atEnd = false, duration: said = length } of states) {
        ended = atEnd
        length = said
        for (const listener of listeners) listener({ paused, time, rate: 1, at: Date.now() })
      }
    }),
  }
}

// a source plugin's player, through the link the watch page makes of it; `duration` only where the package says it
const pluginLink = () => {
  let ear: Parameters<NonNullable<PlaybackSource['onPlayback']>>[0] = () => {}
  const applied: number[] = []
  const link = pluginPlaybackLink({ onPlayback: async listener => { ear = listener }, applyPlayback: async ({ time }) => { applied.push(time) } })!
  const report = (...states: Omit<Report, 'ended'>[]) => act(() => {
    for (const { paused = false, time, duration } of states) ear({ paused, time, rate: 1, at: Date.now(), ...duration === undefined ? {} : { duration } })
  })
  return { link, applied, report }
}

const Resume = ({ link, uri, uris, guest }: { link: PlaybackLink, uri: string, uris: string[], guest: boolean }) => {
  useResume(link, uri, uris, guest)
  return null
}
const page = ({ link = fakeLink(1400), uri = 'nf:1', uris = ['nf:1', 'cr:1'], guest = false } = {}) => {
  hosts.push(mount(<Resume link={link} uri={uri} uris={uris} guest={guest}/>))
  return link
}
const keep = (...points: [string, number, number][]) => stored.set(WATCH_POSITIONS_KEY, JSON.stringify(points))
const kept = () => JSON.parse(stored.get(WATCH_POSITIONS_KEY) ?? 'null')
const seeks = (link: ReturnType<typeof fakeLink>) => link.apply.mock.calls.map(([state]) => state.time)

test('the first report with a length, 2 s in, seeks once to the point kept', async () => {
  keep(['nf:1', 600, 1400])
  const link = page()
  await link.report({ time: 2 })
  expect(link.apply).toHaveBeenCalledTimes(1)
  expect(link.apply.mock.calls[0]![0]).toMatchObject({ paused: false, time: 600, rate: 1 })
  await link.report({ time: 600 }, { time: 3 })
  expect(seeks(link), 'once per player').toEqual([600])
})

test('a player that says its length only at its first heartbeat, 5.5 s in, still resumes', async () => {
  keep(['nf:1', 600, 1400])
  const link = page({ link: fakeLink(0) })
  await link.report({ paused: true, time: 0 }, { time: 0 })
  expect(link.apply, 'no length yet').not.toHaveBeenCalled()
  await link.report({ time: 5.5, duration: 1400 })
  expect(seeks(link)).toEqual([600])
})

test('a player already 300 s in resumed by itself, and is left there', async () => {
  keep(['nf:1', 600, 1400])
  const link = page()
  await link.report({ time: 300 }, { time: 2 })
  expect(link.apply).not.toHaveBeenCalled()
})

test('a party guest follows the host and never seeks on its own', async () => {
  keep(['nf:1', 600, 1400])
  const link = page({ guest: true })
  await link.report({ time: 2 })
  expect(link.apply).not.toHaveBeenCalled()
})

test('a point kept on another source of the episode resumes this one; one past this length does not', async () => {
  keep(['cr:1', 600, 1450])
  const link = page()
  await link.report({ time: 2 })
  expect(seeks(link)).toEqual([600])

  keep(['cr:1', 1420, 1450])
  const shorter = page()
  await shorter.report({ time: 2 })
  expect(shorter.apply).not.toHaveBeenCalled()
})

test('a player that never says its length resumes on its first report', async () => {
  keep(['nyaa:a', 600, 0])
  const link = page({ link: fakeLink(), uri: 'nyaa:a', uris: ['nyaa:a'] })
  await link.report({ paused: true, time: 0 })
  expect(seeks(link)).toEqual([600])
})

test('every report keeps where the player is, and 86% marks the source finished', async () => {
  const link = page()
  await link.report({ time: 700 })
  expect(kept()).toEqual([['nf:1', 700, 1400, expect.any(Number)]])
  await link.report({ time: 1204 })
  expect(kept()).toEqual([['nf:1', expect.any(Number)]])
})

test('a player that never says its length, paused at its end and then ended there, marks the source finished', async () => {
  const link = page({ link: fakeLink(), uri: 'nyaa:a', uris: ['nyaa:a'] })
  await link.report({ time: 1390 }, { paused: true, time: 1400 })
  expect(kept(), 'the control: kept as a point').toEqual([['nyaa:a', 1400, 0, expect.any(Number)]])
  await link.report({ paused: true, time: 1400, ended: true })
  expect(kept()).toEqual([['nyaa:a', expect.any(Number)]])
})

test('a report under 30 s after the seek leaves the point kept, so a seek that lands late loses nothing', async () => {
  keep(['nf:1', 600, 1400])
  const link = page()
  await link.report({ time: 2 }, { time: 10 })
  expect(seeks(link)).toEqual([600])
  expect(kept()).toEqual([['nf:1', 600, 1400]])
})

test('a source plugin\'s player that says its length resumes once it says it, and keeps its point with it', async () => {
  keep(['cr:1', 600, 1420])
  const { link, applied, report } = pluginLink()
  hosts.push(mount(<Resume link={link} uri="nyaa:a" uris={['nyaa:a', 'cr:1']} guest={false}/>))
  await report({ paused: true, time: 0, duration: 0 })
  expect(applied, 'no length yet').toEqual([])
  await report({ time: 1, duration: 1420 })
  expect(applied).toEqual([600])
  await report({ time: 700, duration: 1420 })
  expect(kept()).toEqual([['cr:1', 600, 1420, 0], ['nyaa:a', 700, 1420, expect.any(Number)]])
  await report({ time: 1210, duration: 1420 })
  expect(kept(), '85% marks it finished').toEqual([['cr:1', 600, 1420, 0], ['nyaa:a', expect.any(Number)]])
})

test('a source plugin\'s live media, whose length is Infinity, resumes on its first report, and is kept with none', async () => {
  keep(['nyaa:a', 600, 0])
  const { link, applied, report } = pluginLink()
  hosts.push(mount(<Resume link={link} uri="nyaa:a" uris={['nyaa:a']} guest={false}/>))
  await report({ paused: true, time: 0, duration: Infinity })
  expect(applied).toEqual([600])
  await report({ time: 700, duration: Infinity })
  expect(kept()).toEqual([['nyaa:a', 700, 0, expect.any(Number)]])
})

test('a source plugin\'s player that never says its length resumes on its first report, and is kept with none', async () => {
  keep(['nyaa:a', 600, 0])
  const { link, applied, report } = pluginLink()
  hosts.push(mount(<Resume link={link} uri="nyaa:a" uris={['nyaa:a']} guest={false}/>))
  await report({ paused: true, time: 0 })
  expect(applied).toEqual([600])
  await report({ time: 700 })
  expect(kept()).toEqual([['nyaa:a', 700, 0, expect.any(Number)]])
})
