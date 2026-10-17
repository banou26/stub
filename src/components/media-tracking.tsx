import type { MediaTrackingSubscription } from '../generated/graphql'
import type { PlaybackLink } from '../party/bridge'
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
  /** Whether the lines about stub's own list (StubListNotice) show under the row. */
  notice?: boolean
  /** The watch page's player, and the number of the episode it plays: watching it raises the trackers. */
  link?: PlaybackLink
  episode?: number | null
}

/**
 * How much of `episode` the player has played, from 0 to 1. It counts only while playing, so a seek
 * past the mark while paused is not watching it; a player that does not say its length counts at its
 * end, if it played.
 */
const usePlayed = (link: PlaybackLink | undefined, episode: number | null | undefined) => {
  const [played, setPlayed] = useState({ episode, played: 0 })
  useEffect(() => {
    if (!link) return
    let playing = false
    return link.onReport(({ paused, time }) => {
      playing ||= !paused
      const length = link.duration?.() ?? 0
      const share = length > 0 ? (paused ? 0 : time / length) : link.ended?.() ? Number(playing) : 0
      setPlayed(previous => previous.episode !== episode || share > previous.played ? { episode, played: share } : previous)
    })
  }, [link, episode])
  return played
}

const WorkTracking = (
  { work, address, uri, title, cover, episodeCount, movie, prefsStore = devicePrefs, notice = true, link, episode, sameWork, counted }:
  Props & { sameWork: boolean, counted: Map<string, number | null | undefined> }
) => {
  const asked = uri ?? work
  const [{ data }] = useSubscription({ query: MEDIA_TRACKING, variables: { input: { uri: asked! } }, pause: !asked })
  const latest = useMemo(() => askedOn(data?.tracking, asked!), [data?.tracking, asked])
  const shown = useRef<Tracking>(undefined)
  shown.current = heldOf(askedOn(shown.current, asked!), latest)
  const ready = Boolean(uri && namesSameWork(work, address))
  const onSaveFields = useSaveEntry({ uri: uri!, title, cover, episodeCount })
  const [, remove] = useMutation(DELETE_LIST_ENTRY)
  const [{ data: storage }] = useSubscription({ query: STUB_TRACKER_STORAGE, pause: !notice })
  const [, addHeld] = useMutation(ADD_HELD_STUB_ENTRIES)
  const [prefs, setPrefs] = useState(prefsStore.read)
  const [begun] = useState(sameWork ? undefined : link)
  const watched = usePlayed(link !== begun ? link : undefined, episode)

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
        watched={watched}
        counted={counted}
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
 * tracker loading and none of its values. On the watch page, an episode `link` plays raises the
 * trackers once watched (TrackingCompact's `watched`). Within one `work`, an episode counts once, for
 * the media the row is on as that episode passes 85% played: a row started over on a move under the
 * same `work` (a show's details that turn out to be its first season) hears the player already up, and
 * shares what was counted with the row before it. A row on another `work` counts afresh, and hears only
 * a player that comes up after it.
 */
const MediaTracking = (props: Props) => {
  const media = useMediaKey(props.uri ?? props.work)
  const marks = useRef({ work: props.work, counted: new Map<string, number | null | undefined>() })
  const sameWork = marks.current.work === props.work
  if (!sameWork) marks.current = { work: props.work, counted: new Map() }
  return <WorkTracking key={`${props.work} ${media}`} {...props} sameWork={sameWork} counted={marks.current.counted}/>
}

export default MediaTracking
