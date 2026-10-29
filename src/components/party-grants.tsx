import type { MessageDescriptor } from 'react-intl'
import type { PartyMember } from '../party'
import type { Control, FollowerState, Grants } from '../party/protocol'

import { css } from '@emotion/react'
import { AudioLines, Captions, Check, CircleCheck, CircleDashed, Clapperboard, FastForward, Gauge, LoaderCircle, Play, X } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { defineMessages, useIntl } from 'react-intl'

import { party } from '../party'
import { clockText, CONTROLS } from '../party/protocol'
import { shownStatus } from '../party/status'
import { useParty, usePartyMessages } from '../party/use-party'
import { durationLocale } from '../utils/countdown'
import { memberLabel } from './party-chat'

export const CONTROL_LABEL: Readonly<Record<Control, MessageDescriptor>> = defineMessages({
  play: { id: 'Play/pause', defaultMessage: 'Play/pause' },
  seek: { id: 'Seek', defaultMessage: 'Seek' },
  go: { id: 'Episode#a party control, which changes it', defaultMessage: 'Episode', description: 'a party control, which changes it' },
  rate: { id: 'Speed', defaultMessage: 'Speed' },
  subs: { id: 'Subtitles', defaultMessage: 'Subtitles' },
  audio: { id: 'Audio', defaultMessage: 'Audio' },
})
const CONTROL_ICON: Record<Control, typeof Play> = { play: Play, seek: FastForward, go: Clapperboard, rate: Gauge, subs: Captions, audio: AudioLines }

const STATUS_LABEL: Readonly<Record<FollowerState, MessageDescriptor>> = defineMessages({
  ready: { id: 'Ready#a follower\'s player', defaultMessage: 'Ready', description: 'a follower\'s player' },
  loading: { id: 'Loading', defaultMessage: 'Loading' },
  away: { id: 'Away#a follower off the host\'s page', defaultMessage: 'Away', description: 'a follower off the host\'s page' },
})
const STATUS_ICON: Record<FollowerState, typeof Play> = { ready: CircleCheck, loading: LoaderCircle, away: CircleDashed }

const statusStyle = css`
  display: inline-flex;
  flex: none;
  &.ready { color: #4ade80; }
  &.loading { color: #fb923c; }
  &.away { color: rgba(255, 255, 255, 0.3); }
`

/** Where a follower stands, as an icon named for it. */
export const StatusIcon = ({ s }: { s: FollowerState }) => {
  const Icon = STATUS_ICON[s]
  const label = useIntl().formatMessage(STATUS_LABEL[s])
  return <span css={statusStyle} className={s} role="img" aria-label={label} title={label}><Icon size={13}/></span>
}

const style = css`
  margin-top: 1rem;
  max-height: 16rem;
  overflow-y: auto;

  table { width: 100%; border-collapse: collapse; }
  th { font-weight: 500; text-align: left; color: rgba(255, 255, 255, 0.6); }
  thead th { text-align: center; padding-bottom: 0.4rem; }
  /* the row header takes what the controls leave: a name and its time never widen the menu past them */
  tbody th { width: 100%; max-width: 0; padding: 0.2rem 0.6rem 0.2rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td { text-align: center; padding: 0.2rem 0; }
  .who { display: flex; align-items: center; gap: 0.6rem; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .time { flex: none; color: rgba(255, 255, 255, 0.4); font-variant-numeric: tabular-nums; }

  button.cell {
    display: inline-flex;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    padding: 0;
    color: rgba(255, 255, 255, 0.35);
  }
  button.cell[aria-pressed='true'] { border-color: rgba(74, 222, 128, 0.6); color: #4ade80; }
  button.cell[data-grant='all'] { border-style: dashed; opacity: 0.6; }
`

/** A follower's cell turns to the opposite of all followers, then to their value held for this member, then follows them again. */
const nextGrant = (own: boolean | undefined, inherited: boolean): boolean | undefined =>
  own === undefined ? !inherited : own !== inherited ? inherited : undefined

const withMember = (grants: Grants, id: string, control: Control, value: boolean | undefined): Grants => {
  const entry = { ...grants.by[id] }
  if (value === undefined) delete entry[control]
  else entry[control] = value
  const by = { ...grants.by, [id]: entry }
  if (!Object.keys(entry).length) delete by[id]
  return { ...grants, by }
}

/**
 * The host's grid of who may use which control: all followers, then one row per follower. On `page`,
 * the host's watch page, each follower's row also says where it stands and where its player is.
 */
const PartyGrants = ({ page }: { page?: string }) => {
  const intl = useIntl()
  const state = useParty()
  const [members, setMembers] = useState<PartyMember[]>([])
  const [, tick] = useState(0)
  const count = state.status === 'active' ? state.members : 0
  useEffect(() => {
    let cancelled = false
    void party.roster().then(list => { if (!cancelled) setMembers(list) })
    return () => { cancelled = true }
  }, [count])
  usePartyMessages(message => {
    if (message.t === 'name') void party.roster().then(setMembers)
    if (message.t === 'status') tick(n => n + 1)
  })
  // a playing follower's time moves between its reports
  useEffect(() => {
    if (!page) return
    const timer = setInterval(() => tick(n => n + 1), 1_000)
    return () => clearInterval(timer)
  }, [page])

  if (state.status !== 'active') return null
  const grants = party.issued()
  const everyone = intl.formatMessage({ id: 'All followers', defaultMessage: 'All followers' })
  const cellLabel = (control: Control, member: string) =>
    intl.formatMessage({ id: '{control}, {member}#a grant\'s cell: the control, then whose it is', defaultMessage: '{control}, {member}', description: 'a grant\'s cell: the control, then whose it is' }, { control: intl.formatMessage(CONTROL_LABEL[control]), member })

  return (
    <div css={style}>
      <table>
        <thead>
          <tr>
            <th/>
            {CONTROLS.map(control => {
              const Icon = CONTROL_ICON[control]
              const label = intl.formatMessage(CONTROL_LABEL[control])
              return <th key={control} title={label}><Icon size={14} aria-label={label}/></th>
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{everyone}</th>
            {CONTROLS.map(control => {
              const on = grants.all.includes(control)
              return (
                <td key={control}>
                  <button
                    type="button"
                    className="cell"
                    aria-label={cellLabel(control, everyone)}
                    aria-pressed={on}
                    onClick={() => party.setGrants({ ...grants, all: on ? grants.all.filter(other => other !== control) : [...grants.all, control] })}
                  >
                    {on ? <Check size={14}/> : <X size={14}/>}
                  </button>
                </td>
              )
            })}
          </tr>
          {members.filter(member => !member.host).map(member => {
            const label = memberLabel(intl, { from: member.id, name: member.name, self: member.self }, state.owner)
            const heard = page ? party.statuses().get(member.id) : undefined
            const shown = page && heard ? shownStatus(heard.status, Date.now() - heard.at, page) : undefined
            return (
              <tr key={member.id}>
                <th scope="row" title={label}>
                  <span className="who">
                    {shown && <StatusIcon s={shown.s}/>}
                    <span className="name">{label}</span>
                    {shown?.time !== undefined && <span className="time">{clockText(shown.time, durationLocale())}</span>}
                  </span>
                </th>
                {CONTROLS.map(control => {
                  const own = grants.by[member.id]?.[control]
                  const inherited = grants.all.includes(control)
                  const on = own ?? inherited
                  return (
                    <td key={control}>
                      <button
                        type="button"
                        className="cell"
                        data-grant={own === undefined ? 'all' : own ? 'on' : 'off'}
                        title={
                          own === undefined ? intl.formatMessage({ id: 'Same as all followers', defaultMessage: 'Same as all followers' })
                          : own ? intl.formatMessage({ id: 'On#a follower\'s own grant', defaultMessage: 'On', description: 'a follower\'s own grant' })
                          : intl.formatMessage({ id: 'Off#a follower\'s own grant', defaultMessage: 'Off', description: 'a follower\'s own grant' })
                        }
                        aria-label={cellLabel(control, label)}
                        aria-pressed={on}
                        onClick={() => party.setGrants(withMember(grants, member.id, control, nextGrant(own, inherited)))}
                      >
                        {on ? <Check size={14}/> : <X size={14}/>}
                      </button>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default PartyGrants
