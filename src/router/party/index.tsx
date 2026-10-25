import type { PartyMember } from '../../party'

import { defaultName } from '@banou/social/names'
import { css } from '@emotion/react'
import { Ban, Check, Copy, LogOut, UserX } from 'lucide-react'
import { Link } from 'wouter'
import { useEffect, useState } from 'preact/hooks'

import { party, partyLink } from '../../party'
import { inviteFromHash } from '../../party/invite'
import { displayName } from '../../party/protocol'
import { useParty, usePartyMessages } from '../../party/use-party'
import { getRoutePath, Route } from '../path'

const style = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
  min-height: 100vh;
  max-width: 72rem;

  .heading {
    font-size: 2.4rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: rgba(255, 255, 255, 0.85);
  }

  .status {
    font-size: 1.6rem;
    color: rgba(255, 255, 255, 0.5);
    max-width: 60ch;
    line-height: 1.5;
  }

  a { color: rgba(255, 255, 255, 0.85); text-decoration: underline; }

  .section {
    margin-top: 2.4rem;
  }

  .label {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.45);
    margin-bottom: 0.8rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .row + .row { margin-top: 0.6rem; }

  .row .name {
    flex: 1;
    min-width: 0;
    font-size: 1.4rem;
    font-weight: 600;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    padding: 0.2rem 0.6rem;
    border-radius: 0.4rem;
    background: rgba(74, 222, 128, 0.18);
    color: #4ade80;
    font-size: 1.1rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .badge.you { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.8); }

  button, input {
    font-family: inherit;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.8);
    font-size: 1.2rem;
    cursor: pointer;
  }

  .action:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; }
  .action.danger:hover { border-color: #f87171; color: #f87171; }

  .field {
    display: flex;
    gap: 0.6rem;
  }

  .field input {
    flex: 1;
    min-width: 0;
    height: 3.6rem;
    padding: 0 1rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.04);
    color: #fff;
    font-size: 1.4rem;
    outline: none;
  }

  .field input:focus { border-color: rgba(255, 255, 255, 0.4); }
`

const FAILURE: Record<string, string> = {
  'not-found': 'That party has ended.',
  'bad-key': 'The invite link is not valid.',
  invalid: 'The invite link is broken.',
  full: 'The party is full.',
  blocked: 'You cannot join this party.',
  unavailable: 'Parties are not available right now. Is FKN connected?',
}

/**
 * The party's own page: who is in it, what to call yourself, the invite, and for the host, the door.
 *
 * It is also where an invite link lands. The invite is in the fragment; this page joins, and the
 * follow sync at the router root moves the tab to wherever the host is once the host's next snapshot
 * arrives, so a joiner sees this page for as long as one round trip takes. A host coming here to
 * manage the party is NOT followed: the sync leaves this path out, since the host looking at the
 * door is not the party going anywhere.
 */
const Party = () => {
  const state = useParty()
  const [invite] = useState(() => inviteFromHash(location.hash, location.origin))
  // a fragment that is not an invite is a broken link, which is not the same as no link at all
  const [broken] = useState(() => location.hash.length > 1 && !inviteFromHash(location.hash, location.origin))
  const [members, setMembers] = useState<PartyMember[]>([])
  const [name, setName] = useState(() => party.name() ?? '')
  const [copied, setCopied] = useState(false)
  const active = state.status === 'active'

  useEffect(() => {
    if (!invite) return
    // a reload of this url resumes from the session first, and that join is the same one
    const current = party.getState()
    if ((current.status === 'joining' || current.status === 'active') && current.invite === invite) return
    void party.join(invite)
  }, [invite])

  // the roster is read from the room, and re-read on every join, leave and introduction
  const members_ = active ? state.members : 0
  useEffect(() => {
    if (!active) { setMembers([]); return }
    let cancelled = false
    void party.roster().then(list => { if (!cancelled) setMembers(list) })
    return () => { cancelled = true }
  }, [active, members_])
  usePartyMessages(message => {
    if (message.t !== 'name') return
    void party.roster().then(setMembers)
  })
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1_500); return () => clearTimeout(timer) }, [copied])

  const link = active ? partyLink(location.origin, state.invite) : undefined
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch {}
  }
  const saveName = (event: Event) => {
    event.preventDefault()
    party.setName(displayName(name))
  }

  return (
    <div css={style}>
      <div className="heading">Watch together</div>
      <div className="status">
        {
          broken ? <>This invite link is broken. Ask the host for a new one.</>
          : !invite && !active && state.status !== 'joining'
            ? (
              state.status === 'failed' ? <>Could not join. {FAILURE[state.code] ?? 'Something went wrong.'}</>
              : state.status === 'ended' ? <>The party ended.</>
              : <>You are not in a party. Start one from the header.</>
            )
          : !invite && state.status === 'joining' ? <>Joining the party…</>
          : invite && !active ? (
            state.status === 'joining' ? <>Joining the party…</>
            : state.status === 'failed' ? <>Could not join. {FAILURE[state.code] ?? 'Something went wrong.'}</>
            : state.status === 'ended' ? <>The party ended.</>
            : <>This invite link is broken. Ask the host for a new one.</>
          )
          : active && state.role === 'guest' && invite ? <>You are in. Waiting for the host…</>
          : active && state.role === 'guest' ? <>You are following the host. <Link to={getRoutePath(Route.HOME)}>Go home</Link></>
          : <>You are hosting.</>
        }
        {!invite && !active && state.status !== 'joining' && (state.status === 'failed' || state.status === 'ended')
          ? <> <button type="button" className="action" onClick={() => party.dismiss()}>OK</button></>
          : null}
      </div>

      {active && (
        <>
          <div className="section">
            <div className="label">Your name</div>
            <form className="field" onSubmit={saveName}>
              <input value={name} maxLength={32} placeholder="What the party should call you" aria-label="Your name" onInput={event => setName(event.currentTarget.value)}/>
              <button type="submit" className="action"><Check size={14}/> Save</button>
            </form>
          </div>

          <div className="section">
            <div className="label">Invite link</div>
            <div className="field">
              <input readOnly value={link} aria-label="Invite link" onFocus={event => event.currentTarget.select()}/>
              <button type="button" className="action" onClick={() => { void copy() }}>{copied ? <Check size={14}/> : <Copy size={14}/>} Copy</button>
            </div>
          </div>

          <div className="section">
            <div className="label">In the party ({members.length})</div>
            {members.map(member => (
              <div key={member.id} className="row" data-member={member.id}>
                <span className="name" title={member.id}>{member.name ?? defaultName(member.id)}</span>
                {member.host && <span className="badge">host</span>}
                {member.self && <span className="badge you">you</span>}
                {state.role === 'host' && !member.self && (
                  <>
                    <button type="button" className="action danger" onClick={() => { void party.kick(member.id) }}><UserX size={14}/> Kick</button>
                    <button type="button" className="action danger" onClick={() => { void party.ban(member.id) }}><Ban size={14}/> Ban</button>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="section">
            <button type="button" className="action" onClick={() => { void party.leave() }}>
              <LogOut size={14}/> {state.role === 'host' ? 'End party' : 'Leave party'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default Party
