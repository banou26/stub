import { useEffect, useId, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import { addPlugins, disablePlugin, enablePlugin, onPluginsChange, pluginStatuses, type PluginStatus } from '../../plugins'

const style = css`
  .plugins {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-bottom: 1.6rem;
  }

  .row.plugin {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.2rem;
  }

  .plugin .info {
    flex: 1 1 20rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .plugin .name { font-size: 1.5rem; font-weight: 700; color: #fff; overflow-wrap: anywhere; }
  .plugin .meta { font-size: 1.25rem; color: rgba(255, 255, 255, 0.5); overflow-wrap: anywhere; }
  .plugin .uri { font-family: monospace; }

  .pill {
    margin-left: auto;
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
    flex-basis: 100%;
    color: #f87171;
    font-size: 1.3rem;
  }

  .empty {
    margin-bottom: 1.6rem;
    padding: 2rem 1.6rem;
    border: 1px dashed rgba(255, 255, 255, 0.2);
    border-radius: 0.8rem;
    text-align: center;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .add {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    padding: 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.02);
  }

  .browse {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem 1.2rem;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.6);
  }

  .by-address { display: flex; flex-direction: column; gap: 0.6rem; }
  .by-address label { font-size: 1.4rem; font-weight: 600; color: #fff; }

  .group {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.04);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .group:focus-within { border-color: rgba(255, 255, 255, 0.7); box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15); }
  .group.invalid { border-color: #f87171; }
  .group.invalid:focus-within { box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.25); }

  /* the input takes the row and the button only its width; once wrapped, alone on its row, the button takes all of it */
  .group input {
    flex: 1000 1 18rem;
    min-width: 0;
    padding: 1rem 1.2rem;
    border: none;
    background: none;
    color: inherit;
    font-family: monospace;
    font-size: 1.4rem;
    outline: none;
  }

  .group button { flex: 1 0 auto; border-radius: 0; }
  .group button:focus-visible { outline: 2px solid #0f0f0f; outline-offset: -4px; }

  .hint { font-size: 1.25rem; color: rgba(255, 255, 255, 0.5); }
  .by-address .note { font-size: 1.35rem; overflow-wrap: anywhere; }
`

const STATE_LABEL: Record<PluginStatus['state'], string> = { connected: 'Connected', connecting: 'Connecting', error: 'Error' }

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)

const PluginRow = ({ plugin, onRemove }: { plugin: PluginStatus, onRemove: () => void }) => {
  const sources = plugin.sources ?? []
  const name = sources.length ? sources.map(source => source.name).join(', ') : plugin.uri.replace(/^npm:/, '')
  return (
    <li className="row plugin" data-plugin={plugin.uri}>
      <div className="info">
        <span className="name">{name}</span>
        <span className="meta">
          <span className="uri">{plugin.uri}</span>
          {/* a package may register a family of sources, and some of them and not others */}
          {sources.length > 1 ? ` · ${sources.length} sources` : ''}
          {plugin.rejected?.length ? ` · ${plugin.rejected.length} unavailable` : ''}
        </span>
      </div>
      <span className="pill" data-state={plugin.state}><span className="dot" aria-hidden="true"/>{STATE_LABEL[plugin.state]}</span>
      <button type="button" className="secondary small" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
      {plugin.state === 'error' ? <p className="failure">{plugin.error ?? 'stub could not connect to it.'}</p> : undefined}
    </li>
  )
}

/** The sources the viewer added from npm, and the two ways to add more. */
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
    enablePlugin(trimmed)
      // null is the viewer declining FKN's confirm, which keeps the address to try again
      .then(installed => { if (installed) setUri('') })
      .catch(error => setAddError(messageOf(error)))
      .finally(() => {
        setAdding(false)
        refresh()
      })
  }

  return (
    <div css={style}>
      <p className="intro">Community-made sources, published on npm. FKN installs them for stub, and each one runs isolated from stub.</p>
      {plugins.length
        ? (
          <ul className="plugins">
            {plugins.map(plugin => <PluginRow key={plugin.uri} plugin={plugin} onRemove={() => { void disablePlugin(plugin.uri).then(refresh) }}/>)}
          </ul>
        )
        : <p className="empty">No sources added yet.</p>}
      <div className="add">
        <div className="browse">
          <button type="button" onClick={() => { void addPlugins().finally(refresh) }}>Browse sources</button>
          <span>Pick from the sources published for stub.</span>
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
              aria-describedby={`${id}-error ${id}-hint`}
              value={uri}
              onInput={event => setUri((event.target as HTMLInputElement).value)}
            />
            <button type="submit" disabled={adding}>{adding ? 'Adding...' : 'Add'}</button>
          </div>
          {/* always mounted, empty until there is an error: an alert inserted with its text is not announced by every screen reader */}
          <p className="note error" id={`${id}-error`} role="alert">{addError}</p>
          <p className="hint" id={`${id}-hint`}>An npm package, or a local dev address such as localhost:4599.</p>
        </form>
      </div>
    </div>
  )
}
