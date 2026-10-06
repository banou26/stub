import { expect, test, vi } from 'vite-plus/test'

import { askForToken, checkCrunchyroll, crunchyrollSignInState, TOKEN_REQUEST, TOKEN_URL } from '../../../../src/sources/crunchyroll/sign-in-check'

// what www.crunchyroll.com/auth/v1/token answered signed out, measured 2026-10-07
const SIGNED_OUT = { code: 'auth.obtain_access_token.oauth2_error', context: [{ code: 'auth.obtain_access_token.missing_required_field', field: 'etp_rt' }], error: 'invalid_request' }

test('a 200 is signed in, the measured 400 naming the missing etp_rt cookie is signed out', () => {
  expect(crunchyrollSignInState({ status: 200, body: null })).toBe('signed-in')
  expect(crunchyrollSignInState({ status: 400, body: SIGNED_OUT })).toBe('signed-out')
})

test('anything else is no answer, another 400 included', () => {
  expect(() => crunchyrollSignInState({ status: 400, body: { code: 'auth.obtain_access_token.oauth2_error', context: [] } })).toThrow('Crunchyroll answered 400')
  expect(() => crunchyrollSignInState({ status: 403, body: null })).toThrow('Crunchyroll answered 403')
  expect(() => crunchyrollSignInState({ status: 500, body: null })).toThrow('Crunchyroll answered 500')
})

test('asks with the site\'s own client id, the etp_rt_cookie grant and the cookies the session holds', async () => {
  const send = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 400, ok: false, json: async () => SIGNED_OUT }))
  const answer = await askForToken(TOKEN_REQUEST, send)

  expect(answer).toEqual({ status: 400, body: SIGNED_OUT })
  const [url, init] = send.mock.calls[0]!
  expect(url.split('?')[0]).toBe('https://www.crunchyroll.com/auth/v1/token')
  expect(init.method).toBe('POST')
  expect(init.credentials).toBe('include')
  expect((init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa('noaihdevm_6iyg0a8l0q:')}`)
  const body = new URLSearchParams(init.body as string)
  expect(body.get('grant_type')).toBe('etp_rt_cookie')
  expect(body.get('device_id')).toMatch(/^[0-9a-f-]{36}$/)
})

test('a granted token never leaves the page that asked', async () => {
  const answer = await askForToken(TOKEN_REQUEST, async () => ({ status: 200, ok: true, json: async () => ({ access_token: 'a-token', refresh_token: 'another' }) }))

  expect(answer).toEqual({ status: 200, body: null })
})

// the relay caches POSTs on method, url, headers and body, so two checks on one jar must differ
test('every check carries a nonce of its own, so no cache answers it with an earlier one', async () => {
  const send = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 400, ok: false, json: async () => SIGNED_OUT }))
  vi.stubGlobal('location', { origin: 'https://www.crunchyroll.com' })
  vi.stubGlobal('document', { cookie: 'device_id=a-device-id' })
  try {
    await askForToken(TOKEN_REQUEST, send)
    await askForToken(TOKEN_REQUEST, send)
  } finally {
    vi.unstubAllGlobals()
  }
  const [first, second] = send.mock.calls.map(([url, init]) => JSON.stringify([url, init]))
  expect(first).not.toBe(second)
  expect(new URL(send.mock.calls[0]![0]).searchParams.get('_')).toMatch(/^[0-9a-f-]{36}$/)
})

const fakeFrame = (answer: { status: number, body: unknown }) => {
  const evaluate = vi.fn(async (_fn: unknown, _arg: unknown) => answer)
  const remove = vi.fn()
  const attach = vi.fn(async (_options: Record<string, unknown>) => ({ evaluate }))
  const settle = vi.fn(async () => {})
  const deps = { attach: attach as never, mount: () => ({ iframe: {} as HTMLIFrameElement, remove }), fetch: vi.fn() as never, settle }
  return { evaluate, remove, attach, settle, deps }
}

test('on the cloud, asks from an empty page FKN presents at www.crunchyroll.com, on the cloud jar, loading no page of the site', async () => {
  const { evaluate, remove, attach, settle, deps } = fakeFrame({ status: 400, body: SIGNED_OUT })

  expect(await checkCrunchyroll('cloud', deps)).toBe('signed-out')
  const options = attach.mock.calls[0]![0]
  expect(options.blank).toEqual({ url: 'https://www.crunchyroll.com/' })
  expect(options.cookies).toBe('persistent')
  expect(options.permissions).toEqual([{ category: 'evaluation', reason: expect.any(String) }])
  expect(evaluate).toHaveBeenCalledWith(askForToken, TOKEN_REQUEST)
  expect(settle, 'a refusal sets no cookie to wait for').not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledTimes(1)
})

test('a granted token holds the frame until its cookies can be committed, and then removes it', async () => {
  const { remove, settle, deps } = fakeFrame({ status: 200, body: null })

  expect(await checkCrunchyroll('cloud', deps)).toBe('signed-in')
  expect(settle).toHaveBeenCalledTimes(1)
  expect(remove).toHaveBeenCalledTimes(1)
})

test('a frame that fails to attach is removed, and the failure is the check\'s', async () => {
  const { remove, deps } = fakeFrame({ status: 200, body: null })
  deps.attach = (async () => { throw new Error('FKN did not answer') }) as never

  await expect(checkCrunchyroll('cloud', deps)).rejects.toThrow('FKN did not answer')
  expect(remove).toHaveBeenCalledTimes(1)
})

test('with the extension, asks on the browser\'s own session through FKN\'s fetch, attaching nothing', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 200, ok: true, json: async () => ({ access_token: 'a-token' }) }))
  const { attach, deps } = fakeFrame({ status: 0, body: null })

  expect(await checkCrunchyroll('extension', { ...deps, fetch })).toBe('signed-in')
  expect(fetch.mock.calls[0]![0]).toContain(`${TOKEN_URL}?_=`)
  expect(fetch.mock.calls[0]![1].credentials).toBe('include')
  expect(attach).not.toHaveBeenCalled()
})

const deviceIdSentFrom = async (origin: string, ask: (send: never) => Promise<unknown>) => {
  const send = vi.fn(async (_url: string, _init: RequestInit) => ({ status: 400, ok: false, json: async () => SIGNED_OUT }))
  vi.stubGlobal('location', { origin })
  vi.stubGlobal('document', { cookie: 'ajs_anonymous_id=x; device_id=a-device-id; c=1' })
  try {
    await ask(send as never)
  } finally {
    vi.unstubAllGlobals()
  }
  return new URLSearchParams(send.mock.calls[0]![1].body as string).get('device_id')
}

test('reuses the device id the site keeps in a cookie, so a check is no new device', async () => {
  expect(await deviceIdSentFrom('https://www.crunchyroll.com', send => askForToken(TOKEN_REQUEST, send))).toBe('a-device-id')
})

// with the extension the call runs in stub's own page, whose cookies are stub's and never Crunchyroll's
test('with the extension, sends none of the calling page\'s cookies', async () => {
  const { deps } = fakeFrame({ status: 0, body: null })
  const sent = await deviceIdSentFrom('https://anime.fkn.app', fetch => checkCrunchyroll('extension', { ...deps, fetch }))

  expect(sent).not.toBe('a-device-id')
  expect(sent).toMatch(/^[0-9a-f-]{36}$/)
})
