// A room as the party store sees one, driven from a test: the store over it is the REAL store, so a
// component test that mocks `src/party` with it exercises the same receive path a tab runs.
import { vi } from 'vite-plus/test'

import type { rooms } from '@fkn/lib'

type RoomEvent = rooms.RoomEvent
type Room = rooms.Room

export const INVITE = 'Qm9yZWQtYnV0LWhhcHB5LWV2ZXJ5LWRheS1vay1va2F.https://anime.fkn.app/1b4e28ba2fa111d2883f0016d3cc'

/** A room as the store sees one, with the wires to drive it from the test. */
export const fakeRoom = ({ self, owner, members = [self] }: { self: string, owner: string, members?: string[] }) => {
  const listeners = new Set<(event: RoomEvent) => void>()
  const sent: string[] = []
  let resolveClosed!: (end: rooms.RoomEnd) => void
  const closed = new Promise<rooms.RoomEnd>(resolve => { resolveClosed = resolve })
  const perms = { send: true, receive: true, remove: false, block: false }
  const room = {
    id: INVITE.slice(INVITE.indexOf('.') + 1),
    name: INVITE.slice(INVITE.lastIndexOf('/') + 1),
    key: INVITE.slice(0, INVITE.indexOf('.')),
    invite: INVITE,
    claimed: false,
    mailbox: null,
    self: { id: self, permissions: perms, maxMessageBytes: 262_144 },
    owner,
    defaults: () => ({ send: false, receive: true, maxMessageBytes: 262_144 }),
    members: async () => members.map(id => ({ id, permissions: perms, maxMessageBytes: 262_144 })),
    send: vi.fn(async (text: string) => { sent.push(text) }),
    // the surface the party never calls, present so the fake satisfies `Room`
    edit: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    backlog: vi.fn(async () => ({ last: 0, more: false })),
    limit: vi.fn(async () => {}),
    claim: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    usage: vi.fn(async () => null),
    setDefault: vi.fn(async () => {}),
    grant: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    block: vi.fn(async () => {}),
    unblock: vi.fn(async () => {}),
    on: async (listener: (event: RoomEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    leave: vi.fn(async () => { resolveClosed({ reason: 'left' }) }),
    closed,
  } satisfies Room
  return {
    room,
    sent,
    emit: (event: RoomEvent) => { for (const listener of listeners) listener(event) },
    end: (reason: rooms.RoomEnd['reason']) => resolveClosed({ reason }),
    join: (id: string) => { members.push(id) },
  }
}

export const memoryStorage = () => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
}

const roomsError = (code: rooms.RoomsErrorCode) => Object.assign(new Error(`rooms: ${code}`), { code })

export const api = (room: Room, joinError?: rooms.RoomsErrorCode) => ({
  available: async () => true,
  create: vi.fn(async () => room),
  join: vi.fn(async () => { if (joinError) throw roomsError(joinError); return room }),
})
