import type { ComponentChildren } from 'preact'
import type { MessageDescriptor } from 'react-intl'
import type { PluginSettingField, PluginValues } from '../../plugin-api'
import type { AccountsProps } from './accounts'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { css } from '@emotion/react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { defineMessages, useIntl } from 'react-intl'

import OriginIcon from '../../components/origin-icon'
import { switchStyle } from '../../components/switch-style'
import { NAME_LIST } from '../../i18n'
import { loadPluginValues } from '../../plugin-list'
import { addPlugins, configurePlugin, disablePlugin, installPlugin, onPluginsChange, pluginStatuses, type PluginStatus } from '../../plugins'
import { builtInSources, drawnAs } from '../../sources/built-in'
import { setIconShown, useHiddenIcons } from '../../sources/hidden-icons'
import { readDisabledSources, setSourceEnabled, turnSourcesOn, watchDisabledSources } from '../../sources/disabled-sources'
import { mergeOrder, readMergeOrder, watchMergeOrder, writeMergeOrder } from '../../sources/merge-order'
import { DEFAULT_PLAY_ORDER, moved, playOrder, readPlayOrder, watchPlayOrder, writePlayOrder } from '../../sources/play-order'
import { siteAsks } from '../../site'
import { SourceAccount } from './accounts'
import { CountryRow } from './country'
import { reorder } from './reorder'

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
  .part-head + h3.part { margin-top: 1.6rem; }
  .part-head .link-button { margin-left: auto; }

  .cards {
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

  .card .title { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; margin-right: auto; }
  /* two digits wide, so the icons of a list past nine line up */
  .card .place { flex: none; min-width: 2ch; text-align: end; font-size: 1.5rem; font-weight: 600; color: rgba(255, 255, 255, 0.45); font-variant-numeric: tabular-nums; }
  .card .order { flex: none; display: flex; gap: 0.4rem; }

  /* touch-action: none, or a touch on the grip scrolls the page and the drag never starts */
  .card .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    color: rgba(255, 255, 255, 0.35);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-touch-callout: none;

    svg { width: 1.6rem; height: 1.6rem; }
  }

  .card .grip:hover { color: rgba(255, 255, 255, 0.7); }

  /* it takes no pointer, so the card under the pointer can be found */
  .card[data-dragging] {
    position: relative;
    z-index: 1;
    pointer-events: none;
    background: #181818;
    box-shadow: 0 0.8rem 2.4rem rgba(0, 0, 0, 0.6);
  }

  .card[data-over] { outline: 2px solid #f47521; outline-offset: -1px; }

  .card .order button {
    display: grid;
    place-items: center;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;

    svg { width: 1.6rem; height: 1.6rem; }
  }

  .card .order button[aria-disabled='true'] { opacity: 0.35; cursor: default; }
  .card h4 { font-size: 1.5rem; font-weight: 600; overflow-wrap: anywhere; transition: color 0.15s; }
  .card .from { font-size: 1.2rem; color: rgba(255, 255, 255, 0.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card.off h4 { color: rgba(255, 255, 255, 0.5); }
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
    .card .icon, .card h4 { transition: none; }
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

  .plugin form {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 52rem;
  }

  .plugin form label {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 1.3rem;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.6);
    overflow-wrap: anywhere;
  }

  .plugin form input {
    height: 3.6rem;
    padding: 0 0.8rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.04);
    color: #fff;
    font: inherit;
    font-size: 1.4rem;
    outline: none;
  }

  .plugin form input:focus { border-color: rgba(255, 255, 255, 0.5); }
  .plugin form button { align-self: flex-start; }
  .plugin form button[aria-disabled='true'] { opacity: 0.6; cursor: default; }

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

const STATE_LABEL = defineMessages<PluginStatus['state']>({
  connected: { id: 'Connected#state of an added source', defaultMessage: 'Connected', description: 'state of an added source' },
  connecting: { id: 'Connecting#state of an added source', defaultMessage: 'Connecting', description: 'state of an added source' },
  error: { id: 'Error#state of an added source', defaultMessage: 'Error', description: 'state of an added source' },
})

const MOVE = defineMessages({
  up: { id: 'Move {name} up', defaultMessage: 'Move {name} up' },
  down: { id: 'Move {name} down', defaultMessage: 'Move {name} down' },
  mergeUp: { id: 'Move {name} up in the merge order', defaultMessage: 'Move {name} up in the merge order' },
  mergeDown: { id: 'Move {name} down in the merge order', defaultMessage: 'Move {name} down in the merge order' },
})

// an address's own form, the same in every language
const ADDRESS_EXAMPLE = 'npm:@scope/package'

// Preact's types tell its input apart by a literal `type`, so a union of them only checks through a cast
const INPUT_TYPE = { text: 'text', url: 'url', secret: 'password' }

/** What a package asks the viewer for. A field left empty is not kept, which is how a required one reads as missing. */
const PluginForm = ({ uri, name, fields }: { uri: string, name: string, fields: PluginSettingField[] }) => {
  const intl = useIntl()
  const [saved, setSaved] = useState(() => loadPluginValues(uri))
  // what was typed since the last save alone, so a value another site saved reaches every other field
  const [draft, setDraft] = useState<PluginValues>({})
  const shown = { ...saved, ...draft }
  const entered = Object.fromEntries(fields.flatMap(({ key }) => shown[key]?.trim() ? [[key, shown[key].trim()]] : []))
  const changed = fields.some(({ key }) => entered[key] !== saved[key])
  const missing = fields.filter(field => field.required && !saved[field.key]).map(field => field.label)

  useEffect(() => onPluginsChange(() => setSaved(loadPluginValues(uri))), [uri])

  const onSave = (event: Event) => {
    event.preventDefault()
    if (!changed) return
    setSaved(entered)
    setDraft({})
    void configurePlugin(uri, entered)
  }

  // aria-disabled, so the press that saves leaves the focus on the button
  return (
    <form onSubmit={onSave}>
      {fields.map(({ key, label, kind, required }) => (
        <label key={key}>
          {label}
          <input
            type={INPUT_TYPE[kind] as 'text'}
            autoComplete={kind === 'secret' ? 'new-password' : 'off'}
            spellcheck={false}
            aria-required={required ? true : undefined}
            value={shown[key] ?? ''}
            onInput={event => setDraft({ ...draft, [key]: (event.target as HTMLInputElement).value })}
          />
        </label>
      ))}
      {missing.length ? <p className="failure">{intl.formatMessage({ id: 'Required: {fields}', defaultMessage: 'Required: {fields}' }, { fields: intl.formatList(missing, NAME_LIST) })}</p> : undefined}
      <button type="submit" className="secondary small" aria-label={intl.formatMessage({ id: 'Save {name} settings', defaultMessage: 'Save {name} settings' }, { name })} aria-disabled={changed ? undefined : true}>
        {intl.formatMessage({ id: 'Save', defaultMessage: 'Save' })}
      </button>
    </form>
  )
}

const PluginRow = ({ plugin, onRemove }: { plugin: PluginStatus, onRemove: () => void }) => {
  const intl = useIntl()
  const sources = plugin.sources ?? []
  const name = sources.length ? intl.formatList(sources.map(source => source.name), NAME_LIST) : plugin.uri.replace(/^npm:/, '')
  // a package may register a family of sources, and some of them and not others
  const counts = [
    sources.length > 1 ? intl.formatMessage({ id: '{count, plural, one {{count} source} other {{count} sources}}', defaultMessage: '{count, plural, one {{count} source} other {{count} sources}}' }, { count: sources.length }) : undefined,
    plugin.rejected?.length ? intl.formatMessage({ id: '{count, plural, one {{count} unavailable} other {{count} unavailable}}', defaultMessage: '{count, plural, one {{count} unavailable} other {{count} unavailable}}' }, { count: plugin.rejected.length }) : undefined,
  ].filter(Boolean).map(part => ` · ${part}`).join('')
  return (
    <li className="row plugin" data-plugin={plugin.uri}>
      <div className="info">
        <span className="name">{name}</span>
        {/* until it registers, the name above is the address already */}
        {sources.length
          ? (
            <span className="meta">
              <span className="uri">{plugin.uri}</span>
              {counts}
            </span>
          )
          : undefined}
      </div>
      <span className="pill" data-state={plugin.state}><span className="dot" aria-hidden="true"/>{intl.formatMessage(STATE_LABEL[plugin.state])}</span>
      <button type="button" className="secondary small" aria-label={intl.formatMessage({ id: 'Remove {name}', defaultMessage: 'Remove {name}' }, { name })} onClick={onRemove}>
        {intl.formatMessage({ id: 'Remove', defaultMessage: 'Remove' })}
      </button>
      {plugin.state === 'error' ? <p className="failure">{intl.formatMessage({ id: 'Could not connect to this source.', defaultMessage: 'Could not connect to this source.' })}</p> : undefined}
      {plugin.settings?.length ? <PluginForm uri={plugin.uri} name={name} fields={plugin.settings}/> : undefined}
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

/**
 * A source's card; in a ranked list it has its place, the grip that drags it and the buttons that move it. A `brief`
 * card is a source's second one, its switches and sign-in on its first.
 */
const SourceCard = ({ card, on, shown, accounts, place, grab, brief, children }: { card: Card, on: boolean, shown: boolean, accounts: AccountsProps, place?: number, grab?: (event: PointerEvent) => void, brief?: boolean, children?: ComponentChildren }) => {
  const intl = useIntl()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <li className={`card${brief ? ' brief' : ''}${on ? '' : ' off'}`} data-source={card.origin}>
      <div className="top">
        {grab ? <span className="grip" aria-hidden="true" onPointerDown={grab}><GripVertical/></span> : undefined}
        {place ? <span className="place" aria-hidden="true">{place}</span> : undefined}
        <span className="icon">
          {card.icon ? <OriginIcon icon={card.icon} name={card.name}/> : <span className="letter" aria-hidden="true">{card.name.charAt(0)}</span>}
        </span>
        <div className="title">
          <h4 ref={heading} tabIndex={-1}>{card.name}</h4>
          <span className="from">{card.from}</span>
        </div>
        {children ? <div className="order">{children}</div> : undefined}
      </div>
      {brief
        ? undefined
        : (
          <>
            <div className="switches">
              {card.asked
                ? (
                  <label>
                    {intl.formatMessage({ id: 'Source#switch using a source', defaultMessage: 'Source', description: 'switch using a source' })}
                    <input type="checkbox" role="switch" css={switchStyle} aria-label={intl.formatMessage({ id: '{name} source', defaultMessage: '{name} source' }, { name: card.name })} checked={on} onChange={event => setSourceEnabled(card.origin, (event.target as HTMLInputElement).checked)}/>
                  </label>
                )
                : undefined}
              {card.drawn
                ? (
                  <label>
                    {intl.formatMessage({ id: 'Icon#switch showing a source icon', defaultMessage: 'Icon', description: 'switch showing a source icon' })}
                    <input type="checkbox" role="switch" css={switchStyle} aria-label={intl.formatMessage({ id: '{name} icon', defaultMessage: '{name} icon' }, { name: card.name })} checked={shown} onChange={event => setIconShown(card.drawn!, (event.target as HTMLInputElement).checked)}/>
                  </label>
                )
                : undefined}
            </div>
            <SourceAccount origin={card.origin} heading={heading} {...accounts}/>
          </>
        )}
    </li>
  )
}

/**
 * The viewer's country, then a card for every source stub ships with or the viewer added, each with its
 * switches and its sign-in, the ones Play tries first and in the order it tries them, then the built-in
 * ones the merge weighs in the order it weighs them, a player among them again as a brief card, then the
 * added packages and the two ways to add more.
 */
export const SourcesSection = (accounts: AccountsProps) => {
  const intl = useIntl()
  const [plugins, setPlugins] = useState<PluginStatus[]>(pluginStatuses)
  const [disabled, setDisabled] = useState(() => new Set(readDisabledSources()))
  const [kept, setKept] = useState(readPlayOrder)
  const [keptMerge, setKeptMerge] = useState(readMergeOrder)
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
  useEffect(() => watchPlayOrder(() => setKept(readPlayOrder())), [])
  useEffect(() => watchMergeOrder(() => setKeptMerge(readMergeOrder())), [])

  // every added source is ranked: only the worker holding its package knows whether it plays
  const added = addedCards(plugins)
  const players = [...BUILT_IN.filter(card => card.asked && DEFAULT_PLAY_ORDER.includes(card.origin)), ...added]
  const order = playOrder(kept, added.map(card => card.origin))
  const ranked = order.flatMap(origin => players.filter(card => card.origin === origin))
  const merging = mergeOrder(keptMerge)
  const merged = merging.flatMap(origin => BUILT_IN.filter(card => card.origin === origin && card.asked))
  const others = BUILT_IN.filter(card => !players.includes(card) && !merged.includes(card))
  const switched = [...ranked, ...merged.filter(card => !players.includes(card)), ...others].filter(card => card.asked)
  const off = switched.filter(card => disabled.has(card.origin)).length

  // a keyed card moved in the DOM loses the focus, so the pressed button takes it back; the end buttons stay
  // focusable for it
  const pressed = useRef<HTMLButtonElement | undefined>(undefined)
  useLayoutEffect(() => {
    pressed.current?.focus()
    pressed.current = undefined
  })

  type Ranking = { cards: Card[], order: string[], write: (order: string[]) => void, up: MessageDescriptor, down: MessageDescriptor }
  const play: Ranking = { cards: ranked, order, write: writePlayOrder, up: MOVE.up, down: MOVE.down }
  const merge: Ranking = { cards: merged, order: merging, write: writeMergeOrder, up: MOVE.mergeUp, down: MOVE.mergeDown }

  const move = (card: Card, step: -1 | 1, at: number, ranking: Ranking) => {
    const end = step < 0 ? at === 0 : at === ranking.cards.length - 1
    return (
      <button
        type="button"
        className="secondary"
        aria-label={intl.formatMessage(step < 0 ? ranking.up : ranking.down, { name: card.name })}
        aria-disabled={end ? true : undefined}
        onClick={event => {
          if (end) return
          pressed.current = event.currentTarget
          ranking.write(moved(ranking.order, card.origin, step, ranking.cards.map(other => other.origin)))
        }}
      >
        {step < 0 ? <ChevronUp/> : <ChevronDown/>}
      </button>
    )
  }
  // the grip is for a pointer only: the buttons are how a keyboard or a screen reader moves a card
  const drag = (card: Card, at: number, ranking: Ranking) =>
    reorder(onto => ranking.write(moved(ranking.order, card.origin, onto - at, ranking.cards.map(other => other.origin))))
  const cardOf = (card: Card, ranking?: Ranking, at = 0) => (
    <SourceCard key={card.origin} card={card} on={!card.asked || !disabled.has(card.origin)} shown={!card.drawn || !hidden.has(card.drawn)} accounts={accounts} place={ranking ? at + 1 : undefined} grab={ranking ? drag(card, at, ranking) : undefined} brief={ranking === merge && players.includes(card)}>
      {ranking ? <>{move(card, -1, at, ranking)}{move(card, 1, at, ranking)}</> : undefined}
    </SourceCard>
  )

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
        setAddError(intl.formatMessage({ id: 'Could not add this source. Check the address.', defaultMessage: 'Could not add this source. Check the address.' }))
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
        <span className="count">
          {off
            ? intl.formatMessage({ id: '{on, plural, one {{on} of {count} on} other {{on} of {count} on}}', defaultMessage: '{on, plural, one {{on} of {count} on} other {{on} of {count} on}}' }, { on: switched.length - off, count: switched.length })
            : intl.formatMessage({ id: '{count, plural, one {All {count} on} other {All {count} on}}', defaultMessage: '{count, plural, one {All {count} on} other {All {count} on}}' }, { count: switched.length })}
        </span>
        <button type="button" className="link-button" aria-disabled={off ? undefined : true} onClick={() => { if (off) turnSourcesOn(switched.map(card => card.origin)) }}>
          {intl.formatMessage({ id: 'Turn all on', defaultMessage: 'Turn all on' })}
        </button>
      </div>
      <h3 className="part">{intl.formatMessage({ id: 'Play order', defaultMessage: 'Play order' })}</h3>
      <ol className="cards play-order">{ranked.map((card, at) => cardOf(card, play, at))}</ol>
      <h3 className="part">{intl.formatMessage({ id: 'Merge order', defaultMessage: 'Merge order' })}</h3>
      <ol className="cards merge-order">{merged.map((card, at) => cardOf(card, merge, at))}</ol>
      <h3 className="part">{intl.formatMessage({ id: 'Other sources', defaultMessage: 'Other sources' })}</h3>
      <ul className="cards">{others.map(card => cardOf(card))}</ul>
      <h3 className="part">{intl.formatMessage({ id: 'Added#sources the viewer added', defaultMessage: 'Added', description: 'sources the viewer added' })}</h3>
      {plugins.length
        ? (
          <ul className="rows">
            {plugins.map(plugin => <PluginRow key={plugin.uri} plugin={plugin} onRemove={() => { void disablePlugin(plugin.uri).then(refresh) }}/>)}
          </ul>
        )
        : <p className="row empty">{intl.formatMessage({ id: 'No sources added yet.', defaultMessage: 'No sources added yet.' })}</p>}
      <div className="add">
        <div className="browse">
          <button type="button" onClick={() => { void addPlugins().finally(refresh) }}>{intl.formatMessage({ id: 'Browse sources', defaultMessage: 'Browse sources' })}</button>
        </div>
        <form className="by-address" onSubmit={onAdd}>
          <label for={`${id}-address`}>{intl.formatMessage({ id: 'Or add one by its address', defaultMessage: 'Or add one by its address' })}</label>
          <div className={`group${addError ? ' invalid' : ''}`}>
            <input
              id={`${id}-address`}
              type="text"
              autoComplete="off"
              spellcheck={false}
              placeholder={ADDRESS_EXAMPLE}
              aria-invalid={addError ? true : undefined}
              aria-describedby={`${id}-error`}
              value={uri}
              onInput={event => setUri((event.target as HTMLInputElement).value)}
            />
            <button type="submit" disabled={adding}>
              {adding ? intl.formatMessage({ id: 'Adding...', defaultMessage: 'Adding...' }) : intl.formatMessage({ id: 'Add', defaultMessage: 'Add' })}
            </button>
          </div>
          {/* always mounted, empty until there is an error: an alert inserted with its text is not announced by every screen reader */}
          <p className="note error" id={`${id}-error`} role="alert">{addError}</p>
        </form>
      </div>
    </div>
  )
}
