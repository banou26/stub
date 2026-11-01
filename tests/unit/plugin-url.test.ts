// The address a page carries, with this page's list mirrored in it. A link is read once, as the page loads, and
// everything after that is stub's own writing.
import { expect, test, vi } from 'vite-plus/test'

const plugins = vi.hoisted(() => {
  let answerList!: (held: { uri: string }[]) => void
  const list = new Promise<{ uri: string }[]>(resolve => { answerList = resolve })
  return {
    list,
    answerList,
    enabled: [] as string[],
    // the sources a list stub keeps names, without those FKN holds for this tab alone
    kept: [] as string[],
    listeners: new Set<() => void>(),
    disablePlugin: vi.fn(async (uri: string) => {
      plugins.enabled = plugins.enabled.filter(enabled => enabled !== uri)
      for (const listener of plugins.listeners) listener()
    }),
    enablePlugin: vi.fn(async (uri: string): Promise<{ uri: string, connected: Promise<void> } | null> => {
      // a broker too old for noConfirm confirms, and the viewer says no
      if (uri === DECLINED) return null
      plugins.enabled = [...plugins.enabled, uri]
      for (const listener of plugins.listeners) listener()
      return { uri, connected: Promise.resolve() }
    }),
  }
})
vi.mock('../../src/plugins', () => ({
  enabledPluginUris: () => plugins.enabled,
  enablePlugin: plugins.enablePlugin,
  installPlugin: vi.fn(),
  installedPlugins: () => plugins.list,
  supportsTemporary: async () => false,
  disablePlugin: plugins.disablePlugin,
  addedByLink: () => {},
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
}))

vi.mock('../../src/plugin-list', () => ({ loadEnabled: () => plugins.kept }))

const LINK = 'https:stub.plugins.banou.dev'
const DECLINED = vi.hoisted(() => 'npm:@banou/declined')
const address = { origin: 'https://anime.fkn.app', href: `https://anime.fkn.app/title/1?plugins=${LINK}&plugins=${DECLINED}` }
const entries: string[] = []
const moved = (url: unknown) => { address.href = new URL(String(url), address.href).href }
vi.stubGlobal('location', address)
vi.stubGlobal('history', {
  state: null,
  pushState: (_state: unknown, _unused: string, url: string) => { entries.push(address.href); moved(url) },
  replaceState: (_state: unknown, _unused: string, url: string) => { moved(url) },
})
const popstate = new Set<() => void>()
vi.stubGlobal('addEventListener', (type: string, listener: () => void) => { if (type === 'popstate') popstate.add(listener) })

const back = () => {
  moved(entries.pop())
  for (const listener of popstate) listener()
}

const { pluginHref } = await import('../../src/plugin-url')
const { addedInvites, closeInvites, removeInvite } = await import('../../src/plugin-invites')

test('a link adds its source as the page loads, and a Back that reaches the mirror of a source removed since adds nothing', async () => {
  expect(address.href, 'FKN has not answered, and a reload now must not lose the link').toBe(`https://anime.fkn.app/title/1?plugins=${LINK}&plugins=${DECLINED}`)
  expect(pluginHref('/settings'), 'nor name it to a tab a link opens, since FKN may hold it for this tab alone').toBe('/settings')
  plugins.answerList([])
  await vi.waitFor(() => expect(addedInvites()).toEqual([{ uri: LINK }]))
  expect(address.href, 'a source the viewer said no to leaves the url').toBe(`https://anime.fkn.app/title/1?plugins=${LINK}`)

  history.pushState(null, '', '/settings')
  expect(address.href, 'stub mirrors the list on every address').toBe(`https://anime.fkn.app/settings?plugins=${LINK}`)
  history.pushState(null, '', '/list')

  plugins.enablePlugin.mockClear()
  removeInvite(LINK)
  await vi.waitFor(() => expect(plugins.enabled).toEqual([]))
  expect(address.href, 'a reload here has nothing to add').toBe('https://anime.fkn.app/list')

  back()
  expect(address.href, 'and the old entry stops naming it').toBe('https://anime.fkn.app/settings')
  back()
  expect(address.href).toBe('https://anime.fkn.app/title/1')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(plugins.enablePlugin, 'it stays removed').not.toHaveBeenCalled()
  expect(addedInvites()).toEqual([])
  closeInvites()
})

// a tab the link opens has none of them, and would keep them as a link's
test('a link opened in another tab names the kept sources, and none FKN holds for this tab alone, which a click in this tab carries', () => {
  const TEMPORARY = 'npm:@banou/temporary'
  plugins.enabled = [LINK, TEMPORARY]
  plugins.kept = [LINK]
  try {
    expect(pluginHref('/title/2')).toBe(`/title/2?plugins=${LINK}`)
    history.pushState(null, '', '/title/2')
    expect(address.href).toBe(`https://anime.fkn.app/title/2?plugins=${LINK}&plugins=${TEMPORARY}`)
  } finally {
    plugins.enabled = []
    plugins.kept = []
  }
})
