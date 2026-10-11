import type { PartyMember } from '../party'
import type { Control, Grants } from '../party/protocol'

import { css } from '@emotion/react'
import { Check, FastForward, Gauge, Play, X } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'

import { party } from '../party'
import { CONTROLS } from '../party/protocol'
import { useParty, usePartyMessages } from '../party/use-party'
import { memberLabel } from './party-chat'

export const CONTROL_LABEL: Record<Control, string> = { play: 'Play/pause', seek: 'Seek', rate: 'Speed' }
const CONTROL_ICON: Record<Control, typeof Play> = { play: Play, seek: FastForward, rate: Gauge }

const style = css`
  margin-top: 1rem;
  max-height: 16rem;
  overflow-y: auto;

  table { width: 100%; border-collapse: collapse; }
  th { font-weight: 500; text-align: left; color: rgba(255, 255, 255, 0.6); }
  thead th { text-align: center; padding-bottom: 0.4rem; }
  tbody th { max-width: 14rem; padding: 0.2rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td { text-align: center; padding: 0.2rem 0; }

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

/** The host's grid of who may use which control: all followers, then one row per follower. */
const PartyGrants = () => {
  const state = useParty()
  const [members, setMembers] = useState<PartyMember[]>([])
  const count = state.status === 'active' ? state.members : 0
  useEffect(() => {
    let cancelled = false
    void party.roster().then(list => { if (!cancelled) setMembers(list) })
    return () => { cancelled = true }
  }, [count])
  usePartyMessages(message => { if (message.t === 'name') void party.roster().then(setMembers) })

  if (state.status !== 'active') return null
  const grants = party.issued()

  return (
    <div css={style}>
      <table>
        <thead>
          <tr>
            <th/>
            {CONTROLS.map(control => {
              const Icon = CONTROL_ICON[control]
              return <th key={control} title={CONTROL_LABEL[control]}><Icon size={14} aria-label={CONTROL_LABEL[control]}/></th>
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">All followers</th>
            {CONTROLS.map(control => {
              const on = grants.all.includes(control)
              return (
                <td key={control}>
                  <button
                    type="button"
                    className="cell"
                    aria-label={`${CONTROL_LABEL[control]}, All followers`}
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
            const label = memberLabel({ from: member.id, name: member.name, self: member.self }, state.owner)
            return (
              <tr key={member.id}>
                <th scope="row" title={label}>{label}</th>
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
                        title={own === undefined ? 'Same as all followers' : own ? 'On' : 'Off'}
                        aria-label={`${CONTROL_LABEL[control]}, ${label}`}
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
