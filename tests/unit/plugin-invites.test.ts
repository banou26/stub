// A `?plugins=` link is read before the FKN account's list arrives, so its offer of a source that list
// brings is withdrawn once the list is in.
import { expect, test, vi } from 'vite-plus/test'

const plugins = vi.hoisted(() => ({
  enabled: [] as string[],
  listeners: new Set<() => void>(),
  // an install that has not settled yet
  enablePlugin: vi.fn((_uri: string, _options?: unknown) => new Promise<string | null>(() => {})),
}))
vi.mock('../../src/plugins', () => ({
  enabledPluginUris: () => plugins.enabled,
  enablePlugin: plugins.enablePlugin,
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
}))

const { acceptInvites, declineInvites, offerInvites, pluginInvites } = await import('../../src/plugin-invites')

const listChanged = (enabled: string[]) => {
  plugins.enabled = enabled
  for (const listener of plugins.listeners) listener()
}

test("an offer of a source the account's list brings is withdrawn when the list arrives", () => {
  listChanged([])
  offerInvites(['npm:@banou/one@1.2.0', 'npm:@banou/two'])
  expect(pluginInvites().map(invite => invite.uri)).toEqual(['npm:@banou/one@1.2.0', 'npm:@banou/two'])

  listChanged(['npm:@banou/one'])
  expect(pluginInvites().map(invite => invite.uri)).toEqual(['npm:@banou/two'])
  declineInvites()
})

test('an offer the viewer already accepted stays on screen while it installs', () => {
  listChanged([])
  offerInvites(['npm:@banou/three'])
  void acceptInvites()
  expect(pluginInvites()).toEqual([{ uri: 'npm:@banou/three', state: 'installing' }])

  listChanged(['npm:@banou/three'])
  expect(pluginInvites()).toEqual([{ uri: 'npm:@banou/three', state: 'installing' }])
})
