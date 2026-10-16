import type { MediaTrackingSubscription } from '../generated/graphql'
import type { TrackerOutcome } from '../tracking/compact'

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useMutation, useSubscription } from 'urql'

import { gql } from '../generated'
import { TrackerState } from '../generated/graphql'
import { namesSameWork } from '../router/home/modal-media'
import { MEDIA_TRACKING, useMediaKey, useSaveEntry } from './media-tracking-query'
import { COMPACT_PREFS_KEY, devicePrefs, type CompactPrefs, type CompactPrefsStore } from '../tracking/compact-prefs'
import { trackingId } from '../tracking/aggregate'
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
const heldOf = (shown: Tracking | null | undefined, latest: Tracking | null | undefined) =>
  shown && latest?.answers.some(answer =>
    loading(answer) && shown.answers.some(before => before.tracker.id === answer.tracker.id && drawn(before)))
    ? shown
    : latest ?? undefined

const ambiguous = (answer: { state: string }) => answer.state === TrackerState.Ambiguous

/**
 * A result as the row may show it while asking on `uri`. An answer that cannot tell which media its uri
 * names is about that uri alone, so in a result for another (the page's address before the media's own
 * uri is known, as an old link naming two shows) it is still loading. Any other result comes back as the
 * same object, and the subscription's is converted once per result: the row lets go of the viewer's own
 * values on a new object (tracking-compact.tsx).
 */
const askedOn = (tracking: Tracking | null | undefined, uri: string) =>
  tracking && tracking._id !== trackingId(uri) && tracking.answers.some(ambiguous)
    ? { ...tracking, answers: tracking.answers.map(answer => ambiguous(answer) ? { ...answer, state: TrackerState.Loading } : answer) }
    : tracking

/** Every tracker that will draw a chip as still loading, and none of the values: the row at its size, and nothing to act on. */
const loadingOf = (tracking: Tracking | undefined): Tracking | undefined =>
  tracking && {
    ...tracking,
    summary: null,
    disagreements: [],
    answers: tracking.answers.map(answer => answer.state === TrackerState.NoId ? answer : { ...answer, state: TrackerState.Loading, entry: null }),
  }

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
  const latest = useMemo(() => askedOn(data?.tracking, asked!), [data?.tracking, asked])
  const shown = useRef<Tracking>(undefined)
  shown.current = heldOf(askedOn(shown.current, asked!), latest)
  const ready = Boolean(uri && namesSameWork(work, address))
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
        tracking={ready ? shown.current : loadingOf(shown.current)}
        episodeCount={ready ? episodeCount : undefined}
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
 * ids. A row starts afresh on a new `work`, where `uri` is unknown again, and on a move to a media
 * that is not a growth of the one asked before (`useMediaKey`), so a change made on one media is saved
 * to it and urql's last result, kept while a new subscription starts, is never drawn under another.
 * Until the details have answered, and while `address`, the page's own, names another work than `work`
 * (the render after a navigation, before the page has moved `work` to it), the row is drawn with every
 * tracker loading and none of its values.
 */
const MediaTracking = (props: Props) => {
  const media = useMediaKey(props.uri ?? props.work)
  return <WorkTracking key={`${props.work} ${media}`} {...props}/>
}

export default MediaTracking
