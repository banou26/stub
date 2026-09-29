import type { ListStatus } from '../generated/graphql'

import type { Fields } from '../tracking/compact'

import { useEffect, useState } from 'preact/hooks'
import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { COMPACT_PREFS_KEY, createCompactPrefs, type CompactPrefs, type CompactPrefsStore } from '../tracking/compact-prefs'
import { trackerSignIns } from '../tracking/site-sessions'
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
        tracker {
          id
          name
          icon
          color
          canWrite
          account
          scoreScale
          writeNotice
        }
        entry {
          _id
          status
          progress
          score
          scoreLabel
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
  const [prefs, setPrefs] = useState(prefsStore.read)

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
            <TrackingPanel tracking={data?.tracking} episodeCount={episodeCount} onSave={onSave} onDelete={onDelete} signIns={trackerSignIns}/>
          </div>
        )
        : undefined}
    </>
  )
}

export default MediaTracking
