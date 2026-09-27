import type { ListStatus } from '../generated/graphql'

import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { unlockTracker } from '../tracking/fkn-cloud-live'
import { trackerAccountChanged } from '../worker'
import StubListNotice from './stub-list-notice'
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
        }
        entry {
          _id
          status
          progress
          score
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
  const [{ data: storage }] = useSubscription({ query: STUB_TRACKER_STORAGE })
  const [, addHeld] = useMutation(ADD_HELD_STUB_ENTRIES)

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

  // the key card opens from this click, and only from it; the worker then checks the account again
  const onUnlock = async () => { if (await unlockTracker()) await trackerAccountChanged() }

  return (
    <>
      <TrackingPanel tracking={data?.tracking} episodeCount={episodeCount} onSave={onSave} onDelete={onDelete}/>
      <StubListNotice storage={storage?.stubTrackerStorage} onUnlock={onUnlock} onAdd={() => addHeld({})}/>
    </>
  )
}

export default MediaTracking
