import { css } from '@emotion/react'
import { Check, LoaderCircle, Minus, Plus, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import type { CompactPrefs } from '../tracking/compact-prefs'
import type { Fields, Row, Settled } from '../tracking/compact'
import type { PanelAnswer, PanelOutcome, PanelTracking, SignIns } from './tracking-panel'

import { countDiffers, createSaveQueue, patchFor, pickerScale, rowOf, targetOf, writable } from '../tracking/compact'
import { isScored, nativeScore } from '../tracking/score-scale'
import ScorePicker from './score-picker'
import { SIGN_IN_NOTES, STATUS_LABELS } from './tracking-panel'

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

  .chip {
    position: relative;
    padding: 0 0.6rem;
    border-color: rgba(255, 255, 255, 0.12);
    background: none;
    cursor: pointer;
    &:focus-within { outline: 0.2rem solid #fff; outline-offset: 0.1rem; }
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
    .slot { display: flex; align-items: center; justify-content: center; width: 1.6rem; height: 1.6rem; }
    .check { width: 1.6rem; height: 1.6rem; border-radius: 50%; background: #4ade80; color: #000; display: flex; align-items: center; justify-content: center; }
    .ring { width: 1.4rem; height: 1.4rem; border-radius: 50%; border: 0.15rem solid rgba(255, 255, 255, 0.45); }
    .spin { animation: tracking-spin 1s linear infinite; }
    .badge { position: absolute; top: 0.2rem; left: 2.4rem; width: 0.8rem; height: 0.8rem; border-radius: 50%; }
    .badge.amber { background: #fb923c; }
    .badge.red { background: #f87171; }
    &.off .logo { opacity: 0.45; }
    &.cannot .logo { opacity: 0.35; }
    &.login { cursor: default; }
    .login-button { height: 2.6rem; padding: 0 0.8rem; font-size: 1.2rem; }
  }
  @keyframes tracking-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .chip .spin { animation: none; } }

  .advanced {
    border: none;
    color: rgba(255, 255, 255, 0.55);
    &[aria-expanded='true'] { background: rgba(255, 255, 255, 0.12); color: #fff; }
  }

  .notes { display: flex; flex-direction: column; gap: 0.4rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .note { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
  .note.problem { color: #f87171; }
  .note button { height: 2.6rem; font-size: 1.2rem; }

  .hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  @media (max-width: 600px) {
    .progress-field .word, .advanced .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .platforms { gap: 0.8rem; }
    .chip { gap: 0.4rem; padding: 0 0.4rem; }
    .chip .login-button { padding: 0 0.6rem; }
  }
`

const OUT_OF: Record<string, number> = { POINT_3: 3, POINT_5: 5, POINT_10: 10, POINT_10_DECIMAL: 10 }

const scoreText = (score: number, scale?: string | null) => {
  const on = scale ?? 'POINT_100'
  return `${nativeScore(score, on)} / ${OUT_OF[on] ?? 100}`
}

const own = (answer: PanelAnswer, total: number | null) => {
  switch (answer.state) {
    case 'LISTED': {
      const entry = answer.entry!
      const count = entry.episodeCount ?? total
      return [
        entry.status ? STATUS_LABELS[entry.status] ?? entry.status : undefined,
        entry.progress != null ? (count ? `${entry.progress} / ${count}` : `${entry.progress} episodes`) : undefined,
        isScored(entry.score) ? scoreText(entry.score, answer.tracker.scoreScale) : undefined,
      ].filter(Boolean).join(', ') || 'Listed'
    }
    case 'NOT_LISTED': return 'Not listed'
    case 'PAUSED': return answer.error || 'Paused for a while'
    default: return answer.error || 'Could not answer'
  }
}

const whatOf = (fields: Fields) => [
  fields.status !== undefined ? 'the status' : undefined,
  fields.progress !== undefined ? `episode ${fields.progress}` : undefined,
  fields.score !== undefined ? 'the score' : undefined,
].filter(Boolean).join(' and ')

const Logo = ({ answer }: { answer: PanelAnswer }) => (
  <span className="logo" style={answer.tracker.color ? { color: answer.tracker.color } : undefined}>
    {answer.tracker.icon ? <img src={answer.tracker.icon} alt=""/> : answer.tracker.name.slice(0, 1)}
  </span>
)

/**
 * The quick way to track a media: a score, a status and an episode count, written at once to every
 * tracker whose chip is checked, and a toggle for the full tracking panel.
 *
 * What it shows is the worker's summary of EVERY listed tracker, checked or not: unchecking a tracker
 * means "do not write to it", never "ignore it". A change goes to each checked tracker that can write,
 * as only the fields the viewer touched (tracking/compact.ts `patchFor`), paced per tracker by the
 * save queue, so rapid + clicks become one save. Nothing is written to a tracker that is signed out,
 * paused, failing, or cannot tell which media this is.
 */
const TrackingCompact = (
  { tracking, episodeCount, onSaveFields, signIns = {}, prefs, onPrefs }:
  {
    tracking: PanelTracking | null | undefined
    episodeCount?: number | null
    onSaveFields: (targets: string[], entry: Fields) => Promise<PanelOutcome[]>
    signIns?: SignIns
    prefs: CompactPrefs
    onPrefs: (prefs: CompactPrefs) => void
  }
) => {
  const [, setTick] = useState(0)
  const [override, setOverride] = useState<Fields>({})
  const [draft, setDraft] = useState<string>()
  const [announced, setAnnounced] = useState('')
  const [signingIn, setSigningIn] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState<Record<string, string>>({})
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commitLatest = useRef(() => {})
  const latest = useRef({ onSaveFields, tracking })
  latest.current = { onSaveFields, tracking }

  const queue = useMemo(() => createSaveQueue({
    send: async (tracker, fields) => {
      const outcomes = await latest.current.onSaveFields([tracker], fields)
      return outcomes.find(outcome => outcome.tracker === tracker) ?? outcomes[0] ?? { outcome: 'FAILED', error: 'The write did not reach the trackers' }
    },
    onChange: (settled?: Settled) => {
      setTick(tick => tick + 1)
      if (!settled) return
      const name = latest.current.tracking?.answers.find(answer => answer.tracker.id === settled.tracker)?.tracker.name ?? settled.tracker
      const saved = settled.outcome === 'SAVED' || settled.outcome === 'QUEUED'
      setAnnounced(saved ? `Saved to ${name}` : `${name} did not save: ${settled.error ?? settled.outcome.toLowerCase()}`)
      // a save that did not land falls back to what the trackers hold, beside its note
      if (!saved && queue.idle()) setOverride({})
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
  // the viewer's own values show from the first click, until the trackers say the same or have all answered
  useEffect(() => {
    setOverride(previous => {
      if (queue.idle()) return {}
      const next: Fields = { ...previous }
      if (next.status === row.status) delete next.status
      if (next.progress === row.progress) delete next.progress
      if (next.score !== undefined && (next.score ?? null) === row.score) delete next.score
      return next
    })
  }, [tracking])

  if (!tracking?.answers.length) return null

  const shown: Row = {
    ...row,
    ...(override.status !== undefined ? { status: override.status } : {}),
    ...(override.progress !== undefined ? { progress: override.progress } : {}),
    ...(override.score !== undefined ? { score: override.score } : {}),
  }
  const answers = tracking.answers
  const targets = answers.map(answer => ({ answer, target: targetOf(answer, prefs.targets[answer.tracker.id]) }))
  const sendable = targets.filter(({ target }) => target.kind === 'check' && target.sendable).map(({ answer }) => answer)
  const disabled = !sendable.length
  const picker = pickerScale(sendable.map(answer => answer.tracker.scoreScale))
  const listed = answers.some(answer => answer.state === 'LISTED')
  const total = shown.total

  const change = (fields: Fields, immediate: boolean) => {
    setOverride(previous => ({ ...previous, ...fields }))
    const next: Row = { ...shown, ...fields }
    const patches: Record<string, Fields> = {}
    for (const { answer, target } of targets) {
      if (target.kind !== 'check' || !target.checked) continue
      const id = answer.tracker.id
      if (!writable(answer)) {
        queue.fail(id, fields, answer.error || (answer.state === 'PAUSED' ? 'Paused for a while' : 'Could not answer'))
        continue
      }
      const patch = patchFor(answer, fields, next)
      if (patch) patches[id] = patch
    }
    queue.stage(patches, immediate)
  }

  const setChecked = (id: string, on: boolean) => {
    if (!on) queue.drop(id)
    onPrefs({ ...prefs, targets: { ...prefs.targets, [id]: on } })
  }

  const signIn = (answer: PanelAnswer) => {
    const start = signIns[answer.tracker.id]
    const id = answer.tracker.id
    if (!start || signingIn.has(id)) return
    // first, before any state: the window opens with this click's activation
    const signingInNow = start()
    setSigningIn(previous => new Set(previous).add(id))
    setNotes(({ [id]: _dropped, ...rest }) => rest)
    signingInNow
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

  const commitDraft = () => {
    clearTimeout(draftTimer.current)
    if (draft === undefined) return
    const value = Number(draft)
    setDraft(undefined)
    if (draft.trim() === '' || !Number.isFinite(value)) return
    const progress = Math.max(0, Math.min(total ?? Infinity, Math.floor(value)))
    if (progress !== shown.progress) change({ progress }, true)
  }
  commitLatest.current = commitDraft

  const valuesOf = (read: (answer: PanelAnswer) => string | undefined) =>
    `${answers.filter(answer => answer.state === 'LISTED').map(answer => `${answer.tracker.name} ${read(answer) ?? 'none'}`).join(', ')} (Advanced can sync them)`
  const differs = (field: string, read: (answer: PanelAnswer) => string | undefined) =>
    row.differs.includes(field) ? <span className="differs" data-differs={field} title={valuesOf(read)}/> : undefined

  return (
    <section css={style} className="tracking-compact" aria-label="Quick tracking">
      <div className="row">
        <div className="group edit">
          <ScorePicker
            score={shown.score}
            scale={picker?.scale ?? 'POINT_100'}
            mixed={picker?.mixed ?? false}
            disabled={disabled || (!listed && !shown.status && !shown.progress)}
            disabledTitle={disabled ? 'Check a list to save to' : 'Pick a status or add an episode first'}
            onPick={score => change({ score }, true)}
          />
          {differs('SCORE', answer => isScored(answer.entry?.score) ? scoreText(answer.entry.score, answer.tracker.scoreScale) : undefined)}
          <select
            name="compact-status"
            aria-label="Status"
            value={shown.status ?? ''}
            disabled={disabled}
            onChange={event => change({ status: event.currentTarget.value }, true)}
          >
            {shown.status ? undefined : <option value="" disabled>Add to list</option>}
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {differs('STATUS', answer => answer.entry?.status ? STATUS_LABELS[answer.entry.status] : undefined)}
          <span className="progress-field">
            <label for="compact-progress" className="word">Episodes</label>
            <input
              id="compact-progress"
              type="number"
              inputMode="numeric"
              name="compact-progress"
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
            {differs('PROGRESS', answer => answer.entry?.progress != null ? String(answer.entry.progress) : undefined)}
            <button
              type="button"
              className="more"
              aria-label="One episode more"
              disabled={disabled || (total != null && shown.progress >= total)}
              onClick={() => change({ progress: shown.progress + 1 }, false)}
            >
              <Plus size={14} aria-hidden="true"/>
            </button>
          </span>
          {!disabled && total && shown.progress === total && shown.status !== 'COMPLETED'
            ? <button type="button" onClick={() => change({ status: 'COMPLETED' }, true)}>Mark completed</button>
            : undefined}
          {!disabled && total && shown.status === 'COMPLETED' && shown.progress < total
            ? <button type="button" onClick={() => change({ progress: total }, true)}>Set {total} / {total}</button>
            : undefined}
        </div>
        <div className="group platforms">
          {targets.map(({ answer, target }) => {
            const id = answer.tracker.id
            const name = answer.tracker.name
            if (target.kind === 'login') {
              return (
                <span key={id} className="chip login" data-chip={id} title={`${name}: Signed out`}>
                  <Logo answer={answer}/>
                  <button
                    type="button"
                    className="login-button"
                    aria-label={`Log in to ${name}`}
                    disabled={!signIns[id] || signingIn.has(id)}
                    onClick={() => signIn(answer)}
                  >
                    {signingIn.has(id) ? 'Logging in' : 'Log in'}
                  </button>
                </span>
              )
            }
            if (target.kind === 'cannot') {
              const text = `${name} cannot track this media: ${target.reason}`
              return (
                <span key={id} className="chip cannot" data-chip={id} role="img" aria-label={text} title={text}>
                  <Logo answer={answer}/>
                  <span className="slot"><Minus size={14} aria-hidden="true"/></span>
                </span>
              )
            }
            const { busy, failed } = queue.state(id)
            const problem = answer.state === 'PAUSED' || answer.state === 'ERROR' ? own(answer, total) : undefined
            const title = [
              `${name}${answer.tracker.account ? `, ${answer.tracker.account}` : ''}: ${own(answer, total)}`,
              countDiffers(answer, total) ? `${name} counts ${answer.entry!.episodeCount} episodes, so progress is saved there from Advanced` : undefined,
            ].filter(Boolean).join('. ')
            return (
              <label key={id} className={`chip${target.checked ? '' : ' off'}`} data-chip={id} title={title} aria-busy={busy ? 'true' : undefined}>
                <input
                  type="checkbox"
                  className="hidden"
                  name={`compact-target-${id}`}
                  aria-label={`Save to ${name}`}
                  aria-describedby={problem ? `compact-hint-${id}` : undefined}
                  checked={target.checked}
                  onChange={event => setChecked(id, event.currentTarget.checked)}
                />
                <Logo answer={answer}/>
                {failed || answer.state === 'ERROR' ? <span className="badge red" data-badge="red"/> : answer.state === 'PAUSED' ? <span className="badge amber" data-badge="amber"/> : undefined}
                <span className="slot">
                  {busy
                    ? <LoaderCircle size={14} className="spin" aria-hidden="true"/>
                    : target.checked ? <span className="check"><Check size={11} aria-hidden="true"/></span> : <span className="ring"/>}
                </span>
                {problem ? <span id={`compact-hint-${id}`} className="hidden">{problem}</span> : undefined}
              </label>
            )
          })}
          <button
            type="button"
            className="advanced"
            aria-label="Advanced tracking"
            aria-expanded={prefs.advanced}
            aria-controls="tracking-advanced"
            onClick={() => onPrefs({ ...prefs, advanced: !prefs.advanced })}
          >
            <SlidersHorizontal size={16} aria-hidden="true"/>
            <span className="word">Advanced</span>
          </button>
        </div>
      </div>
      <div className="notes">
        {targets.flatMap(({ answer }) => {
          const id = answer.tracker.id
          const name = answer.tracker.name
          const { failed, refused } = queue.state(id)
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
          ].filter(Boolean)
        })}
      </div>
      <div className="hidden" role="status">{announced}</div>
    </section>
  )
}

export default TrackingCompact
