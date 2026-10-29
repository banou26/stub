import type { CompactAnswer, Fields, QueueState, SaveQueue } from '../tracking/compact'

import { css } from '@emotion/react'
import { useIntl } from 'react-intl'

import { wordsOf } from '../i18n'
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

// what did not save, as its line's select names it: `removal`, `status`, `status_episode` and so on
const whatOf = ({ remove, status, progress, score }: Fields) => remove ? 'removal' : [
  status !== undefined && 'status',
  progress !== undefined && 'episode',
  score !== undefined && 'score',
].filter(Boolean).join('_')

/**
 * One tracker's saves that did not land, a line each: a failure with Retry, which waits until the
 * tracker can write again, and a refusal with Dismiss.
 */
const SaveProblems = ({ answer, state: { failed, refused }, queue }: { answer: CompactAnswer, state: QueueState, queue: SaveQueue }) => {
  const intl = useIntl()
  const { id, name } = answer.tracker
  return (
    <>
      {failed
        ? (
          <div css={style} className="note" data-note={id}>
            {intl.formatMessage({
              id: '{what, select, removal {{name} did not save the removal: {error}} status {{name} did not save the status: {error}} episode {{name} did not save episode {episode}: {error}} score {{name} did not save the score: {error}} status_episode {{name} did not save the status and episode {episode}: {error}} status_score {{name} did not save the status and the score: {error}} episode_score {{name} did not save episode {episode} and the score: {error}} status_episode_score {{name} did not save the status and episode {episode} and the score: {error}} other {{name} did not save: {error}}}',
              defaultMessage: '{what, select, removal {{name} did not save the removal: {error}} status {{name} did not save the status: {error}} episode {{name} did not save episode {episode}: {error}} score {{name} did not save the score: {error}} status_episode {{name} did not save the status and episode {episode}: {error}} status_score {{name} did not save the status and the score: {error}} episode_score {{name} did not save episode {episode} and the score: {error}} status_episode_score {{name} did not save the status and episode {episode} and the score: {error}} other {{name} did not save: {error}}}',
            }, { what: whatOf(failed.fields), name, episode: failed.fields.progress ?? '', error: wordsOf(failed.error) })}
            <button type="button" disabled={!writable(answer)} onClick={() => queue.retry(id)}>{intl.formatMessage({ id: 'Retry', defaultMessage: 'Retry' })}</button>
          </div>
        )
        : undefined}
      {refused
        ? (
          <div css={style} className="note" data-note={id}>
            {intl.formatMessage({ id: '{name} did not save: {error}', defaultMessage: '{name} did not save: {error}' }, { name, error: wordsOf(refused) })}
            <button type="button" onClick={() => queue.dismiss(id)}>{intl.formatMessage({ id: 'Dismiss', defaultMessage: 'Dismiss' })}</button>
          </div>
        )
        : undefined}
    </>
  )
}

export default SaveProblems
