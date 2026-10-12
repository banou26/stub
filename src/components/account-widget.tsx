import { css } from '@emotion/react'
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift,
  useClick, useDismiss, useFloating, useInteractions, useRole
} from '@floating-ui/react'
import { ConnectButton } from '@fkn/lib/react'
import { ChevronDown, ExternalLink, LogOut } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'

import { useAccount } from '../utils/use-account'
import { layer } from '../layers'

const MANAGE_URL = 'https://fkn.app/account'

// the library hardcodes its iframe at 150x40; the placeholder and the mobile override both key off it
const CONNECT_WIDTH = 150
const CONNECT_HEIGHT = 40

const style = css`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.4rem 0.6rem 0.4rem 1.2rem;
  height: 4rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2rem;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;

  &:hover, &[aria-expanded='true'] {
    color: rgba(255, 255, 255, 0.9);
    border-color: rgba(255, 255, 255, 0.35);
  }

  .who {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
    line-height: 1.15;
    min-width: 0;
  }

  .name {
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.4rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  .tier {
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tier.premium { color: #7dd3a0; }
  .tier.free { color: rgba(255, 255, 255, 0.45); }

  .chevron { flex-shrink: 0; }
`

/* Portalled to the body rather than left inside the header, so the bar's own stacking context cannot
   cap it. The cost is that it then competes at the root and needs a layer of its own. */
export const menuStyle = css`
  z-index: ${layer.headerPopup};
  display: flex;
  flex-direction: column;
  min-width: 18rem;
  padding: 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.8rem;
  background: rgba(25, 25, 25, 0.97);
  backdrop-filter: blur(8px);
  box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.5);

  .item {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.9rem 1.1rem;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-family: inherit;
    font-size: 1.4rem;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }

    svg { flex-shrink: 0; }
  }
`

// reserves the connect button's box so the centred search field does not shift sideways when the
// broker finally answers
const placeholderStyle = css`
  width: ${CONNECT_WIDTH}px;
  height: ${CONNECT_HEIGHT}px;
`

export const AccountWidget = () => {
  const { info, ready, logout } = useAccount()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: 'menu' })
  ])

  /**
   * The menu belongs to a signed-in account and cannot outlive one.
   *
   * Without this, the early return below unmounts the menu VISUALLY while leaving `open` and `busy`
   * set, so the state outlives the thing it describes: reconnecting brings the menu straight back
   * unasked, and an account that disappears mid-disconnect leaves the row stuck reading
   * "Disconnecting...". It covers every path the click handler never sees, which is the 30 second
   * poll, a logout in another tab, and the read cap in useAccount resolving null for a broker that
   * is merely slow.
   */
  useEffect(() => {
    if (info) return
    setOpen(false)
    setBusy(false)
  }, [info])

  const onDisconnect = async () => {
    setBusy(true)
    try {
      // bounded inside useAccount, so this can no longer wait forever on a broker that never answers
      await logout()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  if (!ready) return <div css={placeholderStyle}/>

  if (!info) return <ConnectButton style={{ flex: 'none', width: CONNECT_WIDTH, height: CONNECT_HEIGHT }}/>

  return (
    <>
      <button
        ref={refs.setReference}
        css={style}
        type="button"
        aria-label={`FKN account: ${info.name || 'Account'}`}
        {...getReferenceProps()}
      >
        <span className="who">
          <span className="name">{info.name || 'Account'}</span>
          <span className={`tier ${info.premium ? 'premium' : 'free'}`}>{info.premium ? 'Premium' : 'Free'}</span>
        </span>
        <ChevronDown size={16} className="chevron"/>
      </button>
      {open
        ? (
          <FloatingPortal>
            <FloatingFocusManager context={context} modal={false}>
              <div ref={refs.setFloating} style={floatingStyles} css={menuStyle} {...getFloatingProps()}>
                <a className="item" href={MANAGE_URL} target="_blank" rel="noreferrer">
                  <ExternalLink size={16}/>
                  Manage account
                </a>
                <button className="item" type="button" disabled={busy} onClick={onDisconnect}>
                  <LogOut size={16}/>
                  {busy ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </FloatingFocusManager>
          </FloatingPortal>
        )
        : undefined}
    </>
  )
}

export default AccountWidget
