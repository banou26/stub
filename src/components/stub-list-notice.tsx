import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { wordsOf, type Said } from '../i18n'

export type StubStorage = {
  location: 'DEVICE' | 'ACCOUNT'
  signedIn?: boolean | null
  locked: boolean
  waiting: boolean
  held: number
  error?: Said | null
}

const style = css`
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-top: 1rem;
  font-size: 1.3rem;
  color: rgba(255, 255, 255, 0.7);

  .line {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    flex-wrap: wrap;
  }
  .problem { color: #fb923c; }

  button {
    padding: 0.4rem 1.1rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.2);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    &:hover { background: rgba(255, 255, 255, 0.08); }
    &:disabled { opacity: 0.5; cursor: default; }
  }
`

/**
 * What waits on the viewer about stub's own list: a list that cannot be opened on this device until
 * the viewer unlocks it, and the list this device kept before signing in, which reaches the account
 * only if the viewer adds it. Renders nothing when nothing waits.
 */
const StubListNotice = (
  { storage, onUnlock, onAdd }:
  { storage: StubStorage | null | undefined, onUnlock: () => Promise<unknown>, onAdd: () => Promise<unknown> }
) => {
  const intl = useIntl()
  const [busy, setBusy] = useState(false)
  if (!storage) return null
  const run = (action: () => Promise<unknown>) => async () => {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }
  const account = storage.location === 'ACCOUNT'
  const locked = storage.signedIn === true && storage.locked
  const lines = [
    locked
      ? (
        <div key="locked" className="line">
          <span>{intl.formatMessage({ id: "Stub: your FKN account's list is locked on this device", defaultMessage: "Stub: your FKN account's list is locked on this device" })}</span>
          <button type="button" disabled={busy} onClick={run(onUnlock)}>{intl.formatMessage({ id: 'Unlock', defaultMessage: 'Unlock' })}</button>
        </div>
      )
      : undefined,
    account && !locked && storage.held > 0
      ? (
        <div key="held" className="line">
          <span>
            {intl.formatMessage({
              id: 'Stub: {count, plural, one {{count} entry} other {{count} entries}} saved on this device before you signed in',
              defaultMessage: 'Stub: {count, plural, one {{count} entry} other {{count} entries}} saved on this device before you signed in',
            }, { count: storage.held })}
          </span>
          <button type="button" disabled={busy} onClick={run(onAdd)}>{intl.formatMessage({ id: 'Add to my FKN account', defaultMessage: 'Add to my FKN account' })}</button>
        </div>
      )
      : undefined,
    account && !locked && storage.waiting
      ? <div key="waiting" className="line">{intl.formatMessage({ id: 'Stub: some changes have not reached your FKN account yet.', defaultMessage: 'Stub: some changes have not reached your FKN account yet.' })}</div>
      : undefined,
    storage.error ? <div key="error" className="line problem">{intl.formatMessage({ id: 'Stub: {error}', defaultMessage: 'Stub: {error}' }, { error: wordsOf(storage.error) })}</div> : undefined,
  ].filter(Boolean)
  if (!lines.length) return null
  return <div css={style} className="stub-list-notice" role="status">{lines}</div>
}

export default StubListNotice
