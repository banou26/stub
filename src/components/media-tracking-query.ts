import type { ListStatus } from '../generated/graphql'
import type { Fields, TrackerOutcome } from '../tracking/compact'

import { useRef } from 'preact/hooks'
import { useMutation } from 'urql'

import { gql } from '../generated'
import { namesSameWork } from '../router/home/modal-media'

/** One media's tracking. Its own module, so media-details.tsx and the watch page read it without loading the tracking panel. */
export const MEDIA_TRACKING = gql(`
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
        episodeCount
        tracker {
          id
          name
          icon
          color
          canWrite
          statuses
          account
          scoreScale
        }
        entry {
          _id
          status
          progress
          score
          episodeCount
        }
      }
    }
  }
`)

/** A write of one entry's fields to the trackers named, each answering with its outcome. */
export const SAVE_LIST_ENTRY = gql(`
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
      }
    }
  }
`)

/**
 * Writes one media's entry to the trackers named, exactly as given: an absent key leaves that field as
 * the tracker has it, a null clears it. A write that reached no tracker answers one FAILED outcome
 * naming none.
 */
export const useSaveEntry = (
  { uri, title, cover, episodeCount }: { uri: string, title?: string | null, cover?: string | null, episodeCount?: number | null },
) => {
  const [, save] = useMutation(SAVE_LIST_ENTRY)
  return async (trackers: string[], entry: Fields): Promise<TrackerOutcome[]> => {
    const result = await save({
      input: {
        uri,
        trackers,
        entry: entry as Omit<Fields, 'status' | 'remove'> & { status?: ListStatus },
        title: title ?? null,
        cover: cover ?? null,
        episodeCount: episodeCount ?? null,
      },
    })
    return result.data?.saveListEntry ?? [{ tracker: '', outcome: 'FAILED', error: result.error?.message ?? 'The write did not reach the trackers' }]
  }
}

/**
 * A key that stays while `uri` grows and changes when it moves to another media, as a show's details
 * that turn out to be its first season. A component keyed on it sends what it shaped for one media to
 * that media, the saves still waiting included, and never shows one media's tracking under another's.
 */
export const useMediaKey = (uri: string | undefined) => {
  const media = useRef({ uri, key: 0 })
  const { uri: before, key } = media.current
  if (uri && uri !== before) media.current = { uri, key: namesSameWork(before, uri) ? key : key + 1 }
  return media.current.key
}
