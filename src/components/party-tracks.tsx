import type { IntlShape, MessageDescriptor } from 'react-intl'
import type { TrackKind } from '../embed-tracks'
import type { MyTrack } from '../party/tracks'

import { css } from '@emotion/react'
import { defineMessages, useIntl } from 'react-intl'

import { party } from '../party'
import { TRACK_KINDS } from '../embed-tracks'
import { TRACK_CONTROL } from '../party/protocol'
import { useParty } from '../party/use-party'

const style = css`
  margin-top: 1rem;

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.4rem;
  }

  select {
    max-width: 16rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 0.5rem;
    background: #1a1a1a;
    color: rgba(255, 255, 255, 0.85);
    font-family: inherit;
    font-size: 1.2rem;
  }
`

const PARTY_TRACK: Readonly<Record<TrackKind, MessageDescriptor>> = defineMessages({
  subtitles: { id: 'Party subtitles', defaultMessage: 'Party subtitles' },
  audio: { id: 'Party audio', defaultMessage: 'Party audio' },
})
const MY_TRACK: Readonly<Record<TrackKind, MessageDescriptor>> = defineMessages({
  subtitles: { id: 'My subtitles', defaultMessage: 'My subtitles' },
  audio: { id: 'My audio', defaultMessage: 'My audio' },
})

const name = (intl: IntlShape, id: string | null | undefined) =>
  id === undefined ? intl.formatMessage({ id: 'Not set#a party track', defaultMessage: 'Not set', description: 'a party track' })
  : id === null ? intl.formatMessage({ id: 'Off#a track turned off', defaultMessage: 'Off', description: 'a track turned off' })
  : id
// a select carries strings, and a choice is a track id, null for off, or 'party'
const value = (id: MyTrack) => JSON.stringify(id)
const withCurrent = (ids: (string | null)[], current: string | null | undefined) =>
  current === undefined || ids.includes(current) ? ids : [current, ...ids]

/** The party's subtitles and audio, and this member's own, for a player that serves them. */
const PartyTracks = () => {
  const intl = useIntl()
  useParty()
  const tracks = party.playerTracks()
  if (!tracks) return null
  return (
    <div css={style}>
      {TRACK_KINDS.map(kind => {
        const list = tracks[kind]
        if (!list) return null
        const offered = kind === 'subtitles' ? [...list.ids, null] : list.ids
        const chosen = party.partyTrack(kind)
        const mine = party.mine(kind)
        return (
          <div key={kind}>
            {party.may(TRACK_CONTROL[kind])
              ? (
                <label className="row">
                  {intl.formatMessage(PARTY_TRACK[kind])}
                  <select value={chosen === undefined ? '' : value(chosen)} onChange={event => party.setPartyTrack(kind, JSON.parse(event.currentTarget.value))}>
                    {chosen === undefined && <option value="" disabled>{name(intl, chosen)}</option>}
                    {withCurrent(offered, chosen).map(id => <option key={value(id)} value={value(id)}>{name(intl, id)}</option>)}
                  </select>
                </label>
              )
              : <div className="row">{intl.formatMessage(PARTY_TRACK[kind])}<span>{name(intl, chosen)}</span></div>}
            <label className="row">
              {intl.formatMessage(MY_TRACK[kind])}
              <select value={value(mine)} onChange={event => party.setMine(kind, JSON.parse(event.currentTarget.value))}>
                <option value={value('party')}>
                  {
                    chosen === undefined
                      ? intl.formatMessage({ id: 'Party#follows the party\'s track', defaultMessage: 'Party', description: 'follows the party\'s track' })
                      : intl.formatMessage({ id: 'Party ({track})#follows the party\'s track', defaultMessage: 'Party ({track})', description: 'follows the party\'s track' }, { track: name(intl, chosen) })
                  }
                </option>
                {withCurrent(offered, mine === 'party' ? undefined : mine).map(id => <option key={value(id)} value={value(id)}>{name(intl, id)}</option>)}
              </select>
            </label>
          </div>
        )
      })}
    </div>
  )
}

export default PartyTracks
