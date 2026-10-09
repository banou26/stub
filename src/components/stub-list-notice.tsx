import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

export type StubStorage = {
  location: 'DEVICE' | 'ACCOUNT'
  signedIn?: boolean | null
  locked: boolean
  waiting: boolean
  held: number
  error?: string | null
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

const entries = (count: number) => count === 1 ? '1 entry' : `${count} entries`

/**
 * What waits on the viewer about stub's own list: a list that cannot be opened on this device until
 * the viewer unlocks it, and the list this device kept before signing in, which reaches the account
 * only if the viewer adds it. Renders nothing when nothing waits.
 */
const StubListNotice = (
  { storage, onUnlock, onAdd }:
  { storage: StubStorage | null | undefined, onUnlock: () => Promise<unknown>, onAdd: () => Promise<unknown> }
) => {
  const [busy, setBusy] = useState(false)
  if (!storage) return null
  const run = (action: () => Promise<unknown>) => async () => {
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }
  const account = storage.location === 'ACCOUNT'
  const locked = storage.signedIn === true && storage.locked
  const one = storage.held === 1
  const lines = [
    locked
      ? (
        <div key="locked" className="line">
          <span>
            Stub: your FKN account's list is locked on this device
            {account ? ', and changes wait here until it opens.' : ', so this device keeps its own list for now.'}
          </span>
          <button type="button" disabled={busy} onClick={run(onUnlock)}>Unlock</button>
        </div>
      )
      : undefined,
    account && !locked && storage.held > 0
      ? (
        <div key="held" className="line">
          <span>
            Stub: {entries(storage.held)} saved on this device before you signed in {one ? 'stays' : 'stay'} on this device, apart
            from your FKN account's list, and {one ? 'comes' : 'come'} back if you sign out.
          </span>
          <button type="button" disabled={busy} onClick={run(onAdd)}>Add to my FKN account</button>
        </div>
      )
      : undefined,
    account && !locked && storage.waiting
      ? <div key="waiting" className="line">Stub: some changes have not reached your FKN account yet.</div>
      : undefined,
    storage.error ? <div key="error" className="line problem">Stub: {storage.error}</div> : undefined,
  ].filter(Boolean)
  if (!lines.length) return null
  return <div css={style} className="stub-list-notice" role="status">{lines}</div>
}

export default StubListNotice
