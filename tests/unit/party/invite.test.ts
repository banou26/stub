import { describe, expect, test } from 'vite-plus/test'

import { inviteFromHash, partyLink, PARTY_PATH } from '../../../src/party/invite'
import { writePluginUris } from '../../../src/utils/plugin-links'

const ORIGIN = 'https://anime.fkn.app'
const KEY = 'Qm9yZWQtYnV0LWhhcHB5LWV2ZXJ5LWRheS1vay1va2F'
const NAME = '1b4e28ba2fa111d2883f0016d3cc'
// what `@fkn/lib` mints: the key, then the room id, which is `<scope>/<name>` with this app's origin as the scope
const INVITE = `${KEY}.${ORIGIN}/${NAME}`

describe('partyLink and inviteFromHash', () => {
  test('the link says the origin once, not twice', () => {
    // the page already names the origin, so repeating it inside the fragment is a longer link saying nothing new
    expect(partyLink(ORIGIN, INVITE)).toBe(`${ORIGIN}${PARTY_PATH}#${KEY}.${NAME}`)
  })

  test('and the invite that comes back out is the one the broker was given', () => {
    const link = partyLink(ORIGIN, INVITE)
    expect(inviteFromHash(new URL(link).hash, ORIGIN)).toBe(INVITE)
  })

  test('an invite for ANOTHER origin keeps its scope, in the link and out of it', () => {
    const elsewhere = `${KEY}.https://stub.plugins.banou.dev/${NAME}`
    const link = partyLink(ORIGIN, elsewhere)
    expect(link).toBe(`${ORIGIN}${PARTY_PATH}#${elsewhere}`)
    // and it is NOT re-scoped to the origin reading it, which would silently open a different room
    expect(inviteFromHash(new URL(link).hash, ORIGIN)).toBe(elsewhere)
  })

  // HOR-845: the link the host shares carries the host's sources
  test('a source list on the link leaves the invite as it was', () => {
    for (const invite of [INVITE, `${KEY}.https://stub.plugins.banou.dev/${NAME}`]) {
      const link = new URL(writePluginUris(partyLink(ORIGIN, invite), ['https:stub.plugins.banou.dev'], `${ORIGIN}/`))
      expect(link.search).toBe('?plugins=https:stub.plugins.banou.dev')
      expect(inviteFromHash(link.hash, ORIGIN)).toBe(invite)
    }
  })

  test('a full invite still opens, since links already shared carry one', () => {
    expect(inviteFromHash(`#${INVITE}`, ORIGIN)).toBe(INVITE)
    expect(inviteFromHash(INVITE, ORIGIN)).toBe(INVITE)
    expect(inviteFromHash(`#${encodeURIComponent(INVITE)}`, ORIGIN)).toBe(INVITE)
  })

  test('with or without the hash mark, and url-encoded', () => {
    expect(inviteFromHash(`${KEY}.${NAME}`, ORIGIN)).toBe(INVITE)
    expect(inviteFromHash(`#${encodeURIComponent(`${KEY}.${NAME}`)}`, ORIGIN)).toBe(INVITE)
  })

  // The failures a shared link actually suffers: a chat client that dropped the fragment, a copy that
  // cut the key, a key that is not the shape the broker mints, a name the grammar refuses. Each has to
  // read as a broken link on the page rather than an opaque refusal from the broker.
  test('a mangled link is nothing', () => {
    for (const hash of [
      '',
      '#',
      `#${KEY}`,
      `#short.${ORIGIN}/lobby`,
      `#short.${NAME}`,
      `#${KEY}.Upper`,
      `#${KEY}.${ORIGIN}/Upper`,
      '#../../etc',
      // a stray percent used to throw out of decodeURIComponent and take the page with it
      '#%',
      `#${KEY}.%zz`,
    ]) {
      expect(inviteFromHash(hash, ORIGIN), hash).toBeUndefined()
    }
  })

  test('a short link cannot smuggle a scope in through the origin it is read with', () => {
    // the rebuilt id is checked like any other, so an origin that is not one produces nothing
    expect(inviteFromHash(`${KEY}.${NAME}`, '')).toBeUndefined()
    expect(inviteFromHash(`${KEY}.${NAME}`, 'a'.repeat(300))).toBeUndefined()
  })
})
