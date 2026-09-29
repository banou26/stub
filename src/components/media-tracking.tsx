import type { ListEntryInput, ListStatus } from '../generated/graphql'
import type { SyncWrite } from '../tracking/sync'

import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { trackerSignIns } from '../tracking/site-sessions'
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

const failed = (message?: string): PanelOutcome[] => [{ tracker: '', outcome: 'FAILED', error: message ?? 'The write did not reach the trackers' }]

/**
 * The tracking panel of one media, subscribed on the uri the store has grown the media to, so the
 * trackers are asked again as the media gains ids.
 */
const MediaTracking = (
  { uri, title, cover, episodeCount }:
  { uri: string | undefined, title?: string | null, cover?: string | null, episodeCount?: number | null }
) => {
  const [{ data }] = useSubscription({ query: MEDIA_TRACKING, variables: { input: { uri: uri! } }, pause: !uri })
  const [, save] = useMutation(SAVE_LIST_ENTRY)
  const [, remove] = useMutation(DELETE_LIST_ENTRY)

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

  return (
    <TrackingPanel
      tracking={data?.tracking}
      episodeCount={episodeCount}
      onSave={onSave}
      onDelete={onDelete}
      onSyncWrite={onSyncWrite}
      signIns={trackerSignIns}
    />
  )
}

export default MediaTracking
