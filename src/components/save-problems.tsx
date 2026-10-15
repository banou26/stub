import type { CompactAnswer, Fields, QueueState, SaveQueue } from '../tracking/compact'

import { css } from '@emotion/react'

import { writable } from '../tracking/compact'

const style = css`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.8rem;
  font-size: 1.2rem;
  color: #f87171;

  button {
    height: 2.6rem;
    padding: 0 1rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font: inherit;
    cursor: pointer;
    &:disabled { opacity: 0.5; cursor: default; }
  }
`

const whatOf = (fields: Fields) => fields.remove ? 'the removal' : [
  fields.status !== undefined ? 'the status' : undefined,
  fields.progress !== undefined ? `episode ${fields.progress}` : undefined,
  fields.score !== undefined ? 'the score' : undefined,
].filter(Boolean).join(' and ')

/**
 * One tracker's saves that did not land, a line each: a failure with Retry, which waits until the
 * tracker can write again, and a refusal with Dismiss.
 */
const SaveProblems = ({ answer, state: { failed, refused }, queue }: { answer: CompactAnswer, state: QueueState, queue: SaveQueue }) => {
  const { id, name } = answer.tracker
  return (
    <>
      {failed
        ? (
          <div css={style} className="note" data-note={id}>
            {name} did not save {whatOf(failed.fields)}: {failed.error}
            <button type="button" disabled={!writable(answer)} onClick={() => queue.retry(id)}>Retry</button>
          </div>
        )
        : undefined}
      {refused
        ? (
          <div css={style} className="note" data-note={id}>
            {name} did not save: {refused}
            <button type="button" onClick={() => queue.dismiss(id)}>Dismiss</button>
          </div>
        )
        : undefined}
    </>
  )
}

export default SaveProblems
