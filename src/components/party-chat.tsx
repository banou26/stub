import type { IntlShape } from 'react-intl'
import type { PartyChatLine } from '../party'
import type { Ask } from '../party/protocol'

import { css } from '@emotion/react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { party } from '../party'
import { chatText, clockText } from '../party/protocol'
import { useParty, usePartyMessages } from '../party/use-party'
import { layer } from '../layers'

const style = css`
  position: fixed;
  right: 2rem;
  bottom: 2rem;
  z-index: ${layer.headerPopup};
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1rem;

  .toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4.8rem;
    height: 4.8rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    background: #1a1a1a;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }

  .toggle:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; }

  .unread {
    position: absolute;
    top: -0.3rem;
    right: -0.3rem;
    min-width: 1.8rem;
    height: 1.8rem;
    padding: 0 0.5rem;
    border-radius: 1rem;
    background: #4ade80;
    color: #06120a;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.8rem;
    text-align: center;
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(32rem, calc(100vw - 4rem));
    height: min(40rem, calc(100vh - 12rem));
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.8rem;
    background: #1a1a1a;
    color: rgba(255, 255, 255, 0.85);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 1.3rem;
    font-weight: 600;
  }

  .head button {
    display: flex;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }

  .lines {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    font-size: 1.3rem;
    line-height: 1.4;
  }

  .line { display: flex; flex-direction: column; gap: 0.1rem; }
  .line .who { font-size: 1.1rem; color: rgba(255, 255, 255, 0.45); }
  .line.self .who { color: #4ade80; }
  .line .text { overflow-wrap: anywhere; }
  .line.action { color: rgba(255, 255, 255, 0.5); font-size: 1.2rem; font-style: italic; }
  .empty { color: rgba(255, 255, 255, 0.4); }

  form {
    display: flex;
    gap: 0.6rem;
    padding: 0.8rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  input {
    flex: 1;
    min-width: 0;
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-family: inherit;
    font-size: 1.3rem;
    outline: none;
  }

  input:focus { border-color: rgba(255, 255, 255, 0.4); }

  form button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
    border: none;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    cursor: pointer;
  }
`

/** A member's name as chat shows it: what they called themselves, else the start of their id. */
export const memberLabel = (intl: IntlShape, line: { from: string, name?: string, self: boolean }, owner: string): string =>
  line.self ? intl.formatMessage({ id: 'you#the viewer, among the party', defaultMessage: 'you', description: 'the viewer, among the party' })
  : line.name ?? (line.from === owner ? intl.formatMessage({ id: 'host#the party\'s host', defaultMessage: 'host', description: 'the party\'s host' }) : line.from.slice(0, 6))

/**
 * What a member's ask did, as its chat line says it in the language shown: each app writes the sentence from the ask
 * it heard, so a viewer reads another's action in their own language. `who` tells the viewer's own from another's.
 */
const actionText = (intl: IntlShape, ask: Ask, member: string, self: boolean): string => {
  const who = { who: self ? 'self' : 'other', member }
  return ask.c === 'go' ? intl.formatMessage({ id: '{who, select, self {you changed the episode} other {{member} changed the episode}}', defaultMessage: '{who, select, self {you changed the episode} other {{member} changed the episode}}' }, who)
    : ask.c === 'subs' ? (
      ask.sub === null
        ? intl.formatMessage({ id: '{who, select, self {you turned subtitles off} other {{member} turned subtitles off}}', defaultMessage: '{who, select, self {you turned subtitles off} other {{member} turned subtitles off}}' }, who)
        : intl.formatMessage({ id: '{who, select, self {you set subtitles to {track}} other {{member} set subtitles to {track}}}', defaultMessage: '{who, select, self {you set subtitles to {track}} other {{member} set subtitles to {track}}}' }, { ...who, track: ask.sub })
    )
    : ask.c === 'audio' ? (
      ask.audio === null
        ? intl.formatMessage({ id: '{who, select, self {you turned audio off} other {{member} turned audio off}}', defaultMessage: '{who, select, self {you turned audio off} other {{member} turned audio off}}' }, who)
        : intl.formatMessage({ id: '{who, select, self {you set audio to {track}} other {{member} set audio to {track}}}', defaultMessage: '{who, select, self {you set audio to {track}} other {{member} set audio to {track}}}' }, { ...who, track: ask.audio })
    )
    : ask.c === 'seek' ? intl.formatMessage({ id: '{who, select, self {you skipped to {time}} other {{member} skipped to {time}}}', defaultMessage: '{who, select, self {you skipped to {time}} other {{member} skipped to {time}}}' }, { ...who, time: clockText(ask.s.time, intl.locale) })
    : ask.c === 'rate' ? intl.formatMessage({ id: '{who, select, self {you set speed to {rate}x} other {{member} set speed to {rate}x}}', defaultMessage: '{who, select, self {you set speed to {rate}x} other {{member} set speed to {rate}x}}' }, { ...who, rate: intl.formatNumber(ask.s.rate, { maximumFractionDigits: 2 }) })
    : ask.s.paused ? intl.formatMessage({ id: '{who, select, self {you paused} other {{member} paused}}', defaultMessage: '{who, select, self {you paused} other {{member} paused}}' }, who)
    : intl.formatMessage({ id: '{who, select, self {you resumed} other {{member} resumed}}', defaultMessage: '{who, select, self {you resumed} other {{member} resumed}}' }, who)
}

/**
 * The party's chat, as a bubble in the corner of every page while a party is on.
 *
 * Lines live in the store, not here, so closing the panel forgets nothing and a page change forgets
 * nothing; this only draws them. Unread counts what arrived while the panel was closed.
 */
const PartyChat = () => {
  const intl = useIntl()
  const state = useParty()
  const active = state.status === 'active'
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<PartyChatLine[]>(() => party.chat())
  // the newest line the panel has shown: unread counts LINES after it, so an action line replaced by
  // the same member's next one counts once
  const [seen, setSeen] = useState(0)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)

  usePartyMessages(message => {
    if (message.t === 'chat' || message.t === 'name' || message.t === 'ask') setLines(party.chat())
  })
  useEffect(() => { if (open) setSeen(lines.at(-1)?.seq ?? 0) }, [open, lines])
  useEffect(() => { if (!active) { setLines([]); setSeen(0); setOpen(false) } }, [active])
  const unread = open ? 0 : lines.filter(line => line.seq > seen && !line.self).length
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }) }, [lines, open])

  if (!active) return null
  const owner = state.owner
  const title = intl.formatMessage({ id: 'Party chat', defaultMessage: 'Party chat' })

  const submit = (event: Event) => {
    event.preventDefault()
    const text = chatText(draft)
    if (!text) return
    party.send({ t: 'chat', text })
    setDraft('')
  }

  return (
    <div css={style}>
      {open && (
        <div className="panel" role="dialog" aria-label={title}>
          <div className="head">
            <span>{title}</span>
            <button type="button" aria-label={intl.formatMessage({ id: 'Close chat', defaultMessage: 'Close chat' })} onClick={() => setOpen(false)}><X size={16}/></button>
          </div>
          <div className="lines" ref={list}>
            {lines.length === 0 && <div className="empty">{intl.formatMessage({ id: 'Nothing said yet.', defaultMessage: 'Nothing said yet.' })}</div>}
            {lines.map(line => line.ask
              ? <div key={line.seq} className="line action">{actionText(intl, line.ask, memberLabel(intl, line, owner), line.self)}</div>
              : (
                <div key={line.seq} className={`line${line.self ? ' self' : ''}`}>
                  <span className="who">{memberLabel(intl, line, owner)}</span>
                  <span className="text">{line.text}</span>
                </div>
              ))}
          </div>
          <form onSubmit={submit}>
            <input
              value={draft}
              placeholder={intl.formatMessage({ id: 'Say something', defaultMessage: 'Say something' })}
              aria-label={intl.formatMessage({ id: 'Chat message', defaultMessage: 'Chat message' })}
              maxLength={500}
              onInput={event => setDraft(event.currentTarget.value)}
            />
            <button type="submit" aria-label={intl.formatMessage({ id: 'Send', defaultMessage: 'Send' })}><Send size={16}/></button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="toggle"
        aria-label={open ? intl.formatMessage({ id: 'Hide chat', defaultMessage: 'Hide chat' }) : intl.formatMessage({ id: 'Show chat', defaultMessage: 'Show chat' })}
        onClick={() => setOpen(value => !value)}
      >
        <MessageCircle size={20}/>
        {unread > 0 && <span className="unread">{intl.formatNumber(unread)}</span>}
      </button>
    </div>
  )
}

export default PartyChat
