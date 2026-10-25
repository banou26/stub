import type { AccountsProps } from './accounts'

import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import OriginIcon from '../../components/origin-icon'
import { switchStyle } from '../../components/switch-style'
import { addPlugins, disablePlugin, installPlugin, onPluginsChange, pluginStatuses, type PluginStatus } from '../../plugins'
import { builtInSources, drawnAs } from '../../sources/built-in'
import { setIconShown, useHiddenIcons } from '../../sources/hidden-icons'
import { readDisabledSources, setSourceEnabled, turnSourcesOn, watchDisabledSources } from '../../sources/disabled-sources'
import { siteAsks } from '../../site'
import { SourceAccount } from './accounts'
import { CountryRow } from './country'

const style = css`
  h3.part {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    margin: 3.2rem 0 0.6rem;
  }

  .part-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.2rem;
    margin: 2.4rem 0 0.8rem;
  }

  .part-head .count { font-size: 1.3rem; color: rgba(255, 255, 255, 0.5); }
  .part-head .link-button { margin-left: auto; }

  ul.cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 32rem), 1fr));
    gap: 0.8rem;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    min-width: 0;
    padding: 1.2rem 1.4rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .card .top {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    min-width: 0;
  }

  .card .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
    transition: opacity 0.15s;
  }

  .card .icon img { width: 2rem; height: 2rem; object-fit: contain; }
  .card .icon .letter { font-size: 1.5rem; font-weight: 700; color: rgba(255, 255, 255, 0.7); }

  .card .title { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  .card h3 { font-size: 1.5rem; overflow-wrap: anywhere; transition: color 0.15s; }
  .card .from { font-size: 1.2rem; color: rgba(255, 255, 255, 0.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card.off h3 { color: rgba(255, 255, 255, 0.5); }
  .card.off .icon { opacity: 0.5; }

  .card .switches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem 2.4rem;
  }

  .card .switches label {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
  }

  .card .account {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.2rem;
    padding-top: 1.2rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .card .account .state { margin-right: auto; font-size: 1.3rem; color: rgba(255, 255, 255, 0.55); }
  .card .account .state.on { color: #4ade80; }
  .card .account .actions { margin-left: auto; }
  .card .account p { font-size: 1.3rem; }
  .card .account .note { flex-basis: 100%; }
  .card .account button:not(.small) { padding: 0.5rem 1.2rem; font-size: 1.3rem; }

  @media (prefers-reduced-motion: reduce) {
    .card .icon, .card h3 { transition: none; }
  }

  button.link-button {
    padding: 0;
    border: none;
    background: none;
    color: #f47521;
    font-size: 1.4rem;
    font-weight: 500;
  }

  button.link-button:hover:not([aria-disabled='true']) { color: #ff8a3d; }
  button.link-button[aria-disabled='true'] { color: rgba(255, 255, 255, 0.35); cursor: default; }

  .row.plugin {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.8rem 1.2rem;
  }

  .plugin .info {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .plugin .name { font-size: 1.6rem; font-weight: 600; color: #fff; overflow-wrap: anywhere; }
  .plugin .meta { font-size: 1.25rem; color: rgba(255, 255, 255, 0.5); overflow-wrap: anywhere; }
  .plugin .uri { font-family: monospace; }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 1rem;
    border-radius: 2rem;
    font-size: 1.25rem;
    font-weight: 600;
    white-space: nowrap;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
  }

  .pill[data-state='connected'] { --tone: #4ade80; }
  .pill[data-state='connecting'] { --tone: #fbbf24; }
  .pill[data-state='error'] { --tone: #f87171; }

  .dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--tone);
  }

  .pill[data-state='connecting'] .dot { animation: pulse 1.4s ease-in-out infinite; }

  @keyframes pulse { 50% { opacity: 0.3; } }

  @media (prefers-reduced-motion: reduce) {
    .pill[data-state='connecting'] .dot { animation: none; }
  }

  button.small { padding: 0.5rem 1.2rem; font-size: 1.3rem; }

  .row.plugin p.failure {
    grid-column: 1 / -1;
    color: #f87171;
    font-size: 1.3rem;
  }

  /* on a phone the pill goes under the address, so Remove stays at the right edge of every row */
  @media (max-width: 480px) {
    .row.plugin { grid-template-columns: minmax(0, 1fr) auto; }
    .row.plugin .pill { grid-column: 1; grid-row: 2; justify-self: start; }
    .row.plugin > button { grid-column: 2; grid-row: 1 / span 2; }
  }

  .row.empty {
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .add {
    margin-top: 1.6rem;
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    padding: 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .browse { display: flex; }

  .by-address { display: flex; flex-direction: column; gap: 0.6rem; }
  .by-address label { font-size: 1.3rem; font-weight: 500; color: rgba(255, 255, 255, 0.6); }

  .group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    max-width: 52rem;
    padding: 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.04);
    transition: border-color 0.15s;
  }

  .group:focus-within { border-color: rgba(255, 255, 255, 0.5); }
  .group.invalid, .group.invalid:focus-within { border-color: #f87171; }

  /* the input takes the row and the button only its width; once wrapped, alone on its row, the button takes all of it */
  .group input {
    flex: 1000 1 18rem;
    min-width: 0;
    height: 3.2rem;
    padding: 0 0.8rem;
    border: none;
    background: none;
    color: #fff;
    font-family: ui-monospace, monospace;
    font-size: 1.4rem;
    outline: none;
  }

  .group input::placeholder { color: rgba(255, 255, 255, 0.4); }

  /* a minimum width, so Adding... does not widen it under the pointer */
  .group button {
    flex: 1 0 auto;
    height: 3.2rem;
    min-width: 9.6rem;
    padding: 0 1.4rem;
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .group button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); }
  .group button:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.8); outline-offset: 0; }

  .by-address .note { font-size: 1.35rem; overflow-wrap: anywhere; }
`

const STATE_LABEL: Record<PluginStatus['state'], string> = { connected: 'Connected', connecting: 'Connecting', error: 'Error' }

const PluginRow = ({ plugin, onRemove }: { plugin: PluginStatus, onRemove: () => void }) => {
  const sources = plugin.sources ?? []
  const name = sources.length ? sources.map(source => source.name).join(', ') : plugin.uri.replace(/^npm:/, '')
  return (
    <li className="row plugin" data-plugin={plugin.uri}>
      <div className="info">
        <span className="name">{name}</span>
        {/* until it registers, the name above is the address already */}
        {sources.length
          ? (
            <span className="meta">
              <span className="uri">{plugin.uri}</span>
              {/* a package may register a family of sources, and some of them and not others */}
              {sources.length > 1 ? ` · ${sources.length} sources` : ''}
              {plugin.rejected?.length ? ` · ${plugin.rejected.length} unavailable` : ''}
            </span>
          )
          : undefined}
      </div>
      <span className="pill" data-state={plugin.state}><span className="dot" aria-hidden="true"/>{STATE_LABEL[plugin.state]}</span>
      <button type="button" className="secondary small" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
      {plugin.state === 'error' ? <p className="failure">Could not connect to this source.</p> : undefined}
    </li>
  )
}

// the site a source reads, with its path when it has one: the offline database's site is a project on github.com
const siteOf = (url: string) => {
  const { host, pathname } = new URL(url)
  return host.replace(/^www\./, '') + pathname.replace(/\/$/, '')
}

type Card = {
  origin: string
  name: string
  /** The site it reads, or the address of the package that added it. */
  from: string
  icon?: string | null
  /** The origin its icon is drawn as, when stub draws one. */
  drawn?: string
  /** This site asks it, so it has a switch. */
  asked: boolean
}

// every drawn icon on every site, not only the sources this site asks: Simkl and Watchmode mint `mal`, `anilist` and `cr` handles everywhere
const BUILT_IN: Card[] = builtInSources
  .map(source => ({ origin: source.origin, name: source.name, from: siteOf(source.url), icon: source.icon, drawn: drawnAs(source.origin), asked: siteAsks(source.origin) }))
  .filter(card => card.asked || card.drawn)

const addedCards = (plugins: readonly PluginStatus[]): Card[] => plugins.flatMap(plugin => plugin.state === 'connected'
  ? (plugin.sources ?? []).map(source => ({ origin: source.origin, name: source.name, from: plugin.uri, icon: source.icon, drawn: source.isApiOnly ? undefined : source.origin, asked: true }))
  : [])

const SourceCard = ({ card, on, shown, accounts }: { card: Card, on: boolean, shown: boolean, accounts: AccountsProps }) => {
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <li className={`card${on ? '' : ' off'}`} data-source={card.origin}>
      <div className="top">
        <span className="icon">
          {card.icon ? <OriginIcon icon={card.icon} name={card.name}/> : <span className="letter" aria-hidden="true">{card.name.charAt(0)}</span>}
        </span>
        <div className="title">
          <h3 ref={heading} tabIndex={-1}>{card.name}</h3>
          <span className="from">{card.from}</span>
        </div>
      </div>
      <div className="switches">
        {card.asked
          ? (
            <label>
              Source
              <input type="checkbox" role="switch" css={switchStyle} aria-label={`${card.name} source`} checked={on} onChange={event => setSourceEnabled(card.origin, (event.target as HTMLInputElement).checked)}/>
            </label>
          )
          : undefined}
        {card.drawn
          ? (
            <label>
              Icon
              <input type="checkbox" role="switch" css={switchStyle} aria-label={`${card.name} icon`} checked={shown} onChange={event => setIconShown(card.drawn!, (event.target as HTMLInputElement).checked)}/>
            </label>
          )
          : undefined}
      </div>
      <SourceAccount origin={card.origin} heading={heading} {...accounts}/>
    </li>
  )
}

/**
 * The viewer's country, then a card for every source stub ships with or the viewer added, each with its
 * switches and its sign-in, then the added packages and the two ways to add more.
 */
export const SourcesSection = (accounts: AccountsProps) => {
  const [plugins, setPlugins] = useState<PluginStatus[]>(pluginStatuses)
  const [disabled, setDisabled] = useState(() => new Set(readDisabledSources()))
  const hidden = useHiddenIcons()
  const [uri, setUri] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const id = useId()
  const refresh = () => setPlugins(pluginStatuses())

  // Re-read on subscribe, not just on notify: a plugin whose frame is already warm connects before the effect subscribes, leaving a connected source stuck reading "connecting"
  useEffect(() => {
    refresh()
    return onPluginsChange(refresh)
  }, [])
  useEffect(() => watchDisabledSources(() => setDisabled(new Set(readDisabledSources()))), [])

  const cards = [...BUILT_IN, ...addedCards(plugins)]
  const switched = cards.filter(card => card.asked)
  const off = switched.filter(card => disabled.has(card.origin)).length

  const onAdd = (event: Event) => {
    event.preventDefault()
    const trimmed = uri.trim()
    if (!trimmed || adding) return
    setAdding(true)
    setAddError('')
    installPlugin(trimmed)
      // null is the viewer declining FKN's confirm, which keeps the address to try again
      .then(installed => { if (installed) setUri('') })
      .catch(error => {
        console.warn(`Source '${trimmed}' could not be added:`, error)
        setAddError('Could not add this source. Check the address.')
      })
      .finally(() => {
        setAdding(false)
        refresh()
      })
  }

  // Turn all on stays mounted when nothing is off, so no line comes or goes under the pointer and focus stays put
  return (
    <div css={style}>
      <div className="rows">
        <CountryRow/>
      </div>
      <div className="part-head">
        <span className="count">{off ? `${switched.length - off} of ${switched.length} on` : `All ${switched.length} on`}</span>
        <button type="button" className="link-button" aria-disabled={off ? undefined : true} onClick={() => { if (off) turnSourcesOn(switched.map(card => card.origin)) }}>Turn all on</button>
      </div>
      <ul className="cards">
        {cards.map(card => <SourceCard key={card.origin} card={card} on={!card.asked || !disabled.has(card.origin)} shown={!card.drawn || !hidden.has(card.drawn)} accounts={accounts}/>)}
      </ul>
      <h3 className="part">Added</h3>
      {plugins.length
        ? (
          <ul className="rows">
            {plugins.map(plugin => <PluginRow key={plugin.uri} plugin={plugin} onRemove={() => { void disablePlugin(plugin.uri).then(refresh) }}/>)}
          </ul>
        )
        : <p className="row empty">No sources added yet.</p>}
      <div className="add">
        <div className="browse">
          <button type="button" onClick={() => { void addPlugins().finally(refresh) }}>Browse sources</button>
        </div>
        <form className="by-address" onSubmit={onAdd}>
          <label for={`${id}-address`}>Or add one by its address</label>
          <div className={`group${addError ? ' invalid' : ''}`}>
            <input
              id={`${id}-address`}
              type="text"
              autoComplete="off"
              spellcheck={false}
              placeholder="npm:@scope/package"
              aria-invalid={addError ? true : undefined}
              aria-describedby={`${id}-error`}
              value={uri}
              onInput={event => setUri((event.target as HTMLInputElement).value)}
            />
            <button type="submit" disabled={adding}>{adding ? 'Adding...' : 'Add'}</button>
          </div>
          {/* always mounted, empty until there is an error: an alert inserted with its text is not announced by every screen reader */}
          <p className="note error" id={`${id}-error`} role="alert">{addError}</p>
        </form>
      </div>
    </div>
  )
}
