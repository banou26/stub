import type { rooms } from '@fkn/lib'
import type { PartyMessage } from '../src/party/protocol'

import { encodePartyMessage } from '../src/party/protocol'
import { createPartyStore } from '../src/party/store'

// The party tests/party-grid.tsx and tests/party-pages.tsx draw: the REAL store over a room that lives on the page,
// held by HOST, or followed by `me` on a page whose query says `as=me`. A query's `join=failed` refuses the join
// as the broker would, and `join=pending` never answers. Their specs build it in place of src/party/index.ts, so
// every component draws this one.

/** The host's member id, as opaque as the broker's, so no page shows it as a word. */
export const HOST = 'c0ffee12ab34'

const query = new URLSearchParams(location.search)
const self = query.get('as') ?? HOST
const listeners = new Set<(event: rooms.RoomEvent) => void>()
const members = [{ id: HOST }, ...self === HOST ? [] : [{ id: self }]]
let close: (end: rooms.RoomEnd) => void
const room = {
  invite: 'Qm9yZWQtYnV0LWhhcHB5LWV2ZXJ5LWRheS1vay1va2F.https://anime.fkn.app/1b4e28ba2fa111d2883f0016d3cc',
  owner: HOST,
  self: { id: self },
  members: async () => members,
  on: async (listener: (event: rooms.RoomEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  // the api hands a sender its own message back
  send: async (text: string) => { queueMicrotask(() => tell({ type: 'message', message: { seq: ++seq, from: self, at: Date.now(), text, envelope: null }, replayed: false })) },
  leave: async () => {},
  closed: new Promise<rooms.RoomEnd>(resolve => { close = resolve }),
} as unknown as rooms.Room

const join = async () => {
  if (query.get('join') === 'pending') return new Promise<rooms.Room>(() => {})
  if (query.get('join') === 'failed') throw Object.assign(new Error('rooms: unavailable'), { code: 'unavailable' })
  return room
}

export const party = createPartyStore({ available: async () => true, create: async () => room, join })
export { partyLink } from '../src/party/invite'

const tell = (event: rooms.RoomEvent) => { for (const listener of listeners) listener(event) }

let seq = 0
/** `from` says `messages`. */
export const says = (from: string, ...messages: PartyMessage[]) => {
  for (const message of messages) {
    tell({ type: 'message', message: { seq: ++seq, from, at: Date.now(), text: encodePartyMessage(message), envelope: null }, replayed: false })
  }
}

/** A follower joins and says `messages`. */
export const follower = (id: string, ...messages: PartyMessage[]) => {
  members.push({ id })
  tell({ type: 'joined', member: { id } } as rooms.RoomEvent)
  says(id, ...messages)
}

/** The room ends for this member. */
export const end = (reason: rooms.RoomEnd['reason']) => close({ reason })
