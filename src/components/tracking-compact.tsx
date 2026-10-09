import type { ComponentChild, ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { autoUpdate, flip, offset, safePolygon, shift, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions } from '@floating-ui/react'
import { Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { WindowSignIn } from '../sources/login-window'
import type { CompactPrefs } from '../tracking/compact-prefs'
import type { CompactAnswer, CompactTracking, Fields, Row, Settled, Target, TrackerOutcome } from '../tracking/compact'

import {
  STATUS_LABELS, countDiffers, createSaveQueue, patchFor, pickerScale, rowOf, rowOfEntry, shownOf, targetOf, unsettled, writable,
} from '../tracking/compact'
import { isScored, nativeScore } from '../tracking/score-scale'
import ScorePicker from './score-picker'

/** The sign in a tracker offers, by tracker id. Called directly in the click, so a window can open. */
export type SignIns = Record<string, () => Promise<WindowSignIn>>

const SIGN_IN_NOTES: Partial<Record<WindowSignIn, (name: string) => string>> = {
  blocked: () => 'The browser blocked the sign-in window. Allow pop-ups for this page and press Log in again.',
  unsupported: name => `Sign in to ${name} in this browser, then press Log in again.`,
}

const style = css`
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  font-size: 1.4rem;

  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.2rem; }
  .group { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem 1.2rem; }
  .platforms { margin-left: auto; justify-content: flex-end; }

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
    .spin { animation: tracking-spin 1s linear infinite; }
    .badge { position: absolute; top: 0.2rem; left: 2.4rem; width: 0.8rem; height: 0.8rem; border-radius: 50%; }
    .badge.amber { background: #fb923c; }
    .badge.red { background: #f87171; }
    &.off > .logo-button { opacity: 0.45; }
    &.cannot > .logo-button { opacity: 0.35; }
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
  @keyframes tracking-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .chip .spin { animation: none; } }

  .notes { display: flex; flex-direction: column; gap: 0.4rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .note { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
  .note.problem { color: #f87171; }
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

const scoreText = (score: number, scale?: string | null) => {
  const on = scale ?? 'POINT_100'
  return `${nativeScore(score, on)} / ${OUT_OF[on] ?? 100}`
}

// a paused or failing tracker's own words, or ours when it gave none
const whyNot = (answer: CompactAnswer) => answer.error || (answer.state === 'PAUSED' ? 'Paused for a while' : 'Could not answer')

// the status menu's choice that takes the media off the lists instead of setting a status
const REMOVE = 'REMOVE'
// the overrides key of the row itself; a card's is its tracker's id
const ROW = ''

const whatOf = (fields: Fields) => fields.remove ? 'the removal' : [
  fields.status !== undefined ? 'the status' : undefined,
  fields.progress !== undefined ? `episode ${fields.progress}` : undefined,
  fields.score !== undefined ? 'the score' : undefined,
].filter(Boolean).join(' and ')

const Logo = ({ answer }: { answer: CompactAnswer }) => (
  <span className="logo" style={answer.tracker.color ? { color: answer.tracker.color } : undefined}>
    {answer.tracker.icon ? <img src={answer.tracker.icon} alt=""/> : answer.tracker.name.slice(0, 1)}
  </span>
)

/**
 * A score, a status and an episode count. The row feeds it the summary and writes to every checked
 * tracker; a tracker's card feeds it that tracker's own entry and writes to that tracker alone.
 */
const Controls = (
  { name, shown, scale, mixed, disabled, disabledTitle, listed, removable, onChange, dots = {} }:
  {
    /** Prefixes the field names and the episode input's id, one per instance on the page. */
    name: string
    shown: Row
    scale: string
    mixed: boolean
    disabled: boolean
    disabledTitle: string
    listed: boolean
    removable: boolean
    onChange: (fields: Fields, immediate: boolean) => void
    dots?: Partial<Record<'SCORE' | 'STATUS' | 'PROGRESS', ComponentChild>>
  }
) => {
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

  return (
    <div className="group edit">
      <ScorePicker
        score={shown.score}
        scale={scale}
        mixed={mixed}
        disabled={disabled || (!listed && !shown.status && !shown.progress)}
        disabledTitle={disabled ? disabledTitle : 'Pick a status or add an episode first'}
        onPick={score => onChange({ score }, true)}
      />
      {dots.SCORE}
      <select
        name={`${name}-status`}
        aria-label="Status"
        value={shown.status ?? ''}
        disabled={disabled}
        onChange={event => {
          const value = event.currentTarget.value
          onChange(value === REMOVE ? { remove: true } : { status: value }, true)
        }}
      >
        {shown.status ? undefined : <option value="" disabled>Add to list</option>}
        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        {removable ? <option value={REMOVE}>Remove from list</option> : undefined}
      </select>
      {dots.STATUS}
      <span className="progress-field">
        <label for={`${name}-progress`} className="word">Episodes</label>
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
        {total ? <span className="of">/ {total}</span> : undefined}
        {dots.PROGRESS}
        <button
          type="button"
          className="more"
          aria-label="One episode more"
          disabled={disabled || (total != null && shown.progress >= total)}
          onClick={() => onChange({ progress: shown.progress + 1 }, false)}
        >
          <Plus size={14} aria-hidden="true"/>
        </button>
      </span>
      {!disabled && total && shown.progress === total && shown.status !== 'COMPLETED'
        ? <button type="button" onClick={() => onChange({ status: 'COMPLETED' }, true)}>Mark completed</button>
        : undefined}
      {!disabled && total && shown.status === 'COMPLETED' && shown.progress < total
        ? <button type="button" onClick={() => onChange({ progress: total }, true)}>Set {total} / {total}</button>
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
  const press = useClick(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { mouseOnly: true, delay: { open: 100 }, handleClose: safePolygon() }),
    useFocus(context),
    useDismiss(context),
  ])
  const name = answer.tracker.name
  return (
    <span ref={refs.setReference} className={className} data-chip={answer.tracker.id} aria-busy={busy ? 'true' : undefined} {...getReferenceProps()}>
      <button ref={logo} type="button" className="logo-button" aria-label={`${name} entry`} aria-haspopup="dialog" aria-expanded={open} {...press.reference}>
        <Logo answer={answer}/>
      </button>
      {children}
      {open
        ? (
          <div ref={refs.setFloating} style={floatingStyles} className="card" role="dialog" aria-label={`${name} entry`} data-card={answer.tracker.id} {...getFloatingProps()}>
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
 *
 * What the row shows is the worker's summary of EVERY listed tracker, checked or not: unchecking a
 * tracker means "do not write to it", never "ignore it". A change goes to each checked tracker that can
 * write, as only the fields the viewer touched (tracking/compact.ts `patchFor`), paced per tracker by
 * the save queue, so rapid + clicks become one save. Nothing is written to a tracker that is signed out,
 * paused, failing, or cannot tell which media this is. A change on a card goes to its tracker alone,
 * checked or not, through the same queue.
 */
const TrackingCompact = (
  { tracking, episodeCount, onSaveFields, onRemove, signIns = {}, prefs, onPrefs }:
  {
    tracking: CompactTracking | null | undefined
    episodeCount?: number | null
    onSaveFields: (targets: string[], entry: Fields) => Promise<TrackerOutcome[]>
    onRemove: (targets: string[]) => Promise<TrackerOutcome[]>
    signIns?: SignIns
    prefs: CompactPrefs
    onPrefs: (prefs: CompactPrefs) => void
  }
) => {
  const [, setTick] = useState(0)
  // the viewer's own values, by ROW or by the tracker whose card took them
  const [overrides, setOverrides] = useState<Record<string, Fields>>({})
  const [announced, setAnnounced] = useState('')
  const [signingIn, setSigningIn] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, string>>({})
  // one card at a time: a card holding focus stays open when the pointer leaves, so a second card
  // opened beside it would be drawn under it
  const [openCard, setOpenCard] = useState<string>()
  const latest = useRef({ onSaveFields, onRemove, tracking })
  latest.current = { onSaveFields, onRemove, tracking }

  const queue = useMemo(() => createSaveQueue({
    send: async (tracker, fields) => {
      const outcomes = await (fields.remove ? latest.current.onRemove([tracker]) : latest.current.onSaveFields([tracker], fields))
      return outcomes.find(outcome => outcome.tracker === tracker) ?? outcomes[0] ?? { outcome: 'FAILED', error: 'The write did not reach the trackers' }
    },
    onChange: (settled?: Settled) => {
      setTick(tick => tick + 1)
      if (!settled) return
      const name = latest.current.tracking?.answers.find(answer => answer.tracker.id === settled.tracker)?.tracker.name ?? settled.tracker
      const saved = settled.outcome === 'SAVED' || settled.outcome === 'QUEUED'
      setAnnounced(saved ? `${settled.fields.remove ? 'Removed from' : 'Saved to'} ${name}` : `${name} did not save: ${settled.error ?? settled.outcome.toLowerCase()}`)
      // a save that did not land falls back to what the trackers hold, beside its note
      if (!saved && queue.idle()) setOverrides({})
    },
  }), [])

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

  if (!tracking?.answers.length) return null

  const shown = shownOf(row, overrides[ROW])
  const answers = tracking.answers
  const targets = answers.map(answer => ({ answer, target: targetOf(answer, prefs.targets[answer.tracker.id]) }))
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
    queue.stage(patches, immediate)
  }

  // one tracker's card, on that tracker's own entry and count
  const changeOne = (answer: CompactAnswer, fields: Fields, immediate: boolean) => {
    const id = answer.tracker.id
    const values = shownOf(rowOfEntry(answer, row.total), overrides[id])
    remember(id, fields)
    const patch = patchFor(answer, fields, { ...values, ...fields })
    if (patch) queue.stage({ [id]: patch }, immediate, true)
  }

  // a removal that could not go is moot once its tracker answers that it lists nothing
  const stateOf = (answer: CompactAnswer) => {
    const state = queue.state(answer.tracker.id)
    return state.failed?.fields.remove && answer.state === 'NOT_LISTED' ? { ...state, failed: undefined } : state
  }

  const setChecked = (id: string, on: boolean) => {
    if (!on) queue.drop(id)
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
        error => error instanceof Error ? error.message : String(error),
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

  const loginButton = (answer: CompactAnswer, className?: string) => (
    <button
      type="button"
      className={className}
      aria-label={`Log in to ${answer.tracker.name}`}
      disabled={!signIns[answer.tracker.id] || signingIn.has(answer.tracker.id)}
      onClick={() => signIn(answer)}
    >
      {signingIn.has(answer.tracker.id) ? 'Logging in' : 'Log in'}
    </button>
  )

  const countNote = (answer: CompactAnswer) =>
    `${answer.tracker.name} counts ${rowOfEntry(answer, row.total).total} episodes, so the row leaves its progress alone`

  const card = (answer: CompactAnswer, target: Target) => {
    const id = answer.tracker.id
    const name = answer.tracker.name
    const head = (
      <div className="head">
        <Logo answer={answer}/>
        {name}
        {answer.tracker.account ? <span className="account">{answer.tracker.account}</span> : undefined}
      </div>
    )
    if (target.kind === 'login') return <>{head}<span className="why">Signed out</span>{loginButton(answer)}</>
    if (target.kind === 'cannot') return <>{head}<span className="why">{name} cannot track this media: {target.reason}</span></>
    const canWrite = writable(answer)
    const entry = rowOfEntry(answer, row.total)
    const scale = pickerScale([answer.tracker.scoreScale])!
    return (
      <>
        {head}
        <Controls
          name={`card-${id}`}
          shown={shownOf(entry, overrides[id])}
          scale={scale.scale}
          mixed={false}
          disabled={!canWrite}
          disabledTitle={whyNot(answer)}
          listed={answer.state === 'LISTED'}
          removable={canWrite && answer.state === 'LISTED'}
          onChange={(fields, immediate) => changeOne(answer, fields, immediate)}
        />
        {canWrite ? undefined : <span className="why">{whyNot(answer)}</span>}
        {answer.tracker.writeNotice ? <span className="why">{answer.tracker.writeNotice}</span> : undefined}
        {countDiffers(answer, row.total) ? <span className="why">{countNote(answer)}: set it here.</span> : undefined}
      </>
    )
  }

  const valuesOf = (read: (answer: CompactAnswer) => string | undefined) =>
    answers.filter(answer => answer.state === 'LISTED').map(answer => `${answer.tracker.name} ${read(answer) ?? 'none'}`).join(', ')
  const differs = (field: string, read: (answer: CompactAnswer) => string | undefined) =>
    row.differs.includes(field) ? <span className="differs" data-differs={field} title={valuesOf(read)}/> : undefined

  return (
    <section css={style} className="tracking-compact" aria-label="Quick tracking">
      <div className="row">
        <Controls
          name="compact"
          shown={shown}
          scale={picker?.scale ?? 'POINT_100'}
          mixed={picker?.mixed ?? false}
          disabled={disabled}
          disabledTitle="Check a list to save to"
          listed={answers.some(answer => answer.state === 'LISTED')}
          removable={sendable.some(answer => answer.state === 'LISTED')}
          onChange={change}
          dots={{
            SCORE: differs('SCORE', answer => isScored(answer.entry?.score) ? scoreText(answer.entry.score, answer.tracker.scoreScale) : undefined),
            STATUS: differs('STATUS', answer => answer.entry?.status ? STATUS_LABELS[answer.entry.status] : undefined),
            PROGRESS: differs('PROGRESS', answer => answer.entry?.progress != null ? String(answer.entry.progress) : undefined),
          }}
        />
        <div className="group platforms">
          {targets.map(({ answer, target }) => {
            const id = answer.tracker.id
            const name = answer.tracker.name
            const chip = {
              answer,
              open: openCard === id,
              onOpen: (open: boolean) => setOpenCard(current => open ? id : current === id ? undefined : current),
              card: () => card(answer, target),
            }
            if (target.kind === 'login') {
              return <Chip key={id} {...chip} className="chip login">{loginButton(answer, 'login-button')}</Chip>
            }
            if (target.kind === 'cannot') {
              return (
                <Chip key={id} {...chip} className="chip cannot">
                  <span className="slot" role="img" aria-label={`${name} cannot track this media: ${target.reason}`}><Minus size={14} aria-hidden="true"/></span>
                </Chip>
              )
            }
            const { busy, failed } = stateOf(answer)
            const problem = answer.state === 'PAUSED' || answer.state === 'ERROR' ? whyNot(answer) : undefined
            return (
              <Chip key={id} {...chip} className={`chip${target.checked ? '' : ' off'}`} busy={busy}>
                <label>
                  <input
                    type="checkbox"
                    className="sr-only"
                    name={`compact-target-${id}`}
                    aria-label={`Save to ${name}`}
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
                {failed || answer.state === 'ERROR' ? <span className="badge red" data-badge="red"/> : answer.state === 'PAUSED' ? <span className="badge amber" data-badge="amber"/> : undefined}
                {problem ? <span id={`compact-hint-${id}`} className="sr-only">{problem}</span> : undefined}
              </Chip>
            )
          })}
        </div>
      </div>
      <div className="notes">
        {targets.flatMap(({ answer, target }) => {
          const id = answer.tracker.id
          const name = answer.tracker.name
          const { failed, refused } = stateOf(answer)
          return [
            notes[id] && answer.state === 'SIGNED_OUT' ? <div key={`${id}-sign-in`} className="note" data-note={id}>{notes[id]}</div> : undefined,
            failed
              ? (
                <div key={`${id}-failed`} className="note problem" data-note={id}>
                  {name} did not save {whatOf(failed.fields)}: {failed.error}
                  <button type="button" disabled={!writable(answer)} onClick={() => queue.retry(id)}>Retry</button>
                </div>
              )
              : undefined,
            refused
              ? (
                <div key={`${id}-refused`} className="note problem" data-note={id}>
                  {name} did not save: {refused}
                  <button type="button" onClick={() => queue.dismiss(id)}>Dismiss</button>
                </div>
              )
              : undefined,
            target.kind === 'check' && target.sendable && countDiffers(answer, row.total)
              ? <div key={`${id}-count`} className="note" data-note={id}>{countNote(answer)}: set it on {name}'s card, from its logo.</div>
              : undefined,
          ].filter(Boolean)
        })}
      </div>
      <div className="sr-only" role="status">{announced}</div>
    </section>
  )
}

export default TrackingCompact
