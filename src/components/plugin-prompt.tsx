import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

import { acceptInvites, declineInvites, dismissInvite, onInvitesChange, pluginInvites, type PluginInvite } from '../plugin-invites'
import { layer } from '../layers'

const style = css`
  position: fixed;
  inset: 0;
  /* a sibling of the modal's portal rather than a child of it, so it competes at the root and 200
     put it behind the modal on any /media route */
  z-index: ${layer.pluginPrompt};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);

  .dialog {
    width: 100%;
    max-width: 44rem;
    padding: 2.4rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.8rem;
    background: #171717;
  }

  h2 {
    font-size: 1.9rem;
    margin-bottom: 0.6rem;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 1.8rem 0;
  }

  .invite {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
  }

  .invite .uri {
    font-family: monospace;
    font-size: 1.3rem;
    overflow-wrap: anywhere;
  }

  .invite .state {
    margin-left: auto;
    font-size: 1.2rem;
    white-space: nowrap;
    color: rgba(255, 255, 255, 0.55);
  }

  .invite .state.error {
    color: #f87171;
  }

  .invite .dismiss {
    padding: 0.3rem 0.7rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.4rem;
    background: none;
    color: inherit;
    font-size: 1.2rem;
    cursor: pointer;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1rem;
  }

  button {
    padding: 0.7rem 1.5rem;
    border: none;
    border-radius: 0.4rem;
    background: #fff;
    color: #000;
    font-weight: 600;
    font-size: 1.4rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .decline {
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: none;
    color: inherit;
    font-weight: 400;
  }
`

const stateLabel = (invite: PluginInvite) =>
  invite.state === 'installing' ? 'adding…'
  : invite.state === 'error' ? (invite.error ?? 'failed')
  : ''

export const PluginPrompt = () => {
  const [invites, setInvites] = useState<PluginInvite[]>(pluginInvites)

  // read on subscribe as well as on notify: the url is ingested at import time, before this mounts
  useEffect(() => {
    setInvites(pluginInvites())
    return onInvitesChange(() => setInvites(pluginInvites()))
  }, [])

  if (!invites.length) return null

  const busy = invites.some(invite => invite.state === 'installing')

  return (
    <div css={style} role="dialog" aria-modal="true" aria-labelledby="plugin-prompt-title">
      <div className="dialog">
        <h2 id="plugin-prompt-title">{invites.length > 1 ? 'Add these sources?' : 'Add this source?'}</h2>
        <div className="list">
          {invites.map(invite => (
            <div className="invite" key={invite.uri}>
              <span className="uri">{invite.uri}</span>
              <span className={`state${invite.state === 'error' ? ' error' : ''}`}>{stateLabel(invite)}</span>
              {invite.state === 'error' && (
                <button type="button" className="dismiss" onClick={() => dismissInvite(invite.uri)}>Dismiss</button>
              )}
            </div>
          ))}
        </div>
        <div className="actions">
          <button type="button" className="decline" disabled={busy} onClick={() => declineInvites()}>Not now</button>
          <button type="button" disabled={busy} onClick={() => { acceptInvites() }}>
            {invites.length > 1 ? 'Add sources' : 'Add source'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PluginPrompt
