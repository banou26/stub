import { useState } from 'preact/hooks'

/**
 * A source's icon, or its initial once the icon fails to load. Peacock's favicon answers a viewer
 * outside the US with a redirect to an HTML "unavailable" page (measured 2026-10-11), which a bare
 * <img> drew as a broken image beside every title Peacock carries.
 */
const OriginIcon = ({ icon, name }: { icon: string, name: string }) => {
  const [failed, setFailed] = useState(false)
  return failed
    ? <span className="letter" aria-hidden="true">{name.charAt(0)}</span>
    : <img src={icon} alt="" onError={() => setFailed(true)}/>
}

export default OriginIcon
