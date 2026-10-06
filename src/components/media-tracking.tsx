import type { ListEntryInput, ListStatus } from '../generated/graphql'
import type { SyncWrite } from '../tracking/sync'

import type { Fields } from '../tracking/compact'

import { useEffect, useState } from 'preact/hooks'
import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { COMPACT_PREFS_KEY, createCompactPrefs, type CompactPrefs, type CompactPrefsStore } from '../tracking/compact-prefs'
import { unlockTracker } from '../tracking/fkn-cloud-live'
import { isSiteConnected, trackerSignIns } from '../tracking/site-sessions'
import { recordTrackerAnswers, siteStatuses } from '../tracking/site-status'
import { trackerCheck } from '../worker'
import StubListNotice from './stub-list-notice'
import TrackingCompact from './tracking-compact'
import TrackingPanel, { type EntryValues, type PanelOutcome } from './tracking-panel'

const MEDIA_TRACKING = gql(`
  subscription MediaTracking($input: TrackingInput!) {
    tracking(input: $input) {
      _id
      disagreements
      summary {
        _id
        status
        progress
        score
        episodeCount
      }
      answers {
        _id
        state
        candidates
        error
        pending
        episodeCount
        tracker {
          id
          name
          icon
          color
          canWrite
          account
          scoreScale
          writeNotice
          keepsPageEpisodeCount
          keeps
          rewatchThroughCompleted
        }
        entry {
          _id
          status
          progress
          score
          scoreLabel
          startedAt { year month day }
          completedAt { year month day }
          rewatchCount
          episodeCount
          updatedAt
        }
      }
    }
  }
`)

const SAVE_LIST_ENTRY = gql(`
  mutation SaveListEntry($input: SaveListEntryInput!) {
    saveListEntry(input: $input) {
      tracker
      outcome
      error
      entry {
        _id
        status
        progress
        score
        scoreLabel
        startedAt { year month day }
        completedAt { year month day }
        rewatchCount
        episodeCount
        updatedAt
      }
    }
  }
`)

const DELETE_LIST_ENTRY = gql(`
  mutation DeleteListEntry($input: DeleteListEntryInput!) {
    deleteListEntry(input: $input) {
      tracker
      outcome
      error
    }
  }
`)

const STUB_TRACKER_STORAGE = gql(`
  subscription StubTrackerStorage {
    stubTrackerStorage {
      location
      signedIn
      locked
      waiting
      held
      error
    }
  }
`)

const ADD_HELD_STUB_ENTRIES = gql(`
  mutation AddHeldStubEntries {
    addHeldStubEntries {
      location
      signedIn
      locked
      waiting
      held
      error
    }
  }
`)

const devicePrefs = createCompactPrefs()

const failed = (message?: string): PanelOutcome[] => [{ tracker: '', outcome: 'FAILED', error: message ?? 'The write did not reach the trackers' }]

/**
 * The tracking of one media, subscribed on the uri the store has grown the media to, so the trackers
 * are asked again as the media gains ids. The compact row always shows; the full panel shows under it
 * when the viewer turns Advanced on, which this device remembers.
 */
const MediaTracking = (
  { uri, title, cover, episodeCount, prefsStore = devicePrefs }:
  { uri: string | undefined, title?: string | null, cover?: string | null, episodeCount?: number | null, prefsStore?: CompactPrefsStore }
) => {
  const [{ data }] = useSubscription({ query: MEDIA_TRACKING, variables: { input: { uri: uri! } }, pause: !uri })
  const [, save] = useMutation(SAVE_LIST_ENTRY)
  const [, remove] = useMutation(DELETE_LIST_ENTRY)
  const [{ data: storage }] = useSubscription({ query: STUB_TRACKER_STORAGE })
  const [, addHeld] = useMutation(ADD_HELD_STUB_ENTRIES)
  const [prefs, setPrefs] = useState(prefsStore.read)

  const answers = data?.tracking?.answers
  useEffect(() => { if (answers) recordTrackerAnswers(answers, siteStatuses, isSiteConnected) }, [answers])

  // another tab changed the choices
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === COMPACT_PREFS_KEY) setPrefs(prefsStore.read()) }
    globalThis.addEventListener?.('storage', changed)
    return () => globalThis.removeEventListener?.('storage', changed)
  }, [prefsStore])

  const onPrefs = (next: CompactPrefs) => {
    prefsStore.write(next)
    setPrefs(next)
  }

  const onSave = async (targets: string[], values: EntryValues): Promise<PanelOutcome[]> => {
    const result = await save({
      input: {
        uri: uri!,
        trackers: targets,
        entry: { status: values.status as ListStatus, progress: values.progress, score: values.score },
        title: title ?? null,
        cover: cover ?? null,
        episodeCount: episodeCount ?? null,
      },
    })
    return result.data?.saveListEntry ?? failed(result.error?.message)
  }

  // the entry exactly as given: an absent key leaves that field as the tracker has it, a null clears it
  const onSaveFields = async (targets: string[], entry: Fields): Promise<PanelOutcome[]> => {
    const result = await save({
      input: {
        uri: uri!,
        trackers: targets,
        entry: entry as Omit<Fields, 'status'> & { status?: ListStatus },
        title: title ?? null,
        cover: cover ?? null,
        episodeCount: episodeCount ?? null,
      },
    })
    return result.data?.saveListEntry ?? failed(result.error?.message)
  }

  const onDelete = async (targets: string[]): Promise<PanelOutcome[]> => {
    const result = await remove({ input: { uri: uri!, trackers: targets } })
    return result.data?.deleteListEntry ?? failed(result.error?.message)
  }

  // one sync target per write, named alone: a sync reaches no tracker the viewer did not tick
  const onSyncWrite: SyncWrite = async (tracker, entry) => {
    const result = await save({
      input: {
        uri: uri!,
        trackers: [tracker],
        entry: entry as ListEntryInput,
        title: title ?? null,
        cover: cover ?? null,
        episodeCount: episodeCount ?? null,
      },
    })
    return result.data?.saveListEntry ?? failed(result.error?.message)
  }

  // the key card opens from this click, and only from it; the worker then checks the account again
  const onUnlock = async () => { if (await unlockTracker()) await trackerCheck() }

  return (
    <>
      <TrackingCompact
        tracking={data?.tracking}
        episodeCount={episodeCount}
        onSaveFields={onSaveFields}
        signIns={trackerSignIns}
        prefs={prefs}
        onPrefs={onPrefs}
      />
      {prefs.advanced
        ? (
          <div id="tracking-advanced">
            <TrackingPanel
              tracking={data?.tracking}
              episodeCount={episodeCount}
              onSave={onSave}
              onDelete={onDelete}
              onSyncWrite={onSyncWrite}
              signIns={trackerSignIns}
            />
          </div>
        )
        : undefined}
      <StubListNotice storage={storage?.stubTrackerStorage} onUnlock={onUnlock} onAdd={() => addHeld({})}/>
    </>
  )
}

export default MediaTracking
