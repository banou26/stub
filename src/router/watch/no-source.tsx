import type { AccountsProps } from '../settings/accounts'

import { css } from '@emotion/react'
import { useRef } from 'preact/hooks'
import { useIntl } from 'react-intl'

import OriginIcon from '../../components/origin-icon'
import { addPlugins } from '../../plugins'
import { builtInSources } from '../../sources/built-in'
import { SourceAccount } from '../settings/accounts'

const style = css`
  align-items: center;
  justify-content: center;
  gap: 1.6rem;
  padding: 2.4rem 1.6rem;
  box-sizing: border-box;
  background: #000;

  h2 {
    font-size: 1.8rem;
    font-weight: 600;
    text-align: center;
    outline: none;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: min(100%, 40rem);
  }

  li {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1rem 1.2rem;
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.06);
  }

  .icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;

    img { width: 2rem; height: 2rem; object-fit: contain; }
    .letter { font-size: 1.4rem; font-weight: 700; }
  }

  .name {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .account {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0 1.2rem;
    min-width: 0;
  }

  .state {
    font-size: 1.3rem;
    color: rgba(255, 255, 255, 0.55);
  }

  .note {
    flex-basis: 100%;
    font-size: 1.3rem;
    text-align: right;

    &:not(:empty) { margin-top: 0.6rem; }
    &.error { color: #f87171; }
  }

  button {
    padding: 0.8rem 2rem;
    border: none;
    border-radius: 0.6rem;
    background: #fff;
    color: #000;
    font-family: inherit;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;

    &:disabled { opacity: 0.6; cursor: default; }
  }

  .account button { padding: 0.5rem 1.2rem; font-size: 1.3rem; }
`

/**
 * In the player's place when nothing on the episode plays for the viewer now: the sign-in of each source
 * in `signIns` as its card in Settings holds it, then FKN's package browser, to add a source.
 */
const NoSource = ({ signIns, accounts }: { signIns: readonly string[], accounts: AccountsProps }) => {
  const intl = useIntl()
  const heading = useRef<HTMLHeadingElement>(null)
  return (
    <div className="player-container no-source" css={style}>
      <h2 ref={heading} tabIndex={-1}>{intl.formatMessage({ id: 'No source you can play here yet', defaultMessage: 'No source you can play here yet' })}</h2>
      {signIns.length
        ? (
          <ul>
            {signIns.map(origin => {
              const source = builtInSources.find(each => each.origin === origin)
              const name = source?.name ?? origin
              return (
                <li key={origin} data-source={origin}>
                  <span className="icon">
                    {source?.icon ? <OriginIcon icon={source.icon} name={name}/> : <span className="letter" aria-hidden="true">{name.charAt(0)}</span>}
                  </span>
                  <span className="name">{name}</span>
                  <SourceAccount origin={origin} heading={heading} {...accounts}/>
                </li>
              )
            })}
          </ul>
        )
        : undefined}
      <button type="button" onClick={() => { void addPlugins() }}>{intl.formatMessage({ id: 'Browse sources', defaultMessage: 'Browse sources' })}</button>
    </div>
  )
}

export default NoSource
