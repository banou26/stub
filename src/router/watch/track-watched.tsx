import type { PlaybackLink } from '../../party/bridge'
import type { CompactPrefsStore } from '../../tracking/compact-prefs'

import { css } from '@emotion/react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'

import { MEDIA_TRACKING, useSaveEntry } from '../../components/media-tracking-query'
import SaveProblems from '../../components/save-problems'
import { createSaveQueue, whyNot, writable } from '../../tracking/compact'
import { devicePrefs } from '../../tracking/compact-prefs'
import { watchedPatches } from '../../tracking/watched'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`

/**
 * Raises the media's trackers to the episode playing once it is watched (tracking/watched.ts), and
 * shows a save that did not land as the tracking row does, a checked tracker that could not write
 * then included. Mounted per media, so a write never lands on another media's trackers.
 */
const TrackWatched = (
  { link, uri, episode, movie = false, title, cover, episodeCount, prefs = devicePrefs }:
  {
    link: PlaybackLink | undefined
    uri: string
    episode: number | null | undefined
    movie?: boolean
    title?: string | null
    cover?: string | null
    episodeCount?: number | null
    prefs?: CompactPrefsStore
  }
) => {
  const [{ data }] = useSubscription({ query: MEDIA_TRACKING, variables: { input: { uri } } })
  const saveEntry = useSaveEntry({ uri, title, cover, episodeCount })
  const [played, setPlayed] = useState({ episode, share: 0 })
  const [, setTick] = useState(0)
  // the progress each tracker was last sent, so a re-read that has not come back yet never lowers it
  const sent = useRef(new Map<string, number>())
  const latest = useRef(saveEntry)
  latest.current = saveEntry

  const queue = useMemo(() => createSaveQueue({
    send: async (tracker, fields) => {
      const outcomes = await latest.current([tracker], fields)
      return outcomes.find(outcome => outcome.tracker === tracker) ?? outcomes[0] ?? { outcome: 'FAILED' }
    },
    onChange: () => setTick(tick => tick + 1),
  }), [])

  // The share counts only while playing, so a seek past the mark while paused is not watching it. A
  // player that does not say its length counts at its end, if it played.
  useEffect(() => {
    if (!link) return
    let playing = false
    return link.onReport(({ paused, time }) => {
      playing ||= !paused
      const length = link.duration?.() ?? 0
      const share = length > 0 ? (paused ? 0 : time / length) : link.ended?.() ? Number(playing) : 0
      setPlayed(previous => previous.episode !== episode ? { episode, share } : share > previous.share ? { episode, share } : previous)
    })
  }, [link, episode])

  const tracking = data?.tracking
  const answers = tracking?.answers ?? []
  const patches = tracking ? watchedPatches({ played: played.share, episode: played.episode, movie }, tracking, prefs.read().targets, episodeCount) : {}
  const due = answers.filter(({ tracker: { id } }) => patches[id] && patches[id].progress! > (sent.current.get(id) ?? 0))

  useEffect(() => {
    const ready = due.filter(writable)
    for (const { tracker: { id } } of ready) sent.current.set(id, patches[id]!.progress!)
    if (ready.length) queue.stage(Object.fromEntries(ready.map(({ tracker: { id } }) => [id, patches[id]!])), true)
  }, [played, tracking])

  const problems = answers.flatMap(answer => {
    const state = queue.state(answer.tracker.id)
    // a checked tracker that could not write: its line goes once it can, as the write then goes by itself
    const failed = state.failed ?? (due.includes(answer) && !writable(answer) ? { fields: patches[answer.tracker.id]!, error: whyNot(answer) } : undefined)
    return failed || state.refused ? [<SaveProblems key={answer.tracker.id} answer={answer} state={{ ...state, failed }} queue={queue}/>] : []
  })
  return problems.length ? <div css={style}>{problems}</div> : null
}

export default TrackWatched
