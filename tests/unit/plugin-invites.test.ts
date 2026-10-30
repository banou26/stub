// A `?plugins=` link is read before the FKN account's list arrives, so its offer of a source that list
// brings is withdrawn once the list is in. A package FKN already holds for this app, installed on another
// of its sites, is added without the offer, and the offer waits for FKN's list to know which.
import { afterEach, expect, test, vi } from 'vite-plus/test'

const plugins = vi.hoisted(() => ({
  enabled: [] as string[],
  listeners: new Set<() => void>(),
  // an install that has not settled yet
  enablePlugin: vi.fn((_uri: string, _options?: unknown) => new Promise<string | null>(() => {})),
  installPlugin: vi.fn(async (uri: string): Promise<string | null> => uri),
  installedPluginUris: vi.fn(async (): Promise<string[]> => []),
}))
vi.mock('../../src/plugins', () => ({
  enabledPluginUris: () => plugins.enabled,
  enablePlugin: plugins.enablePlugin,
  installPlugin: plugins.installPlugin,
  installedPluginUris: plugins.installedPluginUris,
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
}))

const { acceptInvites, declineInvites, offerInvites, onInvitesChange, pendingInviteUris, pluginInvites } = await import('../../src/plugin-invites')

const listChanged = (enabled: string[]) => {
  plugins.enabled = enabled
  for (const listener of plugins.listeners) listener()
}

const offered = () => pluginInvites().map(invite => invite.uri)

afterEach(() => {
  vi.useRealTimers()
  declineInvites()
})

test("an offer of a source the account's list brings is withdrawn when the list arrives", async () => {
  listChanged([])
  await offerInvites(['npm:@banou/one@1.2.0', 'npm:@banou/two'])
  expect(offered()).toEqual(['npm:@banou/one@1.2.0', 'npm:@banou/two'])

  listChanged(['npm:@banou/one'])
  expect(offered()).toEqual(['npm:@banou/two'])
})

test('an offer the viewer already accepted stays on screen while it installs', async () => {
  listChanged([])
  await offerInvites(['npm:@banou/three'])
  void acceptInvites()
  expect(pluginInvites()).toEqual([{ uri: 'npm:@banou/three', state: 'installing' }])

  listChanged(['npm:@banou/three'])
  expect(pluginInvites()).toEqual([{ uri: 'npm:@banou/three', state: 'installing' }])
})

test('a package FKN holds for this app from another of its sites is added, not offered', async () => {
  listChanged([])
  plugins.installPlugin.mockClear()
  plugins.installedPluginUris.mockResolvedValueOnce(['https:stub.plugins.banou.dev', 'npm:@banou/four'])
  await offerInvites(['https:stub.plugins.banou.dev/', 'npm:@banou/four@2.0.0', 'npm:@banou/five'])

  expect(offered()).toEqual(['npm:@banou/five'])
  expect(plugins.installPlugin.mock.calls.map(([uri]) => uri)).toEqual(['https:stub.plugins.banou.dev/', 'npm:@banou/four@2.0.0'])
})

// FKN confirms a version other than the one it holds, and the viewer can say no there
test("a no to FKN's confirm is kept, and the link leaves the url", async () => {
  listChanged([])
  plugins.installPlugin.mockClear()
  plugins.installedPluginUris.mockResolvedValueOnce(['npm:@banou/eight'])
  plugins.installPlugin.mockResolvedValueOnce(null)
  const changed = vi.fn()
  const unsubscribe = onInvitesChange(changed)
  await offerInvites(['npm:@banou/eight@1.2.3'])
  await vi.waitFor(() => expect(changed).toHaveBeenCalled())
  unsubscribe()
  expect(pendingInviteUris()).toEqual([])

  await offerInvites(['npm:@banou/eight@1.2.3'])
  expect(offered()).toEqual([])
  expect(plugins.installPlugin).toHaveBeenCalledTimes(1)
})

test('a listed package FKN will not add is offered like any other link', async () => {
  listChanged([])
  plugins.installedPluginUris.mockResolvedValueOnce(['npm:@banou/nine'])
  plugins.installPlugin.mockRejectedValueOnce(new Error('invalid'))
  await offerInvites(['npm:@banou/nine@0.0.1'])

  await vi.waitFor(() => expect(offered()).toEqual(['npm:@banou/nine@0.0.1']))
})

test("the offer waits for FKN's list, and stays on the url meanwhile", async () => {
  listChanged([])
  let answer!: (uris: string[]) => void
  plugins.installedPluginUris.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
  const offering = offerInvites(['npm:@banou/six'])

  expect(offered()).toEqual([])
  expect(pendingInviteUris()).toEqual(['npm:@banou/six'])

  answer([])
  await offering
  expect(offered()).toEqual(['npm:@banou/six'])
})

test('a list that never answers holds the offer 1.5 s, then it is offered', async () => {
  vi.useFakeTimers()
  listChanged([])
  plugins.installedPluginUris.mockReturnValueOnce(new Promise(() => {}))
  void offerInvites(['npm:@banou/seven'])

  await vi.advanceTimersByTimeAsync(1_400)
  expect(offered()).toEqual([])
  await vi.advanceTimersByTimeAsync(100)
  expect(offered()).toEqual(['npm:@banou/seven'])
})
