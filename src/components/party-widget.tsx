import type { MessageDescriptor } from 'react-intl'
import type { FollowerState } from '../party/protocol'

import { css } from '@emotion/react'
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useClick, useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react'
import { Check, Copy, LogOut, Play, Radio, Users } from 'lucide-react'
import { defineMessages, useIntl } from 'react-intl'
import { useLocation, useSearch } from 'wouter'

import { getRoutePath, Route } from '../router/path'
import { useEffect, useState } from 'preact/hooks'

import { party, partyLink } from '../party'
import { CONTROLS, FOLLOWER_STATES, isWatchPath } from '../party/protocol'
import { shownStatus } from '../party/status'
import { useParty, usePartyMessages } from '../party/use-party'
import { layer } from '../layers'
import PartyGrants, { CONTROL_LABEL, StatusIcon } from './party-grants'
import PartyTracks from './party-tracks'
import { switchStyle } from './switch-style'
import { loadEnabled } from '../plugin-list'
import { withoutPluginUris, writePluginUris } from '../utils/plugin-links'

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

  .tally {
    display: flex;
    gap: 1.2rem;
    margin-top: 0.6rem;
    color: rgba(255, 255, 255, 0.7);
    font-size: 1.2rem;
  }

  .tally > span {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
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

  .can {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 1rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .badge {
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    background: rgba(74, 222, 128, 0.15);
    color: #4ade80;
    font-size: 1.1rem;
  }

  .follow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 1rem;
    cursor: pointer;
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

const FAILURE: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  'not-found': { id: 'That party has ended.', defaultMessage: 'That party has ended.' },
  'bad-key': { id: 'That invite link is not valid.', defaultMessage: 'That invite link is not valid.' },
  invalid: { id: 'That invite link is broken.', defaultMessage: 'That invite link is broken.' },
  full: { id: 'That party is full.', defaultMessage: 'That party is full.' },
  blocked: { id: 'You cannot join that party.', defaultMessage: 'You cannot join that party.' },
  unavailable: { id: 'Parties are not available right now. Is FKN connected?', defaultMessage: 'Parties are not available right now. Is FKN connected?' },
  'rate-limited': { id: 'Too many attempts. Try again in a moment.', defaultMessage: 'Too many attempts. Try again in a moment.' },
})

const ENDED: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  'host-left': { id: 'The host left the party.', defaultMessage: 'The host left the party.' },
  removed: { id: 'You were removed from the party.', defaultMessage: 'You were removed from the party.' },
  blocked: { id: 'You were removed from the party.', defaultMessage: 'You were removed from the party.' },
  ended: { id: 'The party ended.', defaultMessage: 'The party ended.' },
  unavailable: { id: 'The party was lost. Parties are unavailable right now.', defaultMessage: 'The party was lost. Parties are unavailable right now.' },
  left: { id: 'You left the party.', defaultMessage: 'You left the party.' },
})

// how many followers stand where, as the host's menu counts them
const TALLY: Readonly<Record<FollowerState, MessageDescriptor>> = defineMessages({
  ready: { id: '{count, plural, one {{count} ready} other {{count} ready}}#followers ready to play', defaultMessage: '{count, plural, one {{count} ready} other {{count} ready}}', description: 'followers ready to play' },
  loading: { id: '{count, plural, one {{count} loading} other {{count} loading}}#followers whose player is loading', defaultMessage: '{count, plural, one {{count} loading} other {{count} loading}}', description: 'followers whose player is loading' },
  away: { id: '{count, plural, one {{count} away} other {{count} away}}#followers off the host\'s page', defaultMessage: '{count, plural, one {{count} away} other {{count} away}}', description: 'followers off the host\'s page' },
})

/**
 * The party, as a button in the header: start one, share it, see who is in it, leave it.
 *
 * One control for every state rather than several, so it always sits in the same place and a
 * reader learns one spot to look at.
 */
const PartyWidget = () => {
  const intl = useIntl()
  const state = useParty()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [page, navigate] = useLocation()
  const search = useSearch()
  const here = withoutPluginUris(search ? `${page}?${search}` : page)
  // Play for everyone and the host's count read the store, which moves on these and re-renders nothing
  const [, heard] = useState(0)
  usePartyMessages(message => { if (message.t === 'nav' || message.t === 'state' || message.t === 'status') heard(n => n + 1) })
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

  // the host's sources ride along, so a follower without one is offered it the way any link offers a source
  const link = state.status === 'active' ? writePluginUris(partyLink(location.origin, state.invite), loadEnabled(), location.href) : undefined
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true) } catch {}
  }

  if (state.status === 'idle') {
    const start = intl.formatMessage({ id: 'Watch party', defaultMessage: 'Watch party' })
    return (
      <button type="button" css={buttonStyle} onClick={() => { void party.create() }} title={start}>
        <Users size={16}/>
        <span className="label">{start}</span>
      </button>
    )
  }

  const live = state.status === 'active'
  const can = CONTROLS.filter(control => party.may(control))
  const watching = isWatchPath(here) ? here : undefined
  const now = Date.now()
  const standing = watching && live && state.role === 'host'
    ? [...party.statuses().values()].map(({ status, at }) => shownStatus(status, now - at, watching).s)
    : []
  const playHere = can.includes('go') && isWatchPath(here) && here !== party.hostPath()
  const label =
    state.status === 'joining' ? intl.formatMessage({ id: 'Joining…', defaultMessage: 'Joining…' })
    : state.status === 'active' ? (state.role === 'host' ? intl.formatMessage({ id: 'Hosting', defaultMessage: 'Hosting' }) : intl.formatMessage({ id: 'Following#following the host', defaultMessage: 'Following', description: 'following the host' }))
    : state.status === 'ended' ? intl.formatMessage({ id: 'Party over', defaultMessage: 'Party over' })
    : intl.formatMessage({ id: 'Party failed', defaultMessage: 'Party failed' })
  const toPartyLabel = intl.formatMessage({ id: 'Party#opens the party page', defaultMessage: 'Party', description: 'opens the party page' })

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
        {live && <span className="count">{intl.formatNumber(state.members)}</span>}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} css={menuStyle} style={floatingStyles} {...getFloatingProps()}>
              {state.status === 'joining' && <div className="title">{intl.formatMessage({ id: 'Joining the party…', defaultMessage: 'Joining the party…' })}</div>}
              {state.status === 'active' && state.role === 'host' && (
                <>
                  <div className="title">{intl.formatMessage({ id: 'You are hosting', defaultMessage: 'You are hosting' })}</div>
                  <div className="hint">
                    {
                      state.members === 1
                        ? intl.formatMessage({ id: 'Nobody has joined yet.', defaultMessage: 'Nobody has joined yet.' })
                        : intl.formatMessage({ id: '{count, plural, one {{count} person is following you.} other {{count} people are following you.}}', defaultMessage: '{count, plural, one {{count} person is following you.} other {{count} people are following you.}}' }, { count: state.members - 1 })
                    }
                  </div>
                  {standing.length > 0 && (
                    <div className="tally">
                      {FOLLOWER_STATES.map(s => {
                        const count = standing.filter(other => other === s).length
                        return count > 0 && <span key={s}><StatusIcon s={s}/>{intl.formatMessage(TALLY[s], { count })}</span>
                      })}
                    </div>
                  )}
                  <div className="link">
                    <input readOnly value={link} aria-label={intl.formatMessage({ id: 'Invite link', defaultMessage: 'Invite link' })} onFocus={event => event.currentTarget.select()}/>
                    <button type="button" onClick={() => { void copy() }} aria-label={intl.formatMessage({ id: 'Copy invite link', defaultMessage: 'Copy invite link' })}>
                      {copied ? <Check size={14}/> : <Copy size={14}/>}
                    </button>
                  </div>
                  <PartyGrants page={watching}/>
                  <PartyTracks/>
                  <div className="actions">
                    <button type="button" className="primary" onClick={toParty}><Users size={14}/> {toPartyLabel}</button>
                    <button type="button" onClick={() => { void party.leave(); setOpen(false) }}><LogOut size={14}/> {intl.formatMessage({ id: 'End party', defaultMessage: 'End party' })}</button>
                  </div>
                </>
              )}
              {state.status === 'active' && state.role === 'guest' && (
                <>
                  <div className="title">{intl.formatMessage({ id: 'You are following the host', defaultMessage: 'You are following the host' })}</div>
                  <div className="hint">
                    {intl.formatMessage({ id: '{count, plural, one {{count} in the party.} other {{count} in the party.}}', defaultMessage: '{count, plural, one {{count} in the party.} other {{count} in the party.}}' }, { count: state.members })}
                  </div>
                  <label className="follow">
                    {intl.formatMessage({ id: 'Follow playback', defaultMessage: 'Follow playback' })}
                    <input type="checkbox" role="switch" css={switchStyle} checked={party.following()} onChange={event => party.setFollowing(event.currentTarget.checked)}/>
                  </label>
                  {can.length > 0 && (
                    <div className="can">
                      {intl.formatMessage(
                        { id: 'You can {controls}#the controls the host gave', defaultMessage: 'You can {controls}', description: 'the controls the host gave' },
                        { controls: can.map(control => <span key={control} className="badge">{intl.formatMessage(CONTROL_LABEL[control])}</span>) },
                      )}
                    </div>
                  )}
                  <PartyTracks/>
                  {playHere && (
                    <div className="actions">
                      <button type="button" onClick={() => { party.send({ t: 'ask', c: 'go', path: here }); setOpen(false) }}><Play size={14}/> {intl.formatMessage({ id: 'Play for everyone', defaultMessage: 'Play for everyone' })}</button>
                    </div>
                  )}
                  <div className="actions">
                    <button type="button" className="primary" onClick={() => { party.replay(); setOpen(false) }}>{intl.formatMessage({ id: 'Catch up', defaultMessage: 'Catch up' })}</button>
                    <button type="button" onClick={toParty}><Users size={14}/> {toPartyLabel}</button>
                    <button type="button" onClick={() => { void party.leave(); setOpen(false) }}><LogOut size={14}/> {intl.formatMessage({ id: 'Leave#the party', defaultMessage: 'Leave', description: 'the party' })}</button>
                  </div>
                </>
              )}
              {(state.status === 'ended' || state.status === 'failed') && (
                <>
                  <div className="title">
                    {
                      state.status === 'ended' ? intl.formatMessage(ENDED[state.reason] ?? ENDED.ended!)
                      : FAILURE[state.code] ? intl.formatMessage(FAILURE[state.code]!)
                      : intl.formatMessage({ id: 'The party could not start.', defaultMessage: 'The party could not start.' })
                    }
                  </div>
                  <div className="actions">
                    <button type="button" className="primary" onClick={() => { party.dismiss(); setOpen(false) }}>{intl.formatMessage({ id: 'OK', defaultMessage: 'OK' })}</button>
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
