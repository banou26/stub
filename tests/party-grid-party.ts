import type { rooms } from '@fkn/lib'
import type { PartyMessage } from '../src/party/protocol'

import { encodePartyMessage } from '../src/party/protocol'
import { createPartyStore } from '../src/party/store'

// The party tests/party-grid.tsx hosts: the REAL store over a room that lives on the page.
// tests/party-grid.spec.ts builds it in place of src/party/index.ts, so every component draws this one.

const listeners = new Set<(event: rooms.RoomEvent) => void>()
const members = [{ id: 'host' }]
const room = {
  invite: 'Qm9yZWQtYnV0LWhhcHB5LWV2ZXJ5LWRheS1vay1va2F.https://anime.fkn.app/1b4e28ba2fa111d2883f0016d3cc',
  owner: 'host',
  self: { id: 'host' },
  members: async () => members,
  on: async (listener: (event: rooms.RoomEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  send: async () => {},
  leave: async () => {},
  closed: new Promise(() => {}),
} as unknown as rooms.Room

export const party = createPartyStore({ available: async () => true, create: async () => room, join: async () => room, open: async () => room })
export { partyLink } from '../src/party/invite'

let seq = 0
/** A follower joins and says `messages`. */
export const follower = (id: string, ...messages: PartyMessage[]) => {
  members.push({ id })
  const tell = (event: rooms.RoomEvent) => { for (const listener of listeners) listener(event) }
  tell({ type: 'joined', member: { id } } as rooms.RoomEvent)
  for (const message of messages) {
    tell({ type: 'message', message: { seq: ++seq, from: id, at: Date.now(), text: encodePartyMessage(message), envelope: null }, replayed: false })
  }
}
