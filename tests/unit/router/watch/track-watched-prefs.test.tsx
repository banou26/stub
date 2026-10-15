// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { print } from 'graphql'

import type { CompactPrefs } from '../../../../src/tracking/compact-prefs'
import type { PlaybackState } from '../../../../src/party/protocol'

// a browser that blocks site data: every read and write of localStorage throws
vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })

const answer = (id: string, name: string) => ({ state: 'NOT_LISTED', candidates: [], tracker: { id, name, canWrite: true } })
const tracking = { summary: null, disagreements: [], answers: [answer('anilist', 'AniList'), answer('stub', 'Stub')] }
const saved: { trackers: string[] }[] = []
vi.mock('urql', () => ({
  useSubscription: ({ query }: { query: Parameters<typeof print>[0] }) => [{ data: print(query).includes('subscription MediaTracking') ? { tracking } : undefined }],
  useMutation: () => [{}, async ({ input }: { input: { trackers: string[] } }) => {
    saved.push(input)
    return { data: { saveListEntry: input.trackers.map(tracker => ({ tracker, outcome: 'SAVED' })) } }
  }],
}))
// the row, as the choices it hands back
const row = vi.hoisted(() => ({ onPrefs: undefined as ((prefs: CompactPrefs) => void) | undefined }))
vi.mock('../../../../src/components/tracking-compact', () => ({ default: ({ onPrefs }: { onPrefs: (prefs: CompactPrefs) => void }) => { row.onPrefs = onPrefs; return null } }))
vi.mock('../../../../src/components/stub-list-notice', () => ({ default: () => null }))
vi.mock('../../../../src/tracking/fkn-cloud-live', () => ({ unlockTracker: async () => false }))
vi.mock('../../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
vi.mock('../../../../src/tracking/site-status', () => ({ recordTrackerAnswers: () => {}, siteStatuses: {} }))
vi.mock('../../../../src/worker', () => ({ trackerCheck: async () => {} }))

const { default: MediaTracking } = await import('../../../../src/components/media-tracking')
const { default: TrackWatched } = await import('../../../../src/router/watch/track-watched')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('where storage is blocked, a tracker unchecked in the row is not written from the watch page', async () => {
  hosts.push(mount(<MediaTracking work="ag:(anilist:1)" address="ag:(anilist:1)" uri="ag:(anilist:1)" episodeCount={12}/>))
  act(() => { row.onPrefs!({ targets: { anilist: false } }) })

  const listeners = new Set<(state: PlaybackState) => void>()
  const link = {
    apply: () => {},
    onReport: (listener: (state: PlaybackState) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    duration: () => 1000,
    dispose: () => {},
  }
  hosts.push(mount(<TrackWatched link={link} uri="ag:(anilist:1)" episode={5} episodeCount={12}/>))
  await act(async () => { for (const listener of listeners) listener({ paused: false, time: 900, rate: 1, at: Date.now() }) })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  expect(saved.map(({ trackers }) => trackers)).toEqual([['stub']])
})
