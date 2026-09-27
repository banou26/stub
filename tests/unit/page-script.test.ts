// The AniList page script as the build ships it, run the way `frame.evaluate` runs a source string on
// the cloud backend: `(<source>\n)` evaluated in the page's realm and, being a function, called with the
// arg (proxy-sandbox locator-modules.ts). Here the page's realm is this one, with its globals stubbed.
import { afterEach, expect, test, vi } from 'vitest'

import { resolve } from 'node:path'

import { expose } from 'osra'

import type { SessionPageApi } from '../../src/sources/anilist/session-page'

import { buildPageScript } from '../../scripts/page-script'
import { READ_SESSION_INSTALL, SESSION_INSTALL, SESSION_PORT_MESSAGE } from '../../src/tracking/session-frames'

const STATE = Symbol.for(SESSION_INSTALL)

const inPage = (source: string): unknown => (0, eval)(`(${source}\n)`)

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as Record<symbol, unknown>)[STATE]
})

test('ships one function expression that installs the session server in the page it runs in', async () => {
  const source = await buildPageScript(resolve(__dirname, '../../src/sources/anilist/session-page.ts'))

  const window = new EventTarget()
  const asked: string[] = []
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
  vi.stubGlobal('al_token', 'T0kenRenderedForThisSession0000000000000')
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    asked.push(`${input} ${(init.headers as Record<string, string>)['x-csrf-token']}`)
    return new Response(JSON.stringify({ data: { Viewer: { id: 7 } } }), { status: 200 })
  })

  const compiled = inPage(source)
  const serving = () => (inPage(READ_SESSION_INSTALL) as (name: string) => unknown)(SESSION_INSTALL)
  expect(typeof compiled).toBe('function')
  expect(serving(), 'a document with no install').toBeNull()
  expect((compiled as (arg: unknown) => unknown)({ kind: 'serve', appOrigin: 'https://anime.fkn.app', key: 'k1' })).toBe('installed')
  expect(globalThis, 'nothing but its own state lands on the page').not.toHaveProperty('__stubPageScript')
  expect(serving(), "the key the session frame's read finds").toBe('k1')

  const { port1, port2 } = new MessageChannel()
  window.dispatchEvent(new MessageEvent('message', { data: { type: SESSION_PORT_MESSAGE, key: 'k1' }, origin: 'https://anime.fkn.app', ports: [port2] }))
  const page = await expose<SessionPageApi>({}, { transport: port1 })
  const answer = await page.graphql({ query: 'query { Viewer { id } }' })
  port1.close()

  expect(answer.body).toEqual({ data: { Viewer: { id: 7 } } })
  expect(asked).toEqual(['/graphql T0kenRenderedForThisSession0000000000000'])
  expect(await (compiled as (arg: unknown) => Promise<boolean>)({ kind: 'viewer' }), 'the sign-in check the same script answers').toBe(true)
})
