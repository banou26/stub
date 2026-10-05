import { useEffect, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import { builtInSources } from '../../sources/built-in'
import { keyConfigs } from '../../sources/key-configs'
import { loadKeys, saveKeys } from '../../utils/keys'
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
  .built-in .key { font-size: 1.2rem; color: rgba(255, 255, 255, 0.5); }
  .built-in .key.saved { color: #4ade80; }

  .keys { display: flex; flex-direction: column; gap: 1.6rem; }
  .key-field { display: flex; flex-direction: column; gap: 0.5rem; }
  .key-field label { font-size: 1.4rem; font-weight: 600; }

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
  .help { font-size: 1.25rem; line-height: 1.5; color: rgba(255, 255, 255, 0.55); }
  .help a { color: inherit; text-decoration: underline; }
  .saved-note { color: #4ade80; font-size: 1.4rem; }

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

const keyedOrigins = new Set(keyConfigs.map(config => config.origin))

/**
 * The built-in sources, read only, the keys the keyed ones take, and the sources added from npm.
 * `keysCleared` changes when the keys were cleared elsewhere on the page, so the fields read them again.
 */
export const SourcesSection = ({ keysCleared, onChange }: { keysCleared: number, onChange: () => void }) => {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [savedKeys, setSavedKeys] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)
  const [plugins, setPlugins] = useState<PluginStatus[]>(pluginStatuses)
  const [uri, setUri] = useState('')
  const [addError, setAddError] = useState('')

  useEffect(() => {
    const stored = loadKeys()
    setKeys(stored)
    setSavedKeys(stored)
  }, [keysCleared])
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

  const onSubmit = (event: Event) => {
    event.preventDefault()
    saveKeys(keys)
    setSavedKeys(loadKeys())
    setSaved(true)
    onChange()
    setTimeout(() => setSaved(false), 2_000)
  }

  return (
    <div css={style}>
      <h3 className="subheading">Built in</h3>
      <p className="intro">
        stub ships with these {builtInSources.length} sources, always on. The ones that need your own key do
        nothing until you add it below.
      </p>
      <ul className="built-in">
        {builtInSources.map(source => (
          <li key={source.origin} data-source={source.origin}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a>
            {keyedOrigins.has(source.origin)
              ? <span className={`key${savedKeys[source.origin] ? ' saved' : ''}`}>{savedKeys[source.origin] ? 'Key saved' : 'Needs your key'}</span>
              : undefined}
          </li>
        ))}
      </ul>

      <h3 className="subheading">Your keys</h3>
      <p className="intro">
        Keys are kept in this browser only and are sent only with the requests to their own source. Leave a
        field blank to keep its source off.
      </p>
      <form className="keys" onSubmit={onSubmit}>
        {keyConfigs.map(config => (
          <div className="key-field" key={config.origin}>
            <label htmlFor={config.origin}>{config.label}</label>
            <input
              id={config.origin}
              type="password"
              autoComplete="off"
              spellcheck={false}
              placeholder={`Paste your ${config.name} key`}
              value={keys[config.origin] ?? ''}
              onInput={event => setKeys({ ...keys, [config.origin]: (event.target as HTMLInputElement).value })}
            />
            <span className="help">
              {config.help ? `${config.help} ` : ''}
              <a href={config.getUrl} target="_blank" rel="noreferrer">Get a key →</a>
            </span>
          </div>
        ))}
        <div className="actions">
          <button type="submit">Save</button>
          {saved && <span className="saved-note">Saved</span>}
        </div>
      </form>

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
