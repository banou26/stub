import type { ComponentChild, ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { autoUpdate, flip, offset, safePolygon, shift, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions } from '@floating-ui/react'
import { Check, ChevronsLeftRight, ChevronsRightLeft, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { defineMessages, useIntl, type IntlShape } from 'react-intl'

import type { Said } from '../i18n/said'
import type { WindowSignIn } from '../sources/login-window'
import type { CompactPrefs } from '../tracking/compact-prefs'
import type { CompactAnswer, CompactTracking, Fields, Row, Settled, Target, TrackerOutcome } from '../tracking/compact'
import type { Watched } from '../tracking/watched'

import { NAME_LIST, wordsOf } from '../i18n'
import { forPage } from '../i18n/said'
import {
  LIST_STATUSES, canRemove, countDiffers, createSaveQueue, patchFor, pickerScale, rowOf, rowOfEntry, shownOf, stepsProgress, targetOf, unsettled, whyNot, writable,
} from '../tracking/compact'
import { isScored, nativeScore } from '../tracking/score-scale'
import { WATCHED_AT, watchedPatches } from '../tracking/watched'
import SaveProblems from './save-problems'
import ScorePicker from './score-picker'

/** The sign in a tracker offers, by tracker id. Called directly in the click, so a window can open. */
export type SignIns = Record<string, () => Promise<WindowSignIn>>

const SIGN_IN_NOTES: Partial<Record<WindowSignIn, (name: string) => Said>> = {
  blocked: () => forPage.formatMessage({ id: 'The browser blocked the sign-in window: allow pop-ups, then press Log in again.', defaultMessage: 'The browser blocked the sign-in window: allow pop-ups, then press Log in again.' }),
  unsupported: name => forPage.formatMessage({ id: 'Sign in to {name} in this browser, then press Log in again.', defaultMessage: 'Sign in to {name} in this browser, then press Log in again.' }, { name }),
}

const LIST_STATUS = defineMessages({
  WATCHING: { id: 'Watching#list status', defaultMessage: 'Watching', description: 'list status' },
  REWATCHING: { id: 'Rewatching#list status', defaultMessage: 'Rewatching', description: 'list status' },
  PLANNING: { id: 'Plan to watch#list status', defaultMessage: 'Plan to watch', description: 'list status' },
  COMPLETED: { id: 'Completed#list status', defaultMessage: 'Completed', description: 'list status' },
  PAUSED: { id: 'Paused#list status', defaultMessage: 'Paused', description: 'list status' },
  DROPPED: { id: 'Dropped#list status', defaultMessage: 'Dropped', description: 'list status' },
})

const statusLabel = (intl: IntlShape, status: string) => {
  const label = LIST_STATUS[status as keyof typeof LIST_STATUS]
  return label ? intl.formatMessage(label) : status
}

const style = css`
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  font-size: 1.4rem;

  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 1rem 1.2rem; }
  .group { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.2rem; }
  .platforms { justify-content: flex-end; }
  /* a line of its own where the trackers may not fit beside the controls once they answer, the chips
     below 768 px and the tiles on a phone, so it is there before they are */
  @media (max-width: 768px) {
    .row, .platforms { justify-content: flex-start; }
    .platforms.expanded { flex-basis: 100%; }
  }
  @media (max-width: 480px) {
    .platforms { flex-basis: 100%; }
  }

  button, select, .progress-field, .chip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.4rem;
    padding: 0 1rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font: inherit;
    font-size: 1.4rem;
  }
  button { cursor: pointer; }
  button:disabled, select:disabled { opacity: 0.5; cursor: default; }
  .star .value { font-weight: 600; }
  select option { background: #17171a; }
  /* the width "Plan to watch" gave it, so offering Remove from list never widens it and wraps the row */
  select { width: 14rem; }

  button.watched svg { opacity: 0.35; }
  button.watched.on { border-color: rgba(74, 222, 128, 0.5); background: rgba(74, 222, 128, 0.12); color: #4ade80; }
  button.watched.on svg { opacity: 1; }

  .progress-field {
    input {
      width: 4.4ch;
      padding: 0;
      border: none;
      border-bottom: 0.1rem solid rgba(255, 255, 255, 0.3);
      background: none;
      color: #fff;
      font: inherit;
      text-align: center;
      -moz-appearance: textfield;
      &::-webkit-inner-spin-button { display: none; }
    }
    .of { color: rgba(255, 255, 255, 0.6); }
    .more {
      justify-content: center;
      width: 2.6rem;
      height: 2.6rem;
      padding: 0;
      border-radius: 50%;
      border-color: rgba(255, 255, 255, 0.25);
    }
  }
  .differs { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: #fb923c; }

  .expand {
    padding: 0 0.6rem;
    > svg { opacity: 0.6; }
  }
  /* two tiles high, as tall as the controls beside them */
  .tiles { display: grid; grid-template-rows: repeat(2, 1.4rem); grid-auto-flow: column; grid-auto-columns: 1.4rem; gap: 0.2rem 0.4rem; }
  .tile {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    .logo { width: 1.4rem; height: 1.4rem; border-radius: 0.3rem; font-size: 0.9rem; }
    &.loading .logo, &.cannot .logo { opacity: 0.35; }
    &.off .logo, &.login .logo { opacity: 0.45; }
    .mark {
      position: absolute;
      right: -0.25rem;
      bottom: -0.2rem;
      display: flex;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      box-shadow: 0 0 0 0.1rem #17171a;
      color: #fff;
    }
    &.on .mark { background: #4ade80; }
    &.off .mark { box-sizing: border-box; border: 0.15rem solid rgba(255, 255, 255, 0.55); background: #17171a; }
    &.login .mark { background: rgba(255, 255, 255, 0.6); }
    &.error .mark { background: #f87171; }
    &.paused .mark { background: #fb923c; }
    &.cannot .mark { display: none; }
    &.loading .mark, &.busy .mark { right: -0.4rem; bottom: -0.35rem; width: auto; height: auto; background: #17171a; }
  }

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.08);
    font-size: 1.2rem;
    font-weight: 700;
    overflow: hidden;
    img { width: 100%; height: 100%; object-fit: contain; }
  }

  .chip {
    position: relative;
    padding: 0 0.6rem;
    border-color: rgba(255, 255, 255, 0.12);
    background: none;
    &:focus-within { outline: 0.2rem solid #fff; outline-offset: 0.1rem; }
    > .logo-button { height: auto; padding: 0; border: none; background: none; }
    /* the check takes the chip's free area, the gap and the padding beside it included */
    > label { display: flex; align-items: center; align-self: stretch; margin: 0 -0.6rem; padding: 0 0.6rem; cursor: pointer; }
    .slot { display: flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; }
    .check { width: 1.6rem; height: 1.6rem; border-radius: 50%; background: #4ade80; color: #000; display: flex; align-items: center; justify-content: center; }
    .ring { width: 1.4rem; height: 1.4rem; border-radius: 50%; border: 0.15rem solid rgba(255, 255, 255, 0.45); }
    .badge { position: absolute; top: 0.2rem; left: 2.4rem; width: 0.8rem; height: 0.8rem; border-radius: 50%; }
    .badge.amber { background: #fb923c; }
    .badge.red { background: #f87171; }
    &.off > .logo-button { opacity: 0.45; }
    &.cannot > .logo-button, &.loading > .logo-button { opacity: 0.35; }
    .login-button { height: 2.6rem; padding: 0 0.8rem; font-size: 1.2rem; }
  }

  /* fixed and not portalled, so inside the modal it paints over the episode rows' z-index 1 links */
  .card {
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: max-content;
    max-width: calc(100vw - 1.6rem);
    padding: 1.2rem;
    border-radius: 0.8rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.15);
    background: #17171a;
    box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.6);
    cursor: default;
    .head { display: flex; align-items: center; gap: 0.8rem; font-weight: 600; }
    .account { font-weight: normal; color: rgba(255, 255, 255, 0.55); }
    .why { max-width: 34rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  }
  .spin { animation: tracking-spin 1s linear infinite; }
  @keyframes tracking-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }

  .notes { display: flex; flex-direction: column; gap: 0.4rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .note { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
  .note button { height: 2.6rem; font-size: 1.2rem; }

  /* not .hidden, which the app's global stylesheet sets to display: none */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .progress-field .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .platforms { gap: 0.8rem; }
    .chip { gap: 0.4rem; padding: 0 0.4rem; }
    .chip > label { margin: 0 -0.4rem; padding: 0 0.4rem; }
    .chip .login-button { padding: 0 0.6rem; }
  }
`

const OUT_OF: Record<string, number> = { POINT_3: 3, POINT_5: 5, POINT_10: 10, POINT_10_DECIMAL: 10 }

const scoreText = (intl: IntlShape, score: number, scale?: string | null) => {
  const on = scale ?? 'POINT_100'
  return intl.formatMessage({ id: '{score, number} / {max, number}', defaultMessage: '{score, number} / {max, number}' }, { score: nativeScore(score, on), max: OUT_OF[on] ?? 100 })
}

// the status menu's choice that takes the media off the lists instead of setting a status
const REMOVE = 'REMOVE'
// the overrides key of the row itself; a card's is its tracker's id
const ROW = ''

const Logo = ({ answer }: { answer: CompactAnswer }) => (
  <span className="logo" style={answer.tracker.color ? { color: answer.tracker.color } : undefined}>
    {answer.tracker.icon ? <img src={answer.tracker.icon} alt=""/> : answer.tracker.name.slice(0, 1)}
  </span>
)

const problemOf = (answer: CompactAnswer) => answer.state === 'PAUSED' || answer.state === 'ERROR' ? wordsOf(whyNot(answer)) : undefined

type TileState = 'loading' | 'login' | 'cannot' | 'busy' | 'error' | 'paused' | 'on' | 'off'

const tileState = (answer: CompactAnswer, target: Target, { busy, failed }: { busy?: boolean, failed?: unknown }): TileState =>
  target.kind !== 'check' ? target.kind
  : busy ? 'busy'
  : failed || answer.state === 'ERROR' ? 'error'
  : answer.state === 'PAUSED' ? 'paused'
  : target.checked ? 'on' : 'off'

const Tile = ({ answer, state }: { answer: CompactAnswer, state: TileState }) => {
  const label = useIntl().formatMessage({
    id: '{name}: {state, select, loading {loading} login {signed out} cannot {cannot track this media} busy {updating} error {error} paused {paused} on {connected} other {off}}',
    defaultMessage: '{name}: {state, select, loading {loading} login {signed out} cannot {cannot track this media} busy {updating} error {error} paused {paused} on {connected} other {off}}',
  }, { name: answer.tracker.name, state })
  return (
    <span className={`tile ${state}`} data-tile={answer.tracker.id} role="img" aria-label={label} title={label}>
      <Logo answer={answer}/>
      <span className="mark">{state === 'loading' || state === 'busy' ? <LoaderCircle size={10} className="spin" aria-hidden="true"/> : undefined}</span>
    </span>
  )
}

const saved = ({ outcome }: { outcome: string }) => outcome === 'SAVED' || outcome === 'QUEUED'

const Badge = ({ answer, failed }: { answer: CompactAnswer, failed?: unknown }) =>
  failed || answer.state === 'ERROR' ? <span className="badge red" data-badge="red"/>
  : answer.state === 'PAUSED' ? <span className="badge amber" data-badge="amber"/>
  : null

/**
 * A score, a status and an episode count, or for a movie a Watched toggle in place of the count. The
 * row feeds it the summary and writes to every checked tracker; a tracker's card feeds it that
 * tracker's own entry and writes to that tracker alone.
 */
const Controls = (
  { name, shown, scale, mixed, disabled, listed, removable, onChange, dots = {}, movie = false, statuses, clearable }:
  {
    /** Prefixes the field names and the episode input's id, one per instance on the page. */
    name: string
    /** A movie: one Watched toggle instead of an episode count. */
    movie?: boolean
    /** The statuses offered, when the tracker keeps only some. */
    statuses?: readonly string[] | null
    /** Whether the score can be cleared once given. */
    clearable?: boolean
    shown: Row
    scale: string
    mixed: boolean
    disabled: boolean
    listed: boolean
    removable: boolean
    onChange: (fields: Fields, immediate: boolean) => void
    dots?: Partial<Record<'SCORE' | 'STATUS' | 'PROGRESS', ComponentChild>>
  }
) => {
  const intl = useIntl()
  const [draft, setDraft] = useState<string>()
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commitLatest = useRef(() => {})
  const total = shown.total

  const commitDraft = () => {
    clearTimeout(draftTimer.current)
    if (draft === undefined) return
    const value = Number(draft)
    setDraft(undefined)
    if (draft.trim() === '' || !Number.isFinite(value)) return
    const progress = Math.max(0, Math.min(total ?? Infinity, Math.floor(value)))
    if (progress !== shown.progress) onChange({ progress }, true)
  }
  commitLatest.current = commitDraft
  // watching it is all there is to a movie: on, it is completed; off, back to the plan
  const watched = shown.status === 'COMPLETED' || shown.progress >= (total ?? 1)
  const toggleWatched = () => onChange(
    watched
      ? { progress: 0, ...shown.status === 'COMPLETED' ? { status: 'PLANNING' } : {} }
      : { progress: total ?? 1, status: 'COMPLETED' },
    true,
  )

  return (
    <div className="group edit">
      <ScorePicker
        score={shown.score}
        scale={scale}
        mixed={mixed}
        disabled={disabled || (!listed && !shown.status && !shown.progress)}
        clearable={clearable}
        onPick={score => onChange({ score }, true)}
      />
      {dots.SCORE}
      <select
        name={`${name}-status`}
        aria-label={intl.formatMessage({ id: 'Status', defaultMessage: 'Status' })}
        value={shown.status ?? ''}
        disabled={disabled}
        onChange={event => {
          const value = event.currentTarget.value
          onChange(value === REMOVE ? { remove: true } : { status: value }, true)
        }}
      >
        {shown.status ? undefined : <option value="" disabled>{intl.formatMessage({ id: 'Add to list', defaultMessage: 'Add to list' })}</option>}
        {LIST_STATUSES
          .filter(value => !statuses || statuses.includes(value))
          .map(value => <option key={value} value={value}>{statusLabel(intl, value)}</option>)}
        {removable ? <option value={REMOVE}>{intl.formatMessage({ id: 'Remove from list', defaultMessage: 'Remove from list' })}</option> : undefined}
      </select>
      {dots.STATUS}
      {movie
        ? (
          <>
            <button type="button" className={`watched${watched ? ' on' : ''}`} aria-pressed={watched} disabled={disabled} onClick={toggleWatched}>
              <Check size={14} aria-hidden="true"/>{intl.formatMessage({ id: 'Watched#marked as seen', defaultMessage: 'Watched', description: 'marked as seen' })}
            </button>
            {dots.PROGRESS}
          </>
        )
        : (
      <span className="progress-field">
        <label for={`${name}-progress`} className="word">{intl.formatMessage({ id: 'Episodes', defaultMessage: 'Episodes' })}</label>
        <input
          id={`${name}-progress`}
          type="number"
          inputMode="numeric"
          name={`${name}-progress`}
          min={0}
          max={total ?? undefined}
          disabled={disabled}
          value={draft ?? shown.progress}
          onInput={event => {
            setDraft(event.currentTarget.value)
            clearTimeout(draftTimer.current)
            draftTimer.current = setTimeout(() => commitLatest.current(), 1000)
          }}
          onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter') commitDraft()
            if (event.key === 'Escape') {
              clearTimeout(draftTimer.current)
              setDraft(undefined)
              event.stopPropagation()
            }
          }}
        />
        {total ? <span className="of">{intl.formatMessage({ id: '/ {total}', defaultMessage: '/ {total}' }, { total })}</span> : undefined}
        {dots.PROGRESS}
        <button
          type="button"
          className="more"
          aria-label={intl.formatMessage({ id: 'One episode more', defaultMessage: 'One episode more' })}
          disabled={disabled || (total != null && shown.progress >= total)}
          onClick={() => onChange({ progress: shown.progress + 1 }, false)}
        >
          <Plus size={14} aria-hidden="true"/>
        </button>
      </span>
        )}
      {!movie && !disabled && total && shown.progress === total && shown.status !== 'COMPLETED' && (!statuses || statuses.includes('COMPLETED'))
        ? <button type="button" onClick={() => onChange({ status: 'COMPLETED' }, true)}>{intl.formatMessage({ id: 'Mark completed', defaultMessage: 'Mark completed' })}</button>
        : undefined}
      {!movie && !disabled && total && shown.status === 'COMPLETED' && shown.progress < total
        ? <button type="button" onClick={() => onChange({ progress: total }, true)}>{intl.formatMessage({ id: 'Set {total} / {total}', defaultMessage: 'Set {total} / {total}' }, { total })}</button>
        : undefined}
    </div>
  )
}

/**
 * A tracker's chip, and the card of that tracker's own entry under it. The card opens while the
 * pointer rests on the chip or the card, while the keyboard is in either, and on a press of the logo,
 * which is how a touch screen reaches it. A press anywhere else on a chip that can be checked checks
 * or unchecks it. While focus is inside the card, the pointer leaving does not close it, and resting
 * on another chip does not open that one's. It is not portalled, so inside the modal it stays within
 * the modal's focus trap; it is fixed, and flips or shifts to stay on screen. The row says which card
 * is open, so opening one closes any other.
 */
const Chip = (
  { answer, className, busy, open, onOpen, card, children }:
  {
    answer: CompactAnswer
    className: string
    busy?: boolean
    open: boolean
    onOpen: (open: boolean) => void
    card: () => ComponentChild
    children: ComponentChildren
  }
) => {
  const logo = useRef<HTMLButtonElement>(null)
  // drawn with its card open, as a note's Open draws it: focus goes where the card's own keyboard path starts
  useEffect(() => { if (open) logo.current?.focus() }, [])
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next, _event, reason) => {
      const focused = refs.floating.current?.contains(document.activeElement) ?? false
      if (!next && focused && (reason === 'hover' || reason === 'safe-polygon')) return
      // nor does the pointer passing over this chip take the screen from a card focus is in
      if (next && reason === 'hover' && document.activeElement?.closest('[data-card]')) return
      // Escape inside the card hands focus back to the logo. That focus asks to reopen the card, so it
      // goes first and the close has the last word.
      if (!next && focused && reason === 'escape-key') logo.current?.focus()
      onOpen(next)
    },
    placement: 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  })
  const { getReferenceProps: getPressProps } = useInteractions([useClick(context)])
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { mouseOnly: true, delay: { open: 100 }, handleClose: safePolygon() }),
    useFocus(context),
    useDismiss(context),
  ])
  const entry = useIntl().formatMessage({ id: '{name} entry', defaultMessage: '{name} entry' }, { name: answer.tracker.name })
  return (
    <span ref={refs.setReference} className={className} data-chip={answer.tracker.id} aria-busy={busy ? 'true' : undefined} {...getReferenceProps()}>
      <button ref={logo} type="button" className="logo-button" aria-label={entry} aria-haspopup="dialog" aria-expanded={open} {...getPressProps()}>
        <Logo answer={answer}/>
      </button>
      {children}
      {open
        ? (
          <div ref={refs.setFloating} style={floatingStyles} className="card" role="dialog" aria-label={entry} data-card={answer.tracker.id} {...getFloatingProps()}>
            {card()}
          </div>
        )
        : undefined}
    </span>
  )
}

/**
 * The way to track a media: a score, a status and an episode count, written at once to every tracker
 * whose chip is checked, and on each chip a card with the same controls over that tracker's own entry.
 * The trackers come first, as a grid of small tiles naming each one's state, until the viewer expands
 * them into their chips (`prefs.expanded`), and the controls end the row. While they are folded, a note
 * that sends the viewer to a chip's Log in or card carries that action itself.
 *
 * What the row shows is the worker's summary of EVERY listed tracker, checked or not: unchecking a
 * tracker means "do not write to it", never "ignore it". A change goes to each checked tracker that can
 * write, as only the fields the viewer touched (tracking/compact.ts `patchFor`), paced per tracker by
 * the save queue, so rapid + clicks become one save. Nothing is written to a tracker that is signed out,
 * paused, failing, or cannot tell which media this is. A change on a card goes to its tracker alone,
 * checked or not, through the same queue. With no `tracking` yet the row holds its place, one loading
 * tile or chip and nothing to act on; a tracking with no tracker in it draws nothing.
 *
 * Once `watched` passes 85% of an episode (tracking/watched.ts), each checked tracker that can write
 * decides on that episode once, and again only after deciding on another: it is raised to the episode
 * through the same queue if that is above the progress last staged to it. So a + and the update on the
 * same episode make one save, and a progress the viewer lowers stays where they put it. Nothing is
 * raised while the row reads Completed, the viewer's own pick included. A checked tracker that cannot
 * write shows the save it missed, and is written once it can.
 */
const TrackingCompact = (
  { tracking, episodeCount, movie = false, watched, counted: kept, onSaveFields, onRemove, signIns = {}, prefs, onPrefs }:
  {
    tracking: CompactTracking | null | undefined
    episodeCount?: number | null
    /** A movie: a Watched toggle in place of the episode count, in the row and in every card. */
    movie?: boolean
    /** What the watch page's player has played of the episode. */
    watched?: Omit<Watched, 'movie'>
    /** The episode each tracker last decided on, kept by the caller across the rows it draws for one work. */
    counted?: Map<string, number | null | undefined>
    onSaveFields: (targets: string[], entry: Fields) => Promise<TrackerOutcome[]>
    onRemove: (targets: string[]) => Promise<TrackerOutcome[]>
    signIns?: SignIns
    prefs: CompactPrefs
    onPrefs: (prefs: CompactPrefs) => void
  }
) => {
  const intl = useIntl()
  const [, setTick] = useState(0)
  // the viewer's own values, by ROW or by the tracker whose card took them
  const [overrides, setOverrides] = useState<Record<string, Fields>>({})
  const [announced, setAnnounced] = useState<Settled & { name: string }>()
  const [signingIn, setSigningIn] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, Said>>({})
  // one card at a time: a card holding focus stays open when the pointer leaves, so a second card
  // opened beside it would be drawn under it
  const [openCard, setOpenCard] = useState<string>()
  const latest = useRef({ onSaveFields, onRemove, tracking, episodeCount })
  latest.current = { onSaveFields, onRemove, tracking, episodeCount }

  const queue = useMemo(() => createSaveQueue({
    send: async (tracker, fields) => {
      const outcomes = await (fields.remove ? latest.current.onRemove([tracker]) : latest.current.onSaveFields([tracker], fields))
      return outcomes.find(outcome => outcome.tracker === tracker) ?? outcomes[0]
        ?? { outcome: 'FAILED', error: forPage.formatMessage({ id: 'The write did not reach the trackers', defaultMessage: 'The write did not reach the trackers' }) }
    },
    shape: (tracker, fields) => {
      const { tracking, episodeCount } = latest.current
      const answer = tracking?.answers.find(candidate => candidate.tracker.id === tracker)
      return answer && patchFor(answer, fields, { ...rowOf(tracking, episodeCount), ...fields })
    },
    steps: tracker => stepsProgress(latest.current.tracking, tracker),
    onChange: (settled?: Settled) => {
      setTick(tick => tick + 1)
      if (!settled) return
      const name = latest.current.tracking?.answers.find(answer => answer.tracker.id === settled.tracker)?.tracker.name ?? settled.tracker
      setAnnounced({ ...settled, name })
      // a save that did not land falls back to what the trackers hold, beside its note
      if (!saved(settled) && queue.idle()) setOverrides({})
    },
  }), [])
  const staged = useRef(new Map<string, number>())
  const own = useRef(new Map<string, number | null | undefined>())
  const counted = kept ?? own.current
  const stage = (patches: Record<string, Fields>, immediate: boolean, fromCard?: boolean) => {
    for (const [id, { progress }] of Object.entries(patches)) if (progress !== undefined) staged.current.set(id, progress)
    queue.stage(patches, immediate, fromCard)
  }

  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') queue.flush() }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      queue.flush()
    }
  }, [])

  const row = rowOf(tracking, episodeCount)
  const entryOf = (id: string) => {
    const answer = tracking?.answers.find(candidate => candidate.tracker.id === id)
    return answer && rowOfEntry(answer, row.total)
  }
  // the viewer's own values show from the first click, until the trackers say the same or have all answered
  useEffect(() => {
    setOverrides(previous => queue.idle()
      ? {}
      : Object.fromEntries(Object.entries(previous).flatMap(([scope, mine]) => {
        const values = scope === ROW ? row : entryOf(scope)
        return values ? [[scope, unsettled(mine, values)]] : []
      })))
  }, [tracking])

  const shown = shownOf(row, overrides[ROW])
  const auto = watched && tracking && shown.status !== 'COMPLETED' ? watchedPatches({ ...watched, movie }, tracking, prefs.targets, episodeCount) : {}
  const decided = (id: string) => counted.has(id) && counted.get(id) === watched?.episode
  const due = tracking?.answers.filter(({ tracker: { id } }) => auto[id] && !decided(id) && auto[id].progress! > (staged.current.get(id) ?? 0)) ?? []
  useEffect(() => {
    const ready = due.filter(writable)
    if (watched && tracking && watched.played >= WATCHED_AT) {
      for (const answer of tracking.answers) {
        const target = targetOf(answer, prefs.targets[answer.tracker.id])
        if (target.kind === 'check' && target.sendable) counted.set(answer.tracker.id, watched.episode)
      }
    }
    if (ready.length) stage(Object.fromEntries(ready.map(({ tracker: { id } }) => [id, auto[id]!])), true)
  }, [watched, tracking, prefs])

  // a tracker with no id for the media can never track it, so it is left out rather than shown greyed
  const answers = tracking?.answers.filter(answer => answer.state !== 'NO_ID') ?? []
  if (tracking !== undefined && !answers.length) return null

  const targets = answers.map(answer => ({ answer, target: targetOf(answer, prefs.targets[answer.tracker.id]) }))
  const expanded = prefs.expanded === true
  const sendable = targets.filter(({ target }) => target.kind === 'check' && target.sendable).map(({ answer }) => answer)
  const disabled = !sendable.length
  const picker = pickerScale(sendable.map(answer => answer.tracker.scoreScale))

  const remember = (scope: string, fields: Fields) => {
    if (!fields.remove) setOverrides(previous => ({ ...previous, [scope]: { ...previous[scope], ...fields } }))
  }

  const change = (fields: Fields, immediate: boolean) => {
    remember(ROW, fields)
    const next: Row = { ...shown, ...fields }
    const patches: Record<string, Fields> = {}
    for (const { answer, target } of targets) {
      if (target.kind !== 'check' || !target.checked) continue
      const id = answer.tracker.id
      if (!writable(answer)) {
        queue.fail(id, fields, whyNot(answer))
        continue
      }
      const patch = patchFor(answer, fields, next)
      if (patch) patches[id] = patch
    }
    stage(patches, immediate)
  }

  // one tracker's card, on that tracker's own entry and count
  const changeOne = (answer: CompactAnswer, fields: Fields, immediate: boolean) => {
    const id = answer.tracker.id
    const values = shownOf(rowOfEntry(answer, row.total), overrides[id])
    remember(id, fields)
    const patch = patchFor(answer, fields, { ...values, ...fields })
    if (patch) stage({ [id]: patch }, immediate, true)
  }

  const stateOf = (answer: CompactAnswer) => {
    const state = queue.state(answer.tracker.id)
    // a removal that could not go is moot once its tracker answers that it lists nothing
    if (state.failed?.fields.remove && answer.state === 'NOT_LISTED') return { ...state, failed: undefined }
    // an episode watched that a checked tracker cannot write yet: the line goes once it can, as the write then goes by itself
    if (!state.failed && due.includes(answer) && !writable(answer)) return { ...state, failed: { fields: auto[answer.tracker.id]!, error: whyNot(answer) } }
    return state
  }

  const reveal = (id: string) => {
    onPrefs({ ...prefs, expanded: true })
    setOpenCard(id)
  }

  const setChecked = (id: string, on: boolean) => {
    if (!on) queue.drop(id)
    if (!on && !queue.state(id).busy) staged.current.delete(id)
    onPrefs({ ...prefs, targets: { ...prefs.targets, [id]: on } })
  }

  const signIn = (answer: CompactAnswer) => {
    const start = signIns[answer.tracker.id]
    const id = answer.tracker.id
    if (!start || signingIn.has(id)) return
    // first, before any state: the window opens with this click's activation
    const signingInNow = start()
    setSigningIn(previous => new Set(previous).add(id))
    setNotes(({ [id]: _dropped, ...rest }) => rest)
    void signingInNow
      .then(
        outcome => SIGN_IN_NOTES[outcome]?.(answer.tracker.name),
        (error): Said => error instanceof Error ? error.message : String(error),
      )
      .then(note => {
        if (note) setNotes(previous => ({ ...previous, [id]: note }))
        setSigningIn(previous => {
          const next = new Set(previous)
          next.delete(id)
          return next
        })
      })
  }

  const cannotTrack = (name: string, reason: Said) =>
    intl.formatMessage({ id: '{name} cannot track this media: {reason}', defaultMessage: '{name} cannot track this media: {reason}' }, { name, reason: wordsOf(reason) })
  const trackersLoading = intl.formatMessage({ id: 'Trackers loading', defaultMessage: 'Trackers loading' })
  // what a screen reader hears once a save settles
  const heard = ({ name, outcome, fields, error }: Settled & { name: string }) =>
    saved({ outcome })
      ? fields.remove
        ? intl.formatMessage({ id: 'Removed from {name}', defaultMessage: 'Removed from {name}' }, { name })
        : intl.formatMessage({ id: 'Saved to {name}', defaultMessage: 'Saved to {name}' }, { name })
      : error
        ? intl.formatMessage({ id: '{name} did not save: {error}', defaultMessage: '{name} did not save: {error}' }, { name, error: wordsOf(error) })
        : intl.formatMessage({ id: '{name} did not save: {outcome, select, REFUSED {refused} other {failed}}', defaultMessage: '{name} did not save: {outcome, select, REFUSED {refused} other {failed}}' }, { name, outcome })

  const loginButton = (answer: CompactAnswer, className?: string) => (
    <button
      type="button"
      className={className}
      aria-label={intl.formatMessage({ id: 'Log in to {name}', defaultMessage: 'Log in to {name}' }, { name: answer.tracker.name })}
      disabled={!signIns[answer.tracker.id] || signingIn.has(answer.tracker.id)}
      onClick={() => signIn(answer)}
    >
      {signingIn.has(answer.tracker.id) ? intl.formatMessage({ id: 'Logging in', defaultMessage: 'Logging in' }) : intl.formatMessage({ id: 'Log in', defaultMessage: 'Log in' })}
    </button>
  )

  const card = (answer: CompactAnswer, target: Target) => {
    const id = answer.tracker.id
    const name = answer.tracker.name
    const head = (
      <div className="head">
        <Logo answer={answer}/>
        {name}
        {answer.tracker.account ? <span className="account">{wordsOf(answer.tracker.account)}</span> : undefined}
      </div>
    )
    if (target.kind === 'loading') return head
    if (target.kind === 'login') return <>{head}<span className="why">{intl.formatMessage({ id: 'Signed out', defaultMessage: 'Signed out' })}</span>{loginButton(answer)}</>
    if (target.kind === 'cannot') return <>{head}<span className="why">{cannotTrack(name, target.reason)}</span></>
    const canWrite = writable(answer)
    const entry = rowOfEntry(answer, row.total)
    const scale = pickerScale([answer.tracker.scoreScale])!
    return (
      <>
        {head}
        <Controls
          name={`card-${id}`}
          movie={movie}
          statuses={answer.tracker.statuses}
          clearable={answer.tracker.canClearScore !== false}
          shown={shownOf(entry, overrides[id])}
          scale={scale.scale}
          mixed={false}
          disabled={!canWrite}
          listed={answer.state === 'LISTED'}
          removable={canWrite && canRemove(answer)}
          onChange={(fields, immediate) => changeOne(answer, fields, immediate)}
        />
        {canWrite ? undefined : <span className="why">{wordsOf(whyNot(answer))}</span>}
      </>
    )
  }

  const valuesOf = (read: (answer: CompactAnswer) => string | undefined) => intl.formatList(answers.filter(answer => answer.state === 'LISTED').map(answer => {
    const value = read(answer)
    return value === undefined
      ? intl.formatMessage({ id: '{name} none', defaultMessage: '{name} none' }, { name: answer.tracker.name })
      : intl.formatMessage({ id: '{name} {value}', defaultMessage: '{name} {value}' }, { name: answer.tracker.name, value })
  }), NAME_LIST)
  const differs = (field: string, read: (answer: CompactAnswer) => string | undefined) =>
    row.differs.includes(field) ? <span className="differs" data-differs={field} title={valuesOf(read)}/> : undefined

  return (
    <section css={style} className="tracking-compact" aria-label={intl.formatMessage({ id: 'Quick tracking', defaultMessage: 'Quick tracking' })}>
      <div className="row">
        <div className={`group platforms${expanded ? ' expanded' : ''}`}>
          <button
            type="button"
            className="expand"
            aria-expanded={expanded}
            aria-label={expanded ? intl.formatMessage({ id: 'Trackers', defaultMessage: 'Trackers' }) : undefined}
            title={expanded ? intl.formatMessage({ id: 'Collapse trackers', defaultMessage: 'Collapse trackers' }) : undefined}
            onClick={() => onPrefs({ ...prefs, expanded: !expanded })}
          >
            {expanded
              ? <ChevronsRightLeft size={14} aria-hidden="true"/>
              : (
                <>
                  <span className="tiles">
                    {
                      tracking === undefined
                        ? <span className="tile loading" role="img" aria-label={trackersLoading} title={trackersLoading}><LoaderCircle size={12} className="spin" aria-hidden="true"/></span>
                        : targets.map(({ answer, target }) => <Tile key={answer.tracker.id} answer={answer} state={tileState(answer, target, stateOf(answer))}/>)
                    }
                  </span>
                  <ChevronsLeftRight size={12} aria-hidden="true"/>
                </>
              )}
          </button>
          {
            expanded && tracking === undefined
              ? <span className="chip loading"><span className="slot" role="img" aria-label={trackersLoading}><LoaderCircle size={14} className="spin" aria-hidden="true"/></span></span>
              : undefined
          }
          {expanded && targets.map(({ answer, target }) => {
            const id = answer.tracker.id
            const name = answer.tracker.name
            const chip = {
              answer,
              open: openCard === id,
              onOpen: (open: boolean) => setOpenCard(current => open ? id : current === id ? undefined : current),
              card: () => card(answer, target),
            }
            if (target.kind === 'loading') {
              return (
                <Chip key={id} {...chip} className="chip loading" busy>
                  <span className="slot" role="img" aria-label={intl.formatMessage({ id: '{name} loading', defaultMessage: '{name} loading' }, { name })}><LoaderCircle size={14} className="spin" aria-hidden="true"/></span>
                </Chip>
              )
            }
            if (target.kind === 'login') {
              return <Chip key={id} {...chip} className="chip login">{loginButton(answer, 'login-button')}</Chip>
            }
            if (target.kind === 'cannot') {
              return (
                <Chip key={id} {...chip} className="chip cannot">
                  <span className="slot" role="img" aria-label={cannotTrack(name, target.reason)}><Minus size={14} aria-hidden="true"/></span>
                </Chip>
              )
            }
            const { busy, failed } = stateOf(answer)
            const problem = problemOf(answer)
            return (
              <Chip key={id} {...chip} className={`chip${target.checked ? '' : ' off'}`} busy={busy}>
                <label>
                  <input
                    type="checkbox"
                    className="sr-only"
                    name={`compact-target-${id}`}
                    aria-label={intl.formatMessage({ id: 'Save to {name}', defaultMessage: 'Save to {name}' }, { name })}
                    aria-describedby={problem ? `compact-hint-${id}` : undefined}
                    checked={target.checked}
                    onChange={event => setChecked(id, event.currentTarget.checked)}
                  />
                  <span className="slot">
                    {busy
                      ? <LoaderCircle size={14} className="spin" aria-hidden="true"/>
                      : target.checked ? <span className="check"><Check size={11} aria-hidden="true"/></span> : <span className="ring"/>}
                  </span>
                </label>
                <Badge answer={answer} failed={failed}/>
                {problem ? <span id={`compact-hint-${id}`} className="sr-only">{problem}</span> : undefined}
              </Chip>
            )
          })}
        </div>
        <Controls
          name="compact"
          movie={movie}
          shown={shown}
          scale={picker?.scale ?? 'POINT_100'}
          mixed={picker?.mixed ?? false}
          disabled={disabled}
          listed={answers.some(answer => answer.state === 'LISTED')}
          removable={sendable.some(canRemove)}
          onChange={change}
          dots={{
            SCORE: differs('SCORE', answer => isScored(answer.entry?.score) ? scoreText(intl, answer.entry.score, answer.tracker.scoreScale) : undefined),
            STATUS: differs('STATUS', answer => answer.entry?.status ? statusLabel(intl, answer.entry.status) : undefined),
            PROGRESS: differs('PROGRESS', answer => answer.entry?.progress != null ? String(answer.entry.progress) : undefined),
          }}
        />
      </div>
      <div className="notes">
        {targets.flatMap(({ answer, target }) => {
          const id = answer.tracker.id
          const name = answer.tracker.name
          return [
            notes[id] && answer.state === 'SIGNED_OUT'
              ? <div key={`${id}-sign-in`} className="note" data-note={id}>{wordsOf(notes[id])}{expanded ? undefined : loginButton(answer)}</div>
              : undefined,
            <SaveProblems key={`${id}-problems`} answer={answer} state={stateOf(answer)} queue={queue}/>,
            target.kind === 'check' && target.sendable && countDiffers(answer, row.total)
              ? (
                <div key={`${id}-count`} className="note" data-note={id}>
                  {intl.formatMessage({ id: '{name}: set progress on its card', defaultMessage: '{name}: set progress on its card' }, { name })}
                  {expanded ? undefined : <button type="button" aria-haspopup="dialog" onClick={() => reveal(id)}>{intl.formatMessage({ id: 'Open', defaultMessage: 'Open' })}</button>}
                </div>
              )
              : undefined,
          ].filter(Boolean)
        })}
      </div>
      <div className="sr-only" role="status">{announced ? heard(announced) : ''}</div>
    </section>
  )
}

export default TrackingCompact
