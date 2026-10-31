import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { layer } from '../layers'
import { addedInvites, closeInvites, onInvitesChange, removeInvite, type AddedInvite } from '../plugin-invites'
import { pluginName, usePluginStatuses } from '../utils/use-plugin-statuses'

// under the bar, clear of FKN's own notice and the party chat, which both take the bottom right corner
const style = css`
  position: fixed;
  top: calc(var(--stub-header-height) + 1.6rem);
  right: 1.6rem;
  z-index: ${layer.pluginNotice};
  width: min(36rem, calc(100vw - 3.2rem));

  .notice {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.4rem 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.8rem;
    background: #171717;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font-size: 1.4rem;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
  }

  li span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .failed {
    color: #f87171;
  }

  button {
    flex: none;
    padding: 0.6rem 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.4rem;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .ok {
    align-self: flex-end;
    border-color: #fff;
    background: #fff;
    color: #000;
    font-weight: 600;
  }
`

/** The sources a link just added, each with Remove while it is on the list, until the viewer answers. */
const PluginNotice = () => {
  const intl = useIntl()
  const statuses = usePluginStatuses()
  const [invites, setInvites] = useState<AddedInvite[]>(addedInvites)

  // read on subscribe as well as on notify: the url is read at import time, before this mounts
  useEffect(() => {
    setInvites(addedInvites())
    return onInvitesChange(() => setInvites(addedInvites()))
  }, [])

  // the live region is always there, or a screen reader has nothing to hear the notice arrive in
  return (
    <div css={style} role="status">
      {invites.length > 0 && (
        <div className="notice">
          <ul>
            {invites.map(({ uri, failed }) => {
              const status = statuses.find(plugin => plugin.uri === uri)
              const name = pluginName(intl, status ?? { uri })
              return (
                <li key={uri}>
                  {failed
                    ? <span className="failed">{intl.formatMessage({ id: 'Could not add {name}', defaultMessage: 'Could not add {name}' }, { name })}</span>
                    : <span>{intl.formatMessage({ id: 'Source enabled: {name}', defaultMessage: 'Source enabled: {name}' }, { name })}</span>}
                  {status && (
                    <button type="button" aria-label={intl.formatMessage({ id: 'Remove {name}', defaultMessage: 'Remove {name}' }, { name })} onClick={() => removeInvite(uri)}>
                      {intl.formatMessage({ id: 'Remove', defaultMessage: 'Remove' })}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <button type="button" className="ok" onClick={closeInvites}>{intl.formatMessage({ id: 'OK', defaultMessage: 'OK' })}</button>
        </div>
      )}
    </div>
  )
}

export default PluginNotice
