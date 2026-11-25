import { rooms } from '@fkn/lib'

import { social } from '../social'
import { createPartyStore } from './store'

/** The one party this tab is in. A room is held by the broker, so there is exactly one per page. */
export const party = createPartyStore(rooms, undefined, social)

export { partyLink } from './invite'
export type { PartyState, PartyRole, PartyEndReason, PartyMember, PartyChatLine, PartyMessageMeta } from './store'
export type { PartyMessage, PlaybackState } from './protocol'
