import { css } from '@emotion/react'
import { Minus, Plus } from 'lucide-react'
import { useState } from 'preact/hooks'

import MediaScore from './media-score'

export type PanelEntry = {
  _id: string
  status?: string | null
  progress?: number | null
  score?: number | null
  scoreLabel?: string | null
  episodeCount?: number | null
}

export type PanelAnswer = {
  _id: string
  state: string
  candidates: string[]
  error?: string | null
  tracker: {
    id: string
    name: string
    icon?: string | null
    color?: string | null
    canWrite: boolean
    account?: string | null
    scoreScale?: string | null
    writeNotice?: string | null
  }
  entry?: PanelEntry | null
}

export type PanelTracking = {
  summary?: PanelEntry | null
  disagreements: string[]
  answers: PanelAnswer[]
}

export type EntryValues = { status: string, progress: number, score: number | null }
export type PanelOutcome = { tracker: string, outcome: string, error?: string | null }

/** How a sign in ended, as tracking/site-sessions.ts reports it (the sign-in window's outcomes). */
export type SignInOutcome = 'authed' | 'closed' | 'blocked' | 'unsupported'
/** The sign in a tracker offers, by tracker id. Called directly in the click, so a window can open. */
export type SignIns = Record<string, () => Promise<SignInOutcome>>

export const STATUS_LABELS: Record<string, string> = {
  WATCHING: 'Watching',
  REWATCHING: 'Rewatching',
  PLANNING: 'Plan to watch',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
}

const WRITABLE_STATES = new Set(['LISTED', 'NOT_LISTED'])
const writable = (answer: PanelAnswer) => answer.tracker.canWrite && WRITABLE_STATES.has(answer.state)

const style = css`
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  font-size: 1.4rem;

  .summary {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;

    .label {
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.4);
    }
    .value { font-weight: 600; }
    .muted { color: rgba(255, 255, 255, 0.55); }
  }

  .rows {
    display: flex;
    flex-direction: column;
    border-top: 0.1rem solid rgba(255, 255, 255, 0.1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-height: 4rem;
    border-bottom: 0.1rem solid rgba(255, 255, 255, 0.1);

    .icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 2.4rem;
      height: 2.4rem;
      border-radius: 0.5rem;
      background: rgba(255, 255, 255, 0.08);
      font-size: 1.2rem;
      font-weight: 700;
      text-transform: uppercase;
      overflow: hidden;
      img { width: 100%; height: 100%; object-fit: contain; }
    }
    .name { font-weight: 600; }
    .account { color: rgba(255, 255, 255, 0.45); font-size: 1.2rem; }
    .state { margin-left: auto; color: rgba(255, 255, 255, 0.8); text-align: right; overflow-wrap: anywhere; }
    .state.problem { color: #fb923c; }
  }

  .row-note {
    padding: 0.6rem 0 0.8rem 3.6rem;
    font-size: 1.2rem;
    color: rgba(255, 255, 255, 0.7);
    border-bottom: 0.1rem solid rgba(255, 255, 255, 0.1);
  }

  button {
    padding: 0.5rem 1.2rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.2);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    &:hover { background: rgba(255, 255, 255, 0.08); }
    &.primary { background: #fff; color: #000; border-color: #fff; font-weight: 600; }
    &:disabled { opacity: 0.5; cursor: default; }
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.5rem;
    border-radius: 1rem;
    background: rgb(28, 28, 30);
    border: 0.1rem solid rgba(255, 255, 255, 0.08);

    .fields { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.4rem; color: rgba(255, 255, 255, 0.6); font-size: 1.2rem; }
    select, input[type='number'] {
      padding: 0.5rem 0.8rem;
      border-radius: 0.6rem;
      border: 0.1rem solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      font: inherit;
      font-size: 1.4rem;
    }
    input[type='number'] { width: 7rem; }
    .stepper { display: flex; align-items: center; gap: 0.6rem; color: #fff; }
    .stepper button { padding: 0.4rem; display: flex; }
    .targets { display: flex; flex-wrap: wrap; gap: 1.5rem; align-items: center; }
    .targets label { flex-direction: row; align-items: center; color: #fff; font-size: 1.4rem; }
    .notice { font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
    .actions { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .outcome { font-size: 1.2rem; color: rgba(255, 255, 255, 0.7); }
    .outcome.problem { color: #f87171; }
  }
`

const progressText = (entry: PanelEntry, episodeCount?: number | null) => {
  const count = entry.episodeCount ?? episodeCount
  return entry.progress == null ? undefined : count ? `${entry.progress} / ${count}` : `${entry.progress} episodes`
}

// in the scale the viewer scores in on that tracker, where it has one of its own
const scoreText = (entry: PanelEntry, scale?: string | null) =>
  entry.score == null ? undefined
  : entry.scoreLabel && scale && scale !== 'POINT_100' ? entry.scoreLabel
  : `${entry.score}%`

const describeAnswer = (answer: PanelAnswer, episodeCount?: number | null): { text: string, problem?: boolean } => {
  switch (answer.state) {
    case 'LISTED': {
      const entry = answer.entry!
      const parts = [
        entry.status ? STATUS_LABELS[entry.status] ?? entry.status : undefined,
        progressText(entry, episodeCount),
        scoreText(entry, answer.tracker.scoreScale),
      ].filter(Boolean)
      return { text: parts.join(' · ') || 'Listed' }
    }
    case 'NOT_LISTED': return { text: 'Not listed' }
    case 'NO_ID': return { text: 'Has no id for this media', problem: true }
    case 'AMBIGUOUS': return { text: `Names ${answer.candidates.join(' and ')}, cannot tell which`, problem: true }
    case 'SIGNED_OUT': return { text: 'Signed out', problem: true }
    case 'PAUSED': return { text: answer.error || 'Paused for a while', problem: true }
    default: return { text: answer.error || 'Could not answer', problem: true }
  }
}

const Editor = (
  { answers, edited, episodeCount, onSave, onDelete, onClose }:
  {
    answers: PanelAnswer[]
    edited: PanelAnswer
    episodeCount?: number | null
    onSave: (targets: string[], values: EntryValues) => Promise<PanelOutcome[]>
    onDelete: (targets: string[]) => Promise<PanelOutcome[]>
    onClose: () => void
  }
) => {
  const [status, setStatus] = useState(edited.entry?.status ?? 'WATCHING')
  const [progress, setProgress] = useState(edited.entry?.progress ?? 0)
  const [score, setScore] = useState<number | null>(edited.entry?.score ?? null)
  // THE EDITED PROVIDER ALONE, and the rest only when the viewer ticks them: a connected tracker is
  // never written to because it is connected
  const [targets, setTargets] = useState<ReadonlySet<string>>(() => new Set([edited.tracker.id]))
  const [busy, setBusy] = useState(false)
  const [outcomes, setOutcomes] = useState<PanelOutcome[]>([])
  const count = edited.entry?.episodeCount ?? episodeCount ?? undefined

  const run = async (write: () => Promise<PanelOutcome[]>) => {
    setBusy(true)
    try {
      const result = await write()
      setOutcomes(result)
      if (result.length && result.every(outcome => outcome.outcome === 'SAVED' || outcome.outcome === 'QUEUED')) onClose()
    } catch (error) {
      setOutcomes([{ tracker: '', outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) }])
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean) =>
    setTargets(previous => {
      const next = new Set(previous)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const nameOf = (id: string) => answers.find(answer => answer.tracker.id === id)?.tracker.name ?? id
  // what a write does beyond the list, for each tracker it is about to go to
  const notices = answers.filter(answer => targets.has(answer.tracker.id) && answer.tracker.writeNotice)

  return (
    <div className="editor" role="group" aria-label={`Edit on ${edited.tracker.name}`}>
      <div className="fields">
        <label>
          Status
          <select value={status} onChange={event => setStatus(event.currentTarget.value)}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Progress
          <span className="stepper">
            <button type="button" aria-label="One episode less" disabled={progress <= 0} onClick={() => setProgress(value => Math.max(0, value - 1))}><Minus size={14}/></button>
            <input
              type="number"
              name="progress"
              min={0}
              max={count}
              value={progress}
              onInput={event => setProgress(Math.max(0, Math.floor(Number(event.currentTarget.value) || 0)))}
            />
            <button type="button" aria-label="One episode more" disabled={count != null && progress >= count} onClick={() => setProgress(value => value + 1)}><Plus size={14}/></button>
            {count ? <span>/ {count}</span> : undefined}
          </span>
        </label>
        <label>
          Score
          <input
            type="number"
            name="score"
            min={0}
            max={100}
            placeholder="None"
            value={score ?? ''}
            onInput={event => {
              const raw = event.currentTarget.value
              setScore(raw === '' ? null : Math.min(100, Math.max(0, Math.round(Number(raw) || 0))))
            }}
          />
        </label>
      </div>
      <div className="targets">
        <span>Save to</span>
        {answers.filter(writable).map(answer => (
          <label key={answer.tracker.id}>
            <input
              type="checkbox"
              name={`target-${answer.tracker.id}`}
              checked={targets.has(answer.tracker.id)}
              onChange={event => toggle(answer.tracker.id, event.currentTarget.checked)}
            />
            {answer.tracker.name}
          </label>
        ))}
      </div>
      {notices.map(answer => <div key={answer.tracker.id} className="notice">{answer.tracker.writeNotice}</div>)}
      <div className="actions">
        <button type="button" className="primary" disabled={busy || !targets.size} onClick={() => void run(() => onSave([...targets], { status, progress, score }))}>Save</button>
        {edited.state === 'LISTED'
          ? <button type="button" disabled={busy || !targets.size} onClick={() => void run(() => onDelete([...targets]))}>Remove</button>
          : undefined}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
      {outcomes.filter(outcome => outcome.outcome !== 'SAVED').map(outcome => (
        <div key={outcome.tracker} className="outcome problem">
          {outcome.tracker ? `${nameOf(outcome.tracker)}: ` : ''}{outcome.error ?? outcome.outcome.toLowerCase()}
        </div>
      ))}
    </div>
  )
}

const SIGN_IN_NOTES: Partial<Record<SignInOutcome, (name: string) => string>> = {
  blocked: () => 'The browser blocked the sign-in window. Allow pop-ups for this page and press Sign in again.',
  unsupported: name => `Sign in to ${name} in this browser, then press Sign in again.`,
}

/**
 * Where the viewer stands with a media on every tracker: a summary for display, one row per tracker's
 * own answer, and an editor that writes to the trackers the viewer ticks. The summary is never
 * written anywhere; each row is what that tracker said. A tracker that answers signed out offers its
 * sign in when `signIns` has one, and its answer is read again once that ends.
 */
const TrackingPanel = (
  { tracking, episodeCount, onSave, onDelete, signIns = {} }:
  {
    tracking: PanelTracking | null | undefined
    episodeCount?: number | null
    onSave: (targets: string[], values: EntryValues) => Promise<PanelOutcome[]>
    onDelete: (targets: string[]) => Promise<PanelOutcome[]>
    signIns?: SignIns
  }
) => {
  const [editing, setEditing] = useState<string>()
  const [signingIn, setSigningIn] = useState<ReadonlySet<string>>(new Set())
  const [signInNotes, setSignInNotes] = useState<Record<string, string>>({})
  if (!tracking?.answers.length) return null

  const signIn = (answer: PanelAnswer) => {
    const start = signIns[answer.tracker.id]
    if (!start || signingIn.has(answer.tracker.id)) return
    // first, before any state: the window opens with this click's activation
    const signingInNow = start()
    const id = answer.tracker.id
    setSigningIn(previous => new Set(previous).add(id))
    setSignInNotes(({ [id]: _dropped, ...rest }) => rest)
    signingInNow
      .then(
        outcome => SIGN_IN_NOTES[outcome]?.(answer.tracker.name),
        error => error instanceof Error ? error.message : String(error),
      )
      .then(note => {
        if (note) setSignInNotes(previous => ({ ...previous, [id]: note }))
        setSigningIn(previous => {
          const next = new Set(previous)
          next.delete(id)
          return next
        })
      })
  }
  const { summary } = tracking
  const edited = tracking.answers.find(answer => answer.tracker.id === editing)

  return (
    <section css={style} className="tracking" aria-label="Tracking">
      <div className="summary">
        <span className="label">Tracking</span>
        {summary
          ? (
            <>
              {summary.status ? <span className="value">{STATUS_LABELS[summary.status] ?? summary.status}</span> : undefined}
              {progressText(summary, episodeCount) ? <span className="progress">{progressText(summary, episodeCount)}</span> : undefined}
              {summary.score != null ? <MediaScore percent={summary.score} size={16}/> : undefined}
              {tracking.disagreements.length ? <span className="muted">Trackers differ</span> : undefined}
            </>
          )
          : <span className="muted">Not on any list</span>}
      </div>
      <div className="rows">
        {tracking.answers.flatMap(answer => {
          const { text, problem } = describeAnswer(answer, episodeCount)
          const id = answer.tracker.id
          const signedOut = answer.state === 'SIGNED_OUT'
          const note = signedOut ? signInNotes[id] : undefined
          const row = (
            <div key={id} className="row" data-tracker={id}>
              <span className="icon" style={answer.tracker.color ? { color: answer.tracker.color } : undefined}>
                {answer.tracker.icon ? <img src={answer.tracker.icon} alt=""/> : answer.tracker.name.slice(0, 1)}
              </span>
              <span className="name">{answer.tracker.name}</span>
              {answer.tracker.account ? <span className="account">{answer.tracker.account}</span> : undefined}
              <span className={`state${problem ? ' problem' : ''}`}>{text}</span>
              {writable(answer) ? <button type="button" onClick={() => setEditing(id)}>Edit</button> : undefined}
              {signedOut && signIns[id]
                ? <button type="button" disabled={signingIn.has(id)} onClick={() => signIn(answer)}>{signingIn.has(id) ? 'Signing in' : 'Sign in'}</button>
                : undefined}
            </div>
          )
          return note ? [row, <div key={`${id}-note`} className="row-note" data-note={id}>{note}</div>] : [row]
        })}
      </div>
      {edited && writable(edited)
        ? (
          <Editor
            key={edited.tracker.id}
            answers={tracking.answers}
            edited={edited}
            episodeCount={episodeCount}
            onSave={onSave}
            onDelete={onDelete}
            onClose={() => setEditing(undefined)}
          />
        )
        : undefined}
    </section>
  )
}

export default TrackingPanel
