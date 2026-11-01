// A page Back or Forward loads again is stub's own mirror of the list as it was then, so its address adds nothing
// FKN does not hold: a source removed since, on this site or another, stays removed.
import { expect, test, vi } from 'vite-plus/test'

const addInvites = vi.hoisted(() => vi.fn(async (_uris: string[], _options?: { install?: boolean }) => {}))
vi.mock('../../src/plugin-invites', () => ({ addInvites, onInvitesChange: () => () => {}, pendingInviteUris: () => [] }))
vi.mock('../../src/plugins', () => ({ enabledPluginUris: () => [], onPluginsChange: () => () => {} }))

const LINK = 'https:stub.plugins.banou.dev'
vi.spyOn(performance, 'getEntriesByType').mockImplementation(type => type === 'navigation' ? [{ type: 'back_forward' } as PerformanceNavigationTiming] : [])
vi.stubGlobal('location', { href: `https://anime.fkn.app/settings?plugins=${LINK}`, origin: 'https://anime.fkn.app' })
vi.stubGlobal('history', { state: null, pushState: () => {}, replaceState: () => {} })
vi.stubGlobal('addEventListener', () => {})

test('a page Back or Forward loads again shows only what FKN holds of what its address names', async () => {
  await import('../../src/plugin-url')
  expect(addInvites.mock.calls).toEqual([[[LINK], { install: false }]])
})
