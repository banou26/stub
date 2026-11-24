import type { SubtitleQueryContext } from '../plugin-api'
import type { NormalizedPluginSubtitle } from '../worker/plugin-sources'

import { css } from '@emotion/react'
import { packages } from '@fkn/lib'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { layer } from '../layers'
import { selectRemoteSubtitle } from '../worker'

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

  .bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    color: rgba(255, 255, 255, 0.75);
    font-size: 1.3rem;
  }

  .bar .spacer { margin-inline-start: auto; }

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

export type SubtitlePluginPopupProps = {
  pluginUri: string
  origin: string
  name: string
  context: SubtitleQueryContext
  onPick: (tracks: NormalizedPluginSubtitle[]) => void
  onClose: () => void
}

/**
 * Hosts a plugin's own subtitle picker using `packages.show` and awaits `selectRemoteSubtitle`.
 */
export const SubtitlePluginPopup = ({ pluginUri, origin, name, context, onPick, onClose }: SubtitlePluginPopupProps) => {
  const intl = useIntl()
  const slot = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const latest = useRef({ context, onPick, onClose })
  latest.current = { context, onPick, onClose }

  useEffect(() => {
    const element = slot.current
    if (!element) return
    let done = false
    let view: { hide: () => void } | undefined

    const run = async () => {
      try {
        view = await packages.show(pluginUri, { element })
      } catch (error) {
        console.warn(`Source '${pluginUri}' could not open its subtitle picker:`, error)
        setFailed(true)
        return
      }
      let picked: NormalizedPluginSubtitle[] = []
      try {
        picked = await selectRemoteSubtitle(origin, latest.current.context)
      } catch (error) {
        console.warn(`Source '${pluginUri}' subtitle picker failed:`, error)
      }
      if (done) return
      if (picked.length > 0) latest.current.onPick(picked)
      else latest.current.onClose()
    }
    void run()

    return () => {
      done = true
      view?.hide()
      packages.hide(pluginUri, { element }).catch(() => {})
    }
  }, [pluginUri, origin, context.episodeUri])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div css={style} role="dialog" aria-modal="true" aria-label={intl.formatMessage({ id: 'Choose subtitles from {name}', defaultMessage: 'Choose subtitles from {name}' }, { name })} onClick={onClose}>
      <div className="wrap" onClick={event => event.stopPropagation()}>
        <div className="bar">
          <span>{name}</span>
          <span className="spacer" />
          <button type="button" className="close" onClick={onClose}>{intl.formatMessage({ id: 'Close', defaultMessage: 'Close' })}</button>
        </div>
        {failed
          ? <div className="fallback">{intl.formatMessage({ id: 'This source could not open its picker.', defaultMessage: 'This source could not open its picker.' })}</div>
          : <div className="slot" ref={slot} />}
      </div>
    </div>
  )
}

export default SubtitlePluginPopup
