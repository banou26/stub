import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

import type { PanelAnswer } from './tracking-panel'

import { FIELD_LABELS, applySync, differences, planSync, sourceRefusal, type SyncOutcome, type SyncPage, type SyncWrite } from '../tracking/sync'

// a write that landed, now or later
const LANDED = new Set(['SAVED', 'QUEUED'])

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1rem;

  .differences {
    border-collapse: collapse;
    font-size: 1.3rem;
    th, td { padding: 0.4rem 1.2rem 0.4rem 0; text-align: left; font-weight: normal; }
    thead th { color: rgba(255, 255, 255, 0.45); font-size: 1.2rem; }
    tbody th { color: rgba(255, 255, 255, 0.6); }
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.5rem;
    border-radius: 1rem;
    background: rgb(28, 28, 30);
    border: 0.1rem solid rgba(255, 255, 255, 0.08);
  }

  .sources, .targets { display: flex; flex-direction: column; gap: 0.6rem; }
  .heading { color: rgba(255, 255, 255, 0.6); font-size: 1.2rem; }
  label { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .target { display: flex; flex-direction: column; gap: 0.4rem; }
  .changes { margin: 0; padding-left: 2.4rem; font-size: 1.3rem; }
  .backwards { color: #fb923c; }
  .why, .held, .notice { font-size: 1.2rem; color: rgba(255, 255, 255, 0.6); }
  .held { color: #fb923c; }
  .outcome { display: flex; align-items: center; gap: 1rem; font-size: 1.2rem; color: rgba(255, 255, 255, 0.7); }
  .outcome.problem { color: #f87171; }
  .actions { display: flex; gap: 1rem; }
`

/**
 * Where the trackers that answered for a media differ, field by field and in each one's own terms,
 * and a sync the viewer runs by hand: they pick the tracker to copy from and the ones to copy onto,
 * see what will change on each before anything is written, and apply. Nothing is ticked for them, and
 * each target is written on its own through `onWrite`, so one that fails keeps its error and a retry
 * while the others land. `page` is what those writes send beside the entry.
 */
const TrackingSync = ({ answers, page, onWrite }: { answers: PanelAnswer[], page: SyncPage, onWrite: SyncWrite }) => {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<string>()
  const [targets, setTargets] = useState<ReadonlySet<string>>(new Set())
  const [outcomes, setOutcomes] = useState<Record<string, SyncOutcome>>({})
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const fields = differences(answers)
  if (!fields.length) return null

  const answered = answers.filter(answer => answer.state === 'LISTED' || answer.state === 'NOT_LISTED')
  const answerOf = (id: string) => answers.find(answer => answer.tracker.id === id)
  // every other tracker, ticked or not, so each one's changes are on screen before it is ticked
  const plan = source ? planSync(answers, source, answers.map(answer => answer.tracker.id), page) : undefined
  const applicable = (plan?.targets ?? []).filter(target => !target.refusal && target.entry)
  const ticked = applicable.filter(target => targets.has(target.tracker))

  const pick = (id: string) => {
    setSource(id)
    setTargets(new Set())
    setOutcomes({})
  }

  const toggle = (id: string, on: boolean) =>
    setTargets(previous => {
      const next = new Set(previous)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const apply = async (ids: string[]) => {
    if (!source || !ids.length) return
    setBusy(previous => new Set([...previous, ...ids]))
    try {
      // planned again from the answers as they stand at the click, so a source that took a write
      // since is refused rather than copied
      const written = await applySync(planSync(answers, source, ids, page), onWrite)
      setOutcomes(previous => ({ ...previous, ...Object.fromEntries(written.map(outcome => [outcome.tracker, outcome])) }))
      setTargets(previous => new Set([...previous].filter(id => !written.some(outcome => outcome.tracker === id && LANDED.has(outcome.outcome)))))
    } finally {
      setBusy(previous => new Set([...previous].filter(id => !ids.includes(id))))
    }
  }

  const close = () => {
    setOpen(false)
    setSource(undefined)
    setTargets(new Set())
    setOutcomes({})
  }

  return (
    <div css={style} className="sync">
      <table className="differences" aria-label="Where the trackers differ">
        <thead>
          <tr>
            <th scope="col"/>
            {answered.map(answer => <th key={answer.tracker.id} scope="col">{answer.tracker.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {fields.map(({ field, cells }) => (
            <tr key={field} data-field={field}>
              <th scope="row">{FIELD_LABELS[field]}</th>
              {cells.map(cell => <td key={cell.tracker} data-tracker={cell.tracker}>{cell.text ?? 'None'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {open
        ? (
          <div className="sheet" role="group" aria-label="Sync">
            <div className="sources">
              <span className="heading">Copy from</span>
              {answers.map(answer => {
                const id = answer.tracker.id
                const why = sourceRefusal(answer)
                return (
                  <label key={id} data-source={id}>
                    <input type="radio" name="sync-source" value={id} disabled={Boolean(why)} checked={source === id} onChange={() => pick(id)}/>
                    {answer.tracker.name}
                    {why ? <span className="why">{why}</span> : undefined}
                  </label>
                )
              })}
            </div>
            {plan
              ? (
                <div className="targets">
                  <span className="heading">Copy onto</span>
                  {plan.targets.map(target => {
                    const id = target.tracker
                    const answer = answerOf(id)
                    const can = !target.refusal && Boolean(target.entry)
                    const outcome = outcomes[id]
                    const failed = outcome && !LANDED.has(outcome.outcome)
                    return (
                      <div key={id} className="target" data-target={id}>
                        <label>
                          <input
                            type="checkbox"
                            name={`sync-target-${id}`}
                            disabled={!can || busy.has(id)}
                            checked={can && targets.has(id)}
                            onChange={event => toggle(id, event.currentTarget.checked)}
                          />
                          {answer?.tracker.name ?? id}
                        </label>
                        {target.refusal
                          ? <div className="why">{target.refusal}</div>
                          : target.changes.length
                            ? (
                              <ul className="changes">
                                {target.changes.map(change => (
                                  <li key={change.field} data-field={change.field} className={change.backwards ? 'backwards' : undefined}>
                                    {FIELD_LABELS[change.field]}: {change.from ?? 'None'} → {change.to}{change.note ? ` (${change.note})` : ''}{change.backwards ? ' (goes back)' : ''}
                                  </li>
                                ))}
                              </ul>
                            )
                            : <div className="why">Nothing to change</div>}
                        {target.held.map(held => <div key={held.field} className="held">{held.reason}</div>)}
                        {targets.has(id) && can && answer?.tracker.writeNotice ? <div className="notice">{answer.tracker.writeNotice}</div> : undefined}
                        {outcome
                          ? (
                            <div className={`outcome${failed ? ' problem' : ''}`} data-outcome={id}>
                              <span>{failed ? outcome.error ?? outcome.outcome.toLowerCase() : outcome.outcome === 'QUEUED' ? 'Saved, sent later' : 'Saved'}</span>
                              {failed && can ? <button type="button" disabled={busy.has(id)} onClick={() => void apply([id])}>Retry</button> : undefined}
                            </div>
                          )
                          : undefined}
                      </div>
                    )
                  })}
                </div>
              )
              : <div className="why">Pick the tracker to copy from.</div>}
            <div className="actions">
              <button type="button" className="primary" disabled={!ticked.length || busy.size > 0} onClick={() => void apply(ticked.map(target => target.tracker))}>Apply</button>
              <button type="button" onClick={close}>Close</button>
            </div>
          </div>
        )
        : <div className="actions"><button type="button" onClick={() => setOpen(true)}>Sync</button></div>}
    </div>
  )
}

export default TrackingSync
