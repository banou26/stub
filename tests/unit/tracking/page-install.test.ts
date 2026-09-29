// The port every page script serves its api on, as it runs inside a site's page: only the app's
// origin, only this install's key, and one listener per document however often it is installed.
import { afterEach, describe, expect, test } from 'vitest'

import { expose } from 'osra'

import { installSessionServer, randomNonce } from '../../../src/tracking/page-install'
import { SESSION_PORT_MESSAGE } from '../../../src/tracking/session-frames'

type AskApi = { ask: (arg: { question: string }) => Promise<string> }

const page = (): EventTarget & Record<symbol, unknown> => new EventTarget() as EventTarget & Record<symbol, unknown>

const fakeApi = (answer: string): AskApi => ({ ask: async ({ question }) => `${question}: ${answer}` })

const open: MessagePort[] = []
afterEach(() => { while (open.length) open.pop()!.close() })

/** Hands `target` a port the way the app does, and answers what is served on the app's end, if anything. */
const handPort = async (target: EventTarget, { key, origin = 'https://anime.fkn.app' }: { key: string, origin?: string }) => {
  const { port1, port2 } = new MessageChannel()
  open.push(port1, port2)
  target.dispatchEvent(new MessageEvent('message', { data: { type: SESSION_PORT_MESSAGE, key }, origin, ports: [port2] }))
  const served = expose<AskApi>({}, { transport: port1 })
  const silent = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 300))
  const remote = await Promise.race([served, silent])
  return remote ? await remote.ask({ question: 'who' }) : undefined
}

describe('the port the page serves on', () => {
  test("serves the page's api over the port the app sends with this install's key, from the app's origin", async () => {
    const target = page()
    expect(installSessionServer({ appOrigin: 'https://anime.fkn.app', key: 'k1' }, target, fakeApi('served'))).toBe('installed')

    expect(await handPort(target, { key: 'k1', origin: 'https://elsewhere.test' }), 'another origin').toBeUndefined()
    expect(await handPort(target, { key: 'k0' }), 'another key').toBeUndefined()
    expect(await handPort(target, { key: 'k1' })).toBe('who: served')
  })

  // the frame reports a document twice when the page comes back from the back/forward cache
  test('installing again in the same document swaps the key and adds no second listener', async () => {
    const target = page()
    let listeners = 0
    const add = target.addEventListener.bind(target)
    target.addEventListener = ((...args: Parameters<typeof add>) => { listeners++; add(...args) }) as typeof add

    installSessionServer({ appOrigin: 'https://anime.fkn.app', key: 'k1' }, target, fakeApi('served'))
    expect(installSessionServer({ appOrigin: 'https://anime.fkn.app', key: 'k2' }, target, fakeApi('second'))).toBe('reinstalled')

    expect(listeners).toBe(1)
    expect(await handPort(target, { key: 'k1' }), 'the earlier install').toBeUndefined()
    expect(await handPort(target, { key: 'k2' })).toBe('who: served')
  })
})

test('a nonce is never the same twice', () => {
  const nonces = new Set(Array.from({ length: 100 }, randomNonce))
  expect(nonces.size).toBe(100)
})
