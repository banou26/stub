// Whoever frames a page writes its address, on one of stub's own sites too, so a framed page asks fkn.app whether it is
// stub's own tab, and a link adds nothing where it is not.
import { expect, test, vi } from 'vite-plus/test'

const fkn = vi.hoisted(() => {
  let answer!: (yes: boolean) => void
  const appTab = new Promise<boolean>(resolve => { answer = resolve })
  return { answer, isAppTab: vi.fn(() => appTab) }
})
vi.mock('@fkn/lib', () => ({ shell: { isAppTab: fkn.isAppTab } }))
const addInvites = vi.hoisted(() => vi.fn(async (_uris: string[], _options?: { install?: boolean }) => {}))
vi.mock('../../src/plugin-invites', () => ({ addInvites, onInvitesChange: () => () => {}, pendingInviteUris: () => [] }))
vi.mock('../../src/plugins', () => ({ enabledPluginUris: () => [], onPluginsChange: () => () => {} }))

const LINK = 'https:stub.plugins.banou.dev'
const address = { origin: 'https://anime.fkn.app', hostname: 'anime.fkn.app', href: `https://anime.fkn.app/settings?plugins=${LINK}` }
vi.stubGlobal('location', address)
vi.stubGlobal('history', { state: null, pushState: () => {}, replaceState: (_state: unknown, _unused: string, url: string) => { address.href = url } })
vi.stubGlobal('addEventListener', () => {})
// another page above it
vi.stubGlobal('window', globalThis)
vi.stubGlobal('top', {})

test('framed on one of stub\'s sites, a link waits on fkn.app, and adds nothing when this is not stub\'s own tab', async () => {
  await import('../../src/plugin-url')
  expect(fkn.isAppTab).toHaveBeenCalledTimes(1)
  expect(address.href, 'kept while fkn.app answers').toBe(`https://anime.fkn.app/settings?plugins=${LINK}`)
  fkn.answer(false)
  await vi.waitFor(() => expect(address.href).toBe('https://anime.fkn.app/settings'))
  expect(addInvites).not.toHaveBeenCalled()
})
