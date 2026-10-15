import type { MediaTrackingSubscription } from '../generated/graphql'
import type { TrackerOutcome } from '../tracking/compact'

import { useEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { namesSameWork } from '../router/home/modal-media'
import { MEDIA_TRACKING, useSaveEntry } from './media-tracking-query'
import { COMPACT_PREFS_KEY, devicePrefs, type CompactPrefs, type CompactPrefsStore } from '../tracking/compact-prefs'
import { unlockTracker } from '../tracking/fkn-cloud-live'
import { isSiteConnected, trackerSignIns } from '../tracking/site-sessions'
import { recordTrackerAnswers, siteStatuses } from '../tracking/site-status'
import { trackerCheck } from '../worker'
import StubListNotice from './stub-list-notice'
import TrackingCompact from './tracking-compact'

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

const failed = (message?: string): TrackerOutcome[] => [{ tracker: '', outcome: 'FAILED', error: message ?? 'The write did not reach the trackers' }]

type Tracking = NonNullable<MediaTrackingSubscription['tracking']>

const loading = (answer: { state: string }) => answer.state === 'LOADING'
// what draws a chip: a tracker with no id for the media draws none (tracking-compact.tsx)
const drawn = (answer: { state: string }) => !loading(answer) && answer.state !== 'NO_ID'

/**
 * What the row shows of the subscription's latest result: the one shown before while the latest still
 * waits on a tracker that one drew, so no chip drops out while the media gains ids.
 */
const heldOf = (shown: Tracking | undefined, latest: Tracking | null | undefined) =>
  shown && latest?.answers.some(answer =>
    loading(answer) && shown.answers.some(before => before.tracker.id === answer.tracker.id && drawn(before)))
    ? shown
    : latest ?? undefined

type Props = {
  work: string | undefined
  address: string | undefined
  uri: string | undefined
  title?: string | null
  cover?: string | null
  episodeCount?: number | null
  movie?: boolean
  prefsStore?: CompactPrefsStore
}

const WorkTracking = ({ work, address, uri, title, cover, episodeCount, movie, prefsStore = devicePrefs }: Props) => {
  const asked = uri ?? work
  const [{ data }] = useSubscription({ query: MEDIA_TRACKING, variables: { input: { uri: asked! } }, pause: !asked })
  const shown = useRef<Tracking>(undefined)
  shown.current = heldOf(shown.current, data?.tracking)
  const onSaveFields = useSaveEntry({ uri: uri!, title, cover, episodeCount })
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

  const onRemove = async (targets: string[]): Promise<TrackerOutcome[]> => {
    const result = await remove({ input: { uri: uri!, trackers: targets } })
    return result.data?.deleteListEntry ?? failed(result.error?.message)
  }

  // the key card opens from this click, and only from it; the worker then checks the account again
  const onUnlock = async () => { if (await unlockTracker()) await trackerCheck() }

  return (
    <>
      <TrackingCompact
        tracking={uri && namesSameWork(work, address) ? shown.current : undefined}
        episodeCount={episodeCount}
        movie={movie}
        onSaveFields={onSaveFields}
        onRemove={onRemove}
        signIns={trackerSignIns}
        prefs={prefs}
        onPrefs={onPrefs}
      />
      <StubListNotice storage={storage?.stubTrackerStorage} onUnlock={onUnlock} onAdd={() => addHeld({})}/>
    </>
  )
}

/**
 * The tracking of the page's work. `work` is the uri the page asks its details on, which a growth of
 * the address keeps and a navigation to another work replaces; `uri` is the media's own once the
 * details have answered for `work`. The trackers are asked on `work` until then, so they have answered
 * by the time the row draws, and on `uri` from then on, so they are asked again as the media gains
 * ids. A new `work` starts afresh, since urql keeps the last result while a new subscription starts,
 * and nothing is drawn while `address`, the page's own, names another work than `work`: the render
 * after a navigation, before the page has moved `work` to it.
 */
const MediaTracking = (props: Props) => <WorkTracking key={props.work} {...props}/>

export default MediaTracking
