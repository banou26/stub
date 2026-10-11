import { css } from '@emotion/react'
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useClick, useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react'
import { Check, Copy, LogOut, Radio, Users } from 'lucide-react'
import { useLocation } from 'wouter'

import { getRoutePath, Route } from '../router/path'
import { useEffect, useState } from 'preact/hooks'

import { party, partyLink } from '../party'
import { useParty } from '../party/use-party'
import { layer } from '../layers'

const buttonStyle = css`
  display: flex;
  align-items: center;
  gap: 0.6rem;
  height: 4rem;
  padding: 0 1.2rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2rem;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: inherit;
  font-size: 1.3rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s;

  &:hover, &[aria-expanded='true'] {
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.35);
  }

  &.live {
    border-color: rgba(74, 222, 128, 0.5);
    color: #4ade80;
  }

  &.live:hover, &.live[aria-expanded='true'] {
    border-color: #4ade80;
  }

  &.over {
    border-color: rgba(251, 146, 60, 0.5);
    color: #fb923c;
  }

  .count {
    font-weight: 500;
    opacity: 0.8;
  }

  @media (max-width: 768px) {
    padding: 0 1rem;
    .label { display: none; }
  }
`

const menuStyle = css`
  width: 30rem;
  padding: 1.2rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #1a1a1a;
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.3rem;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  z-index: ${layer.headerPopup};

  .title {
    font-size: 1.4rem;
    font-weight: 600;
    color: #fff;
  }

  .hint {
    margin-top: 0.4rem;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.4;
  }

  .link {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
    padding: 0.6rem 0.8rem;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.06);
  }

  .link input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-family: inherit;
    font-size: 1.2rem;
    outline: none;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;
  }

  button:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; }
  button.primary { background: rgba(255, 255, 255, 0.1); }
`

const FAILURE: Record<string, string> = {
  'not-found': 'That party has ended.',
  'bad-key': 'That invite link is not valid.',
  invalid: 'That invite link is broken.',
  full: 'That party is full.',
  blocked: 'You cannot join that party.',
  unavailable: 'Parties are not available right now. Is FKN connected?',
  'rate-limited': 'Too many attempts. Try again in a moment.',
}

const ENDED: Record<string, string> = {
  'host-left': 'The host left the party.',
  removed: 'You were removed from the party.',
  blocked: 'You were removed from the party.',
  ended: 'The party ended.',
  unavailable: 'The party was lost. Parties are unavailable right now.',
  left: 'You left the party.',
}

/**
 * The party, as a button in the header: start one, share it, see who is in it, leave it.
 *
 * One control for every state rather than several, so it always sits in the same place and a
 * reader learns one spot to look at.
 */
const PartyWidget = () => {
  const state = useParty()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, navigate] = useLocation()
  const toParty = () => { setOpen(false); navigate(getRoutePath(Route.PARTY)) }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'dialog' }),
  ])

  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1_500); return () => clearTimeout(timer) }, [copied])
  // a party that just ended is worth a look, so the menu opens on its own to say why
  useEffect(() => { if (state.status === 'ended' || state.status === 'failed') setOpen(true) }, [state.status])

  const link = state.status === 'active' ? partyLink(location.origin, state.invite) : undefined
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch {}
  }

  if (state.status === 'idle') {
    return (
      <button type="button" css={buttonStyle} onClick={() => { void party.create() }} title="Watch together">
        <Users size={16}/>
        <span className="label">Watch together</span>
      </button>
    )
  }

  const live = state.status === 'active'
  const label =
    state.status === 'joining' ? 'Joining…'
    : state.status === 'active' ? (state.role === 'host' ? 'Hosting' : 'Following')
    : state.status === 'ended' ? 'Party over'
    : 'Party failed'

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        css={buttonStyle}
        className={live ? 'live' : state.status === 'joining' ? undefined : 'over'}
        {...getReferenceProps()}
      >
        {live && state.role === 'host' ? <Radio size={16}/> : <Users size={16}/>}
        <span className="label">{label}</span>
        {live && <span className="count">{state.members}</span>}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} css={menuStyle} style={floatingStyles} {...getFloatingProps()}>
              {state.status === 'joining' && <div className="title">Joining the party…</div>}
              {state.status === 'active' && state.role === 'host' && (
                <>
                  <div className="title">You are hosting</div>
                  <div className="hint">
                    {state.members === 1 ? 'Nobody has joined yet.' : `${state.members - 1} ${state.members === 2 ? 'person is' : 'people are'} following you.`}
                  </div>
                  <div className="link">
                    <input readOnly value={link} aria-label="Invite link" onFocus={event => event.currentTarget.select()}/>
                    <button type="button" onClick={() => { void copy() }} aria-label="Copy invite link">
                      {copied ? <Check size={14}/> : <Copy size={14}/>}
                    </button>
                  </div>
                  <div className="actions">
                    <button type="button" className="primary" onClick={toParty}><Users size={14}/> Party</button>
                    <button type="button" onClick={() => { void party.leave(); setOpen(false) }}><LogOut size={14}/> End party</button>
                  </div>
                </>
              )}
              {state.status === 'active' && state.role === 'guest' && (
                <>
                  <div className="title">You are following the host</div>
                  <div className="hint">
                    {state.members} in the party.
                  </div>
                  <div className="actions">
                    <button type="button" className="primary" onClick={() => { party.replay(); setOpen(false) }}>Catch up</button>
                    <button type="button" onClick={toParty}><Users size={14}/> Party</button>
                    <button type="button" onClick={() => { void party.leave(); setOpen(false) }}><LogOut size={14}/> Leave</button>
                  </div>
                </>
              )}
              {(state.status === 'ended' || state.status === 'failed') && (
                <>
                  <div className="title">{state.status === 'ended' ? ENDED[state.reason] ?? 'The party ended.' : FAILURE[state.code] ?? 'The party could not start.'}</div>
                  <div className="actions">
                    <button type="button" className="primary" onClick={() => { party.dismiss(); setOpen(false) }}>OK</button>
                  </div>
                </>
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}

export default PartyWidget
