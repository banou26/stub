import type { PublishingState } from '../../social/protocol'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { social, SOCIAL_SITE } from '../../social'
import { POSTED_KINDS } from '../../social/activity'
import { Switch, switchesStyle } from './playback'

const style = css`
  .line { align-self: flex-start; padding: 0 1.6rem; font-size: 1.4rem; }
`

/**
 * Whether stub posts what the viewer tracks to their FKN Social page, read from FKN Social when shown and when the
 * page comes back into view. Only a press turns it on, which installs FKN Social and asks the viewer there.
 */
export const TrackingSection = () => {
  const intl = useIntl()
  const [current, setCurrent] = useState<PublishingState>()
  const [pressed, setPressed] = useState<boolean>()

  useEffect(() => {
    let live = true
    const read = () => {
      if (document.visibilityState !== 'hidden') void social.publishing().then(state => { if (live) setCurrent(state) })
    }
    read()
    document.addEventListener('visibilitychange', read)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', read)
    }
  }, [])

  const press = (on: boolean) => {
    setPressed(on)
    void (on ? social.allowPublishing({ kinds: POSTED_KINDS }) : social.stopPublishing()).then(state => {
      setCurrent(state)
      setPressed(undefined)
    })
  }

  const state = current?.state
  const ask = state === 'asked' ? intl.formatMessage({ id: 'Allow it on FKN Social.', defaultMessage: 'Allow it on FKN Social.' })
    : state === 'no-name' ? intl.formatMessage({ id: 'Pick a name on FKN Social first.', defaultMessage: 'Pick a name on FKN Social first.' })
    : undefined
  const refusal = state === 'locked' ? intl.formatMessage({ id: "The FKN account's storage is locked on this device", defaultMessage: "The FKN account's storage is locked on this device" })
    : state && !ask && state !== 'allowed' && state !== 'off' ? intl.formatMessage({ id: 'FKN Social is not available right now. Try again later.', defaultMessage: 'FKN Social is not available right now. Try again later.' })
    : undefined

  return (
    <div css={[switchesStyle, style]} data-setting="social">
      <Switch on={pressed ?? (state === 'allowed' || state === 'asked')} set={press} disabled={pressed !== undefined}>
        {intl.formatMessage({ id: 'Post to FKN Social', defaultMessage: 'Post to FKN Social' })}
      </Switch>
      {ask ? <a className="line link" href={SOCIAL_SITE} target="_blank" rel="noreferrer">{ask}</a> : undefined}
      {refusal ? <p className="line note error">{refusal}</p> : undefined}
    </div>
  )
}
