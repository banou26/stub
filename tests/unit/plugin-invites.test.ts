// A `?plugins=` link adds what the list lacks with no prompt, and says so. A package FKN already holds for this
// app, installed on another of its sites, is added with nothing to say, which is what keeps stub's own site links
// quiet, so nothing happens until FKN's list has answered.
import { afterEach, expect, test, vi } from 'vite-plus/test'

const plugins = vi.hoisted(() => ({
  enabled: [] as string[],
  enablePlugin: vi.fn(async (uri: string, _options?: unknown): Promise<string | null> => uri),
  installPlugin: vi.fn(async (uri: string): Promise<string | null> => uri),
  installedPluginUris: vi.fn(async (): Promise<string[]> => []),
  disablePlugin: vi.fn(async (_uri: string) => {}),
}))
vi.mock('../../src/plugins', () => ({
  enabledPluginUris: () => plugins.enabled,
  enablePlugin: plugins.enablePlugin,
  installPlugin: plugins.installPlugin,
  installedPluginUris: plugins.installedPluginUris,
  disablePlugin: plugins.disablePlugin,
}))
vi.spyOn(console, 'warn').mockImplementation(() => {})

const { addedInvites, addInvites, closeInvites, onInvitesChange, pendingInviteUris, removeInvite } = await import('../../src/plugin-invites')

afterEach(() => {
  vi.useRealTimers()
  closeInvites()
  plugins.enabled = []
  plugins.enablePlugin.mockClear()
  plugins.installPlugin.mockClear()
  plugins.disablePlugin.mockClear()
})

test('a source neither stub nor FKN has is installed with no prompt and said', async () => {
  await addInvites(['https:stub.plugins.banou.dev'])

  expect(plugins.enablePlugin).toHaveBeenCalledWith('https:stub.plugins.banou.dev', { noConfirm: true })
  expect(addedInvites()).toEqual([{ uri: 'https:stub.plugins.banou.dev' }])
})

test('the notice carries the id FKN hands back, not the version the link pinned', async () => {
  plugins.enablePlugin.mockResolvedValueOnce('npm:@banou/one')
  await addInvites(['npm:@banou/one@1.2.0'])

  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/one' }])
})

test('several sources on one link share one list, and one that fails costs the others nothing', async () => {
  plugins.enablePlugin.mockRejectedValueOnce(new Error('invalid'))
  await addInvites(['npm:@banou/dead', 'npm:@banou/two', 'npm:@banou/three'])

  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/dead', failed: true }, { uri: 'npm:@banou/two' }, { uri: 'npm:@banou/three' }])
})

test('a source already on the list adds nothing and says nothing, whatever version the link names', async () => {
  plugins.enabled = ['npm:@banou/one']
  plugins.installedPluginUris.mockClear()
  await addInvites(['npm:@banou/one@1.2.0'])

  expect(plugins.installedPluginUris, 'every page load carries the mirror, so FKN is not asked for it').not.toHaveBeenCalled()
  expect(plugins.enablePlugin).not.toHaveBeenCalled()
  expect(plugins.installPlugin).not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
})

test("a package FKN holds for this app from another of its sites joins the list with nothing to say", async () => {
  plugins.installedPluginUris.mockResolvedValueOnce(['https:stub.plugins.banou.dev', 'npm:@banou/four'])
  await addInvites(['https:stub.plugins.banou.dev/', 'npm:@banou/four@2.0.0', 'npm:@banou/five'])

  expect(plugins.installPlugin.mock.calls.map(([uri]) => uri)).toEqual(['https:stub.plugins.banou.dev/', 'npm:@banou/four@2.0.0'])
  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/five' }])
})

// a site's first list may wait 3 s on FKN's own api: a mirror of the sources must not read as a new link meanwhile
test("stub's own site link is told from a new link however long FKN's list takes", async () => {
  vi.useFakeTimers()
  plugins.installedPluginUris.mockReturnValueOnce(new Promise(resolve => { setTimeout(() => resolve(['https:stub.plugins.banou.dev']), 3_000) }))
  void addInvites(['https:stub.plugins.banou.dev'])

  await vi.advanceTimersByTimeAsync(2_900)
  expect(plugins.enablePlugin).not.toHaveBeenCalled()
  expect(pendingInviteUris(), 'kept on the url meanwhile').toEqual(['https:stub.plugins.banou.dev'])

  await vi.advanceTimersByTimeAsync(100)
  expect(plugins.installPlugin).toHaveBeenCalledWith('https:stub.plugins.banou.dev')
  expect(plugins.enablePlugin).not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
  expect(pendingInviteUris()).toEqual([])
})

// FKN confirms a version other than the one it holds, and the viewer can say no there
test("a no to FKN's confirm says nothing, and the link leaves the url", async () => {
  plugins.installedPluginUris.mockResolvedValueOnce(['npm:@banou/eight'])
  plugins.installPlugin.mockResolvedValueOnce(null)
  const changed = vi.fn()
  const unsubscribe = onInvitesChange(changed)
  await addInvites(['npm:@banou/eight@1.2.3'])
  unsubscribe()

  expect(changed).toHaveBeenCalled()
  expect(pendingInviteUris()).toEqual([])
  expect(addedInvites()).toEqual([])
})

test('a broker too old for noConfirm still confirms, and a no there says nothing', async () => {
  plugins.enablePlugin.mockResolvedValueOnce(null)
  await addInvites(['npm:@banou/nine'])

  expect(addedInvites()).toEqual([])
  expect(pendingInviteUris()).toEqual([])
})

test('a listed package FKN will not add says so like any other', async () => {
  plugins.installedPluginUris.mockResolvedValueOnce(['npm:@banou/nine'])
  plugins.installPlugin.mockRejectedValueOnce(new Error('invalid'))
  await addInvites(['npm:@banou/nine@0.0.1'])

  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/nine@0.0.1', failed: true }])
})

test('a source FKN installed that fails to connect stays on the list, and its failure carries the id Remove needs', async () => {
  plugins.enablePlugin.mockImplementationOnce(async () => {
    plugins.enabled = ['npm:@banou/ten']
    throw new Error('failed to boot')
  })
  await addInvites(['npm:@banou/ten@1.0.0'])

  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/ten', failed: true }])
})

test("the account's list bringing a source while FKN's list is awaited leaves nothing to add", async () => {
  let answer!: (uris: string[]) => void
  plugins.installedPluginUris.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
  const adding = addInvites(['npm:@banou/ten'])

  plugins.enabled = ['npm:@banou/ten']
  answer([])
  await adding
  expect(plugins.enablePlugin).not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
})

test('a source stays on the url until FKN has answered for it, then the list carries it', async () => {
  let answer!: (uri: string) => void
  plugins.enablePlugin.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
  const adding = addInvites(['npm:@banou/six'])
  expect(pendingInviteUris()).toEqual(['npm:@banou/six'])

  await vi.waitFor(() => expect(plugins.enablePlugin).toHaveBeenCalled())
  answer('npm:@banou/six')
  await adding
  expect(pendingInviteUris()).toEqual([])
})

test('Remove takes that one source off the list and off the notice', async () => {
  await addInvites(['npm:@banou/two', 'npm:@banou/three'])
  removeInvite('npm:@banou/two')

  expect(plugins.disablePlugin.mock.calls).toEqual([['npm:@banou/two']])
  expect(addedInvites()).toEqual([{ uri: 'npm:@banou/three' }])
})

test('OK closes the notice and keeps every source', async () => {
  await addInvites(['npm:@banou/two', 'npm:@banou/three'])
  closeInvites()

  expect(plugins.disablePlugin).not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
})

// last: the link stays held for the rest of this page
test('a list that fails adds nothing and says nothing, and the link stays on the url', async () => {
  plugins.installedPluginUris.mockRejectedValueOnce(new Error('unavailable'))
  await addInvites(['npm:@banou/six'])

  expect(plugins.enablePlugin).not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
  expect(pendingInviteUris()).toEqual(['npm:@banou/six'])
})
