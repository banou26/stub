import { css } from '@emotion/react'
import { Check, Share2 } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { readPluginUris, writePluginUris } from '../utils/plugin-links'
import { SHORT_PATH, shortenPath } from '../utils/share-link'

const style = css`
  display: flex;
  flex: none;
  align-self: center;
  align-items: center;
  justify-content: center;
  width: 4rem;
  height: 4rem;
  padding: 0;
  border-radius: 0.6rem;
  border: 0.1rem solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
  }
`

/**
 * The link Share hands out for `path` on this site: the address with the sources the page's own address names, as
 * `/s/<code>` when that is shorter.
 */
export const shareLink = (path: string, href = location.href): string => {
  const { origin } = new URL(href)
  const address = writePluginUris(path, readPluginUris(href), href).slice(origin.length)
  const code = shortenPath(address)
  return `${origin}${code && SHORT_PATH.length + code.length < address.length ? `${SHORT_PATH}${code}` : address}`
}

/** Shares `path` through the system's share sheet where there is one, else copies its link and says Copied. */
const ShareButton = ({ path, title, className }: { path: string, title?: string, className?: string }) => {
  const intl = useIntl()
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = shareLink(path)
    if (navigator.share) return navigator.share({ title, url }).catch(() => {})
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {}
  }
  const label = copied ? intl.formatMessage({ id: 'Copied', defaultMessage: 'Copied' }) : intl.formatMessage({ id: 'Share', defaultMessage: 'Share' })
  return (
    <button type="button" css={style} className={className} onClick={share} aria-label={label} title={label}>
      {copied ? <Check size={20}/> : <Share2 size={20}/>}
    </button>
  )
}

export default ShareButton
