// Stub's own tracker: one more tracking provider, built like every other. Its list is kept on this
// device, and follows the viewer's FKN account while one is signed in and its list can be opened here
// (tracking/account-link.ts). It answers only about itself, like every provider, and is written to only
// when the viewer names it.

import type { Journal } from '../../tracking/journal'

import { accountLink, journalStoreOver, type AccountLink, type TrackerDisk } from '../../tracking/account-link'
import { openJournal } from '../../tracking/journal'
import { workerTrackerCloud } from '../../worker/tracker-cloud'
import { opfsTrackerDisk } from './opfs-store'
import { STUB_TRACKER_ID, stubTracker, stubTrackerResolvers } from './tracker-resolvers'

export const origin = STUB_TRACKER_ID
export const name = stubTracker.name
export const originUrl = 'https://anime.fkn.app'
export const icon = stubTracker.icon
export const color = stubTracker.color
export const isApiOnly = true
export const scoreScale = stubTracker.scoreScale

const deps = { now: Date.now, uuid: () => crypto.randomUUID() }

// one link step at a time across every tab of the origin, or two tabs could start two devices at once
const linkLock = <T>(work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('stub:tracker-link', work)
    : work()

let opened: Promise<{ disk: TrackerDisk, journal: Journal, link: AccountLink }> | undefined

// Opened once per worker. A failure is not memoized, so the next question tries again.
const open = () =>
  (opened ??= (async () => {
    const disk = opfsTrackerDisk()
    const journal = await openJournal(journalStoreOver(disk), deps)
    return { disk, journal, link: accountLink({ disk, journal, cloud: workerTrackerCloud, lock: linkLock, ...deps }) }
  })().catch(error => { opened = undefined; throw error }))

/** The link between this device's list and the FKN account, which the page drives (worker/yoga.ts). */
export const stubTrackerLink = () => open().then(({ link }) => link)

export const resolvers = stubTrackerResolvers(
  () => open().then(({ journal }) => journal),
  // read from the disk at each answer, which is where a sign out or an account switch lands first
  () => open().then(({ disk }) => disk.session()).then(session => session.scope)
)
