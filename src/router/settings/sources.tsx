import { useEffect, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import { builtInSources } from '../../sources/built-in'
import { addPlugins, disablePlugin, enablePlugin, onPluginsChange, pluginStatuses, type PluginStatus } from '../../plugins'

const style = css`
  .built-in {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 0.6rem;
  }

  .built-in li {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.8rem 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.6rem;
    font-size: 1.4rem;
    min-width: 0;
  }

  .built-in a { color: #fff; overflow-wrap: anywhere; }

  input {
    padding: 0.7rem 1rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font-family: monospace;
    font-size: 1.4rem;
    min-width: 0;
  }

  input:focus { outline: none; border-color: rgba(255, 255, 255, 0.45); }

  .add-uri { display: flex; gap: 0.8rem; margin-top: 1.2rem; }
  .add-uri input { flex: 1; }
  .add-error { color: #f87171; font-size: 1.35rem; margin-top: 0.6rem; overflow-wrap: anywhere; }

  .row.plugin {
    flex-direction: row;
    align-items: center;
    gap: 1.2rem;
  }

  .plugin .info { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .plugin .name { font-size: 1.5rem; font-weight: 600; }
  .plugin .uri { font-size: 1.2rem; color: rgba(255, 255, 255, 0.55); font-family: monospace; overflow-wrap: anywhere; }
  .plugin .state { margin-left: auto; white-space: nowrap; }
  .plugin .state.error { color: #f87171; white-space: normal; }
  .plugins + .actions { margin-top: 1.2rem; }
`

/** The built-in sources, read only, and the sources added from npm. */
export const SourcesSection = ({ onChange }: { onChange: () => void }) => {
  const [plugins, setPlugins] = useState<PluginStatus[]>(pluginStatuses)
  const [uri, setUri] = useState('')
  const [addError, setAddError] = useState('')

  // Re-read on subscribe, not just on notify: a plugin whose frame is already warm connects before the effect subscribes, leaving a connected source stuck reading "connecting"
  useEffect(() => {
    setPlugins(pluginStatuses())
    return onPluginsChange(() => {
      setPlugins(pluginStatuses())
      onChange()
    })
  }, [onChange])

  const onAddUri = (event: Event) => {
    event.preventDefault()
    const trimmed = uri.trim()
    if (!trimmed) return
    setAddError('')
    enablePlugin(trimmed)
      .then(() => setUri(''))
      .catch(error => setAddError(error instanceof Error ? error.message : String(error)))
      .finally(() => setPlugins(pluginStatuses()))
  }

  return (
    <div css={style}>
      <h3 className="subheading">Built in</h3>
      <p className="intro">stub ships with these {builtInSources.length} sources, always on, and none of them needs a key.</p>
      <ul className="built-in">
        {builtInSources.map(source => (
          <li key={source.origin} data-source={source.origin}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
          </li>
        ))}
      </ul>

      <h3 className="subheading">Added</h3>
      <p className="intro">
        Community-made sources published on npm. They are installed through FKN, run isolated from stub, and
        only talk to it through a brokered connection.
      </p>
      {plugins.length > 0 && (
        <div className="rows plugins">
          {plugins.map(plugin => (
            <div className="row plugin" key={plugin.uri}>
              <div className="info">
                <span className="name">
                  {plugin.sources?.length
                    ? plugin.sources.map(source => source.name).join(', ')
                    : plugin.uri}
                </span>
                <span className="uri">
                  {plugin.uri}
                  {/* a package may register a family of sources, so say how many rather than showing only the first */}
                  {plugin.sources && plugin.sources.length > 1 ? ` · ${plugin.sources.length} sources` : ''}
                  {/* a package can register some of its sources and not others, so a partial success is reported */}
                  {plugin.rejected?.length ? ` · ${plugin.rejected.length} unavailable` : ''}
                </span>
              </div>
              <span className={`state${plugin.state === 'error' ? ' error' : ''}`}>
                {plugin.state === 'connected' ? 'connected' : plugin.state === 'error' ? (plugin.error ?? 'error') : 'connecting…'}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => { disablePlugin(plugin.uri).then(() => setPlugins(pluginStatuses())) }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={() => { addPlugins().finally(() => setPlugins(pluginStatuses())) }}>
          Add sources
        </button>
      </div>
      <form className="add-uri" onSubmit={onAddUri}>
        <input
          type="text"
          autoComplete="off"
          spellcheck={false}
          aria-label="Add a source by address"
          placeholder="Or add one by address, e.g. npm:@banou/example or localhost:4599"
          value={uri}
          onInput={event => setUri((event.target as HTMLInputElement).value)}
        />
        <button type="submit">Add</button>
      </form>
      {addError && <p className="add-error">{addError}</p>}
    </div>
  )
}
