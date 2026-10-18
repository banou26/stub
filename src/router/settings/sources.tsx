import { useEffect, useId, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import { switchStyle } from '../../components/switch-style'
import { addPlugins, disablePlugin, installPlugin, onPluginsChange, pluginStatuses, type PluginStatus } from '../../plugins'
import { builtInSources, iconSources } from '../../sources/built-in'
import { setIconShown, useHiddenIcons } from '../../sources/hidden-icons'
import { readDisabledSources, setSourceEnabled, turnSourcesOn, watchDisabledSources } from '../../sources/disabled-sources'
import { siteAsks } from '../../site'

const style = css`
  h3.part {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.5);
    margin: 0 0 0.6rem;
  }

  h3.part ~ h3.part, .part-head ~ h3.part { margin-top: 3.2rem; }

  .part-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.2rem;
    margin-bottom: 0.6rem;
  }

  .part-head h3.part { margin: 0; }
  .part-head .count { font-size: 1.3rem; color: rgba(255, 255, 255, 0.5); }
  .part-head .link-button { margin-left: auto; }

  .built-in {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(21rem, 1fr));
    gap: 0.8rem;
  }

  .built-in label {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1rem 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .built-in label:hover { border-color: rgba(255, 255, 255, 0.25); }
  .built-in .source { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; margin-right: auto; }
  .built-in .source-name { font-size: 1.5rem; font-weight: 600; color: #fff; overflow-wrap: anywhere; transition: color 0.15s; }
  .built-in .host { font-size: 1.2rem; color: rgba(255, 255, 255, 0.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .built-in label.off .source-name { color: rgba(255, 255, 255, 0.5); }

  @media (prefers-reduced-motion: reduce) {
    .built-in .source-name { transition: none; }
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

const sources = builtInSources.filter(source => siteAsks(source.origin))

/** The sources stub ships with that this site asks, each with a switch: all on until the viewer turns one off. */
const BuiltInSources = () => {
  const [disabled, setDisabled] = useState(() => new Set(readDisabledSources()))
  useEffect(() => watchDisabledSources(() => setDisabled(new Set(readDisabledSources()))), [])
  const off = sources.filter(source => disabled.has(source.origin)).length

  // Turn all on stays mounted when nothing is off, so no line comes or goes under the pointer and focus stays put
  return (
    <>
      <div className="part-head">
        <h3 className="part">Built in</h3>
        <span className="count">{off ? `${sources.length - off} of ${sources.length} on` : `All ${sources.length} on`}</span>
        <button type="button" className="link-button" aria-disabled={off ? undefined : true} onClick={() => { if (off) turnSourcesOn(sources.map(source => source.origin)) }}>Turn all on</button>
      </div>
      <ul className="built-in">
        {sources.map(source => {
          const on = !disabled.has(source.origin)
          return (
            <li key={source.origin} data-source={source.origin}>
              <label className={on ? undefined : 'off'}>
                <span className="source">
                  <span className="source-name">{source.name}</span>
                  <span className="host">{siteOf(source.url)}</span>
                </span>
                <input type="checkbox" role="switch" css={switchStyle} aria-label={source.name} checked={on} onChange={event => setSourceEnabled(source.origin, (event.target as HTMLInputElement).checked)}/>
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// every drawn icon on every site, not only the sources this site asks: Simkl and Watchmode mint `mal`, `anilist` and `cr` handles everywhere
const Icons = () => {
  const hidden = useHiddenIcons()
  return (
    <>
      <h3 className="part">Icons</h3>
      <ul className="built-in">
        {iconSources.map(source => {
          const shown = !hidden.has(source.origin)
          return (
            <li key={source.origin} data-icon={source.origin}>
              <label className={shown ? undefined : 'off'}>
                <span className="source"><span className="source-name">{source.name}</span></span>
                <input type="checkbox" role="switch" css={switchStyle} aria-label={`${source.name} icon`} checked={shown} onChange={event => setIconShown(source.origin, (event.target as HTMLInputElement).checked)}/>
              </label>
            </li>
          )
        })}
      </ul>
    </>
  )
}

/** The sources stub ships with, the sources the viewer added from npm, and the two ways to add more. */
export const SourcesSection = () => {
  const [plugins, setPlugins] = useState<PluginStatus[]>(pluginStatuses)
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

  return (
    <div css={style}>
      <BuiltInSources/>
      <Icons/>
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
