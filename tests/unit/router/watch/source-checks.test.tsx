// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount, withIntl } from '../../components/dom'

import type { WindowFrame } from '@fkn/lib'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

// the real window helper, with only FKN's window opener and the extension's exposure replaced
const attach = vi.hoisted(() => vi.fn())
const extension = vi.hoisted(() => ({ exposed: true }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: attach,
  isExtensionExposed: () => extension.exposed,
}))
// each source's `check` as the worker answers it, read through the worker's own reader, and every search asked again
const worker = vi.hoisted(() => ({ checks: {} as Record<string, () => Promise<unknown>>, asked: [] as string[], searched: [] as string[] }))
vi.mock('../../../../src/worker', async () => {
  const { askCheck } = await import('../../../../src/worker/plugin-sources')
  return {
    remoteCheck: async (origin: string) => {
      worker.asked.push(origin)
      const check = worker.checks[origin]
      return check ? askCheck(check, 'https://ext.to') : undefined
    },
    searchAgain: async (origin: string) => { worker.searched.push(origin) },
  }
})

const { FrameWindowBlockedError } = await import('@fkn/lib')
const { default: SourceChecks } = await import('../../../../src/router/watch/source-checks')

const CHECK = { url: 'https://ext.to/browse/?imdb_id=tt1375666', passed: 'table.search-table' }
const EXTTO = { origin: 'extto', name: 'ext.to', icon: null }
const YTS = { origin: 'yts', name: 'YTS', icon: null }

const flush = () => act(async () => { for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setTimeout(resolve)) })

// a window as the lib hands one over: `passed` says whether the page shows what the source said it shows once the check
// is passed, and `end` closes it as the viewer would
const fakeWindow = () => {
  const state = { passed: false }
  let end!: () => void
  const closed = new Promise<void>(resolve => { end = resolve })
  const close = vi.fn(async () => end())
  const goto = vi.fn(async () => {})
  const locator = vi.fn((selector: string) => ({ exists: async () => selector === CHECK.passed && state.passed }))
  return { login: { closed, close, goto, locator } as unknown as WindowFrame, state, end, close, goto }
}

const hosts: HTMLElement[] = []
beforeEach(() => {
  attach.mockReset()
  extension.exposed = true
  worker.checks = {}
  worker.asked = []
  worker.searched = []
})
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const render = (answered = true) => {
  const host = mount(withIntl(<SourceChecks sources={[EXTTO, YTS]} answered={answered}/>))
  hosts.push(host)
  return host
}

test('a check a source reports, once its search settled, raises a prompt naming the source', async () => {
  worker.checks.extto = async () => CHECK
  const host = render()
  await flush()
  expect(worker.asked).toEqual(['extto', 'yts'])
  expect([...host.querySelectorAll('li')].map(item => item.textContent)).toEqual(['eext.toVerify'])
  expect(button(host, 'Verify')).toBeDefined()
})

test('nothing is asked or shown before the sources answered', async () => {
  worker.checks.extto = async () => CHECK
  const host = render(false)
  await flush()
  expect(worker.asked).toEqual([])
  expect(host.querySelector('li')).toBeNull()
})

test("the prompt's button opens the check's page in a window on stub's cloud jar, before anything is awaited", async () => {
  worker.checks.extto = async () => CHECK
  const host = render()
  await flush()
  attach.mockReturnValue(new Promise(() => {}))
  button(host, 'Verify')!.click()
  expect(attach).toHaveBeenCalledTimes(1)
  // with the extension installed too, the plugin's frames reading stub's cloud jar
  expect(attach).toHaveBeenCalledWith({ window: {}, domains: ['ext.to'], cookies: 'persistent' })
  await flush()
  expect(button(host, 'Verify')!.disabled).toBe(true)
})

test('a check off the source\'s site raises no prompt, so nothing can open it', async () => {
  worker.checks.extto = async () => ({ url: 'https://accounts.example.com/signin', passed: 'body' })
  const host = render()
  await flush()
  expect(host.querySelector('li')).toBeNull()
  expect(attach).not.toHaveBeenCalled()
})

test('the window closes once the page is past the check, and the source is searched again', async () => {
  worker.checks.extto = async () => CHECK
  const host = render()
  await flush()
  const window = fakeWindow()
  attach.mockResolvedValue(window.login)
  button(host, 'Verify')!.click()
  await flush()
  expect(window.goto).toHaveBeenCalledWith(CHECK.url, { waitUntil: 'commit' })
  expect(worker.searched).toEqual([])
  // the search after it reads the page: the source reports no check any more
  worker.checks.extto = async () => null
  window.state.passed = true
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)) })
  await flush()
  expect(window.close).toHaveBeenCalled()
  expect(worker.searched).toEqual(['extto'])
  expect(host.querySelector('li')).toBeNull()
})

test('a window the viewer closes searches the source again too, and a check it meets again comes back', async () => {
  worker.checks.extto = async () => CHECK
  const host = render()
  await flush()
  const window = fakeWindow()
  attach.mockResolvedValue(window.login)
  button(host, 'Verify')!.click()
  await flush()
  window.end()
  await flush()
  expect(worker.searched).toEqual(['extto'])
  expect(worker.asked.filter(origin => origin === 'extto')).toHaveLength(2)
  expect(button(host, 'Verify')!.disabled).toBe(false)
})

test('a window the browser would not open searches nothing again', async () => {
  worker.checks.extto = async () => CHECK
  const host = render()
  await flush()
  attach.mockRejectedValue(new FrameWindowBlockedError())
  button(host, 'Verify')!.click()
  await flush()
  expect(worker.searched).toEqual([])
  expect(button(host, 'Verify')!.disabled).toBe(false)
})
