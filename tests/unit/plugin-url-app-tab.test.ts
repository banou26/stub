// Stub's copy in fkn.app sits in a frame at an address that is not one of stub's sites, where only fkn.app can tell
// stub's own fkn.app/app/ tab from a frame another app sent there. A link waits on the address for that answer, and
// adds its sources only in that tab.
import { expect, test, vi } from 'vite-plus/test'

const fkn = vi.hoisted(() => {
  let answer!: (yes: boolean) => void
  const appTab = new Promise<boolean>(resolve => { answer = resolve })
  return { answer, isAppTab: vi.fn(() => appTab) }
})
vi.mock('@fkn/lib', () => ({ shell: { isAppTab: fkn.isAppTab } }))

const plugins = vi.hoisted(() => {
  let answerList!: (held: { uri: string }[]) => void
  const list = new Promise<{ uri: string }[]>(resolve => { answerList = resolve })
  return {
    answerList,
    installedPlugins: vi.fn(() => list),
    enabled: [] as string[],
    enablePlugin: vi.fn(async (uri: string) => {
      plugins.enabled = [...plugins.enabled, uri]
      return { uri, connected: Promise.resolve() }
    }),
  }
})
vi.mock('../../src/plugins', () => ({
  enabledPluginUris: () => plugins.enabled,
  enablePlugin: plugins.enablePlugin,
  installPlugin: vi.fn(),
  installedPlugins: plugins.installedPlugins,
  supportsTemporary: async () => false,
  disablePlugin: vi.fn(),
  addedByLink: () => {},
  onPluginsChange: () => () => {},
}))
vi.mock('../../src/plugin-list', () => ({ loadEnabled: () => [] }))

const LINK = 'https:stub.plugins.banou.dev'
const COPY = 'https://spec-stub.sdbx.app'
const address = { origin: COPY, hostname: 'spec-stub.sdbx.app', href: `${COPY}/title/1?plugins=${LINK}` }
const moved = (url: unknown) => { address.href = new URL(String(url), address.href).href }
vi.stubGlobal('location', address)
vi.stubGlobal('history', {
  state: null,
  pushState: (_state: unknown, _unused: string, url: string) => moved(url),
  replaceState: (_state: unknown, _unused: string, url: string) => moved(url),
})
vi.stubGlobal('addEventListener', () => {})
// in a frame of fkn.app's /app page
vi.stubGlobal('window', globalThis)
vi.stubGlobal('top', {})

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

// imported here, since every test starts with its mocks' calls cleared
test('until fkn.app answers, a link adds nothing and stays on the address, through a navigation', async () => {
  await import('../../src/plugin-url')
  expect(fkn.isAppTab).toHaveBeenCalledTimes(1)
  await settled()
  expect(plugins.installedPlugins).not.toHaveBeenCalled()
  expect(address.href, 'a reload now keeps it').toBe(`${COPY}/title/1?plugins=${LINK}`)
  history.pushState(null, '', '/settings')
  expect(address.href).toBe(`${COPY}/settings?plugins=${LINK}`)
})

test('in stub\'s own fkn.app tab a link adds its source, and stays on the address while FKN adds it', async () => {
  fkn.answer(true)
  await vi.waitFor(() => expect(plugins.installedPlugins).toHaveBeenCalled())
  await settled()
  expect(address.href, 'FKN has not answered, and a reload now must not lose the link').toBe(`${COPY}/settings?plugins=${LINK}`)
  plugins.answerList([])
  const { addedInvites } = await import('../../src/plugin-invites')
  await vi.waitFor(() => expect(addedInvites()).toEqual([{ uri: LINK }]))
  expect(plugins.enablePlugin).toHaveBeenCalledWith(LINK, { noConfirm: true })
  expect(address.href).toBe(`${COPY}/settings?plugins=${LINK}`)
})
