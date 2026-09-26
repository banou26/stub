// Stub's own tracker: one more tracking provider, built like every other, whose list lives on this
// device. It answers only about itself, like every provider, and is written to only when the viewer
// names it.

import type { Journal } from '../../tracking/journal'

import { openJournal } from '../../tracking/journal'
import { opfsJournalStore } from './opfs-store'
import { STUB_TRACKER_ID, stubTracker, stubTrackerResolvers } from './tracker-resolvers'

export const origin = STUB_TRACKER_ID
export const name = stubTracker.name
export const originUrl = 'https://anime.fkn.app'
export const icon = stubTracker.icon
export const color = stubTracker.color
export const isApiOnly = true
export const scoreScale = stubTracker.scoreScale

let journal: Promise<Journal> | undefined

// Opened once per worker. A failure is not memoized, so the next question tries again.
const open = () =>
  (journal ??= openJournal(opfsJournalStore(), { now: Date.now, uuid: () => crypto.randomUUID() })
    .catch(error => { journal = undefined; throw error }))

export const resolvers = stubTrackerResolvers(open)
