import { css } from '@emotion/react'
import { packages } from '@fkn/lib'
import { useEffect, useRef, useState } from 'preact/hooks'

import { selectRemoteRelease } from '../worker'
import { layer } from '../layers'

const style = css`
  position: fixed;
  inset: 0;
  z-index: ${layer.sourcePopup};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vh 4vw;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(3px);

  .wrap {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: 100%;
    max-width: 120rem;
    height: 100%;
    max-height: 72rem;
  }

  /* the package frame sits above every stub element (the fkn overlay pins itself to the top of the
     stacking order), so the close button lives OUTSIDE the slot rather than over it */
  .bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    color: rgba(255, 255, 255, 0.75);
    font-size: 1.3rem;
  }

  .bar .spacer { margin-left: auto; }

  .close {
    padding: 0.4rem 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.4);
    color: #fff;
    font: inherit;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .close:hover { background: rgba(255, 255, 255, 0.14); }

  /* The slot IS the panel, not a child of one. fkn reads the placeholder's own computed
     border-radius and clips the package frame to it, so a radius on a wrapper would leave the frame
     painting square corners over a rounded box. */
  .slot,
  .fallback {
    flex: 1;
    min-height: 0;
    border-radius: 0.8rem;
    background: #101010;
    border: 1px solid rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.55);
    font-size: 1.4rem;
  }
`

export type SourcePopupProps = {
  pluginUri: string
  origin: string
  name: string
  uris: string[]
  onPick: (uri: string) => void
  onClose: () => void
}

/**
 * Hosts a plugin's own release picker.
 *
 * stub owns the modal and the slot; the package renders inside its own frame, which fkn keeps aligned
 * to `.slot`. The pick comes back as the resolution of the plugin call rather than over a separate
 * channel, so there is one thing to await and one place the interaction can end.
 */
export const SourcePopup = ({ pluginUri, origin, name, uris, onPick, onClose }: SourcePopupProps) => {
  const slot = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = slot.current
    if (!element) return
    let done = false
    let view: { hide: () => void } | undefined

    const run = async () => {
      try {
        view = await packages.show(pluginUri, { element })
      } catch (error) {
        // the frame never appeared, so nothing will answer: say so rather than leave a blank modal
        console.warn(`Source '${pluginUri}' could not open its picker:`, error)
        setFailed(true)
        return
      }
      const picked = await selectRemoteRelease(origin, uris)
      if (done) return
      if (picked) onPick(picked)
      else onClose()
    }
    void run()


    return () => {
      done = true
      view?.hide()
      // show() may still be in flight here, and that one would leave the frame up with nothing to hide it
      packages.hide(pluginUri, { element }).catch(() => {})
    }
    // `uris` is rebuilt on every render, so keying the effect on the array itself would tear the frame
    // down and show it again in a loop
  }, [pluginUri, origin, uris.join(',')])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div css={style} role="dialog" aria-modal="true" aria-label={`Choose a source from ${name}`} onClick={onClose}>
      <div className="wrap" onClick={event => event.stopPropagation()}>
        <div className="bar">
          <span>{name}</span>
          <span className="spacer"/>
          <button type="button" className="close" onClick={onClose}>Close</button>
        </div>
        {failed
          ? <div className="fallback">This source could not open its picker.</div>
          : <div className="slot" ref={slot}/>}
      </div>
    </div>
  )
}

export default SourcePopup
