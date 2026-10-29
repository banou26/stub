import { useState } from 'preact/hooks'

/**
 * A source's icon, or its initial once the icon fails to load. Measured 2026-10-11 from Japan in Chrome:
 * Max's favicon redirects to hbomax.com's, which Chrome refuses to draw, and Peacock's redirects a viewer
 * outside the US to an HTML "unavailable" page, so a bare <img> drew a broken image beside every title
 * either one carries.
 */
const OriginIcon = ({ icon, name }: { icon?: string | null, name: string }) => {
  const [failed, setFailed] = useState(false)
  return failed || !icon
    ? <span className="letter" aria-hidden="true">{name.charAt(0)}</span>
    : <img src={icon} alt="" onError={() => setFailed(true)}/>
}

export default OriginIcon
