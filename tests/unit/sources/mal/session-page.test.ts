// The page script's half, as it runs inside a myanimelist.net page: what it asks MyAnimeList, against a
// fake fetch answering with the site's recorded pages (./list-fixtures.ts says which are hand-made).
import { describe, expect, test } from 'vitest'

import { MAL_SESSION_URL } from '../../../../src/sources/mal/session'
import { createMalPage, hasViewer, type MalWrite } from '../../../../src/sources/mal/session-page'
import { ABOUT_SIGNED_IN, ABOUT_SIGNED_OUT, COWBOY_BEBOP_CARD, ERRORS_400, ROWS } from './list-fixtures'

const TOKEN = '0f9d61e1cb561a5d581cd53c0db5f26d0cf4f559'

type Call = { input: string, init?: RequestInit }

const respond = (body: string, { status = 200, url = 'https://myanimelist.net/', headers = {} }: { status?: number, url?: string, headers?: Record<string, string> } = {}) => () => {
  const response = new Response(body, { status, headers })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

const signedIn = respond(ABOUT_SIGNED_IN, { url: 'https://myanimelist.net/about.php' })
const signedOut = respond(ABOUT_SIGNED_OUT, { url: 'https://myanimelist.net/about.php' })
const accepted = respond('{}', { url: 'https://myanimelist.net/ownlist/anime/edit.json' })

/** A fetch that answers from a script and records what it was asked. */
const fakeFetch = (steps: (() => Response)[]) => {
  const calls: Call[] = []
  const fetch = async (input: string, init?: RequestInit) => {
    calls.push({ input, init })
    return (steps.shift() ?? respond('nothing scripted', { status: 500 }))()
  }
  return { fetch, calls, posts: () => calls.filter(call => call.init?.method === 'POST') }
}

const counter = () => {
  let n = 0
  return () => `n${++n}`
}

const headersOf = (call: Call) => call.init?.headers as Record<string, string>

const EDIT: MalWrite = { kind: 'edit', fields: { anime_id: 48, status: 2, score: 8 } }

describe('who the session is', () => {
  test('asks a fresh about.php with the cookies, and keeps the token in the page', async () => {
    const { fetch, calls } = fakeFetch([signedIn, signedOut])
    const page = createMalPage({ fetch, nonce: counter() })

    expect(await page.whoami({})).toEqual({
      kind: 'whoami', status: 200, url: 'https://myanimelist.net/about.php', page: true, user: 'viewer', token: true, blocked: false, retryAfter: null,
    })
    expect((await page.whoami({})).user, 'signed out: USER_NAME names nobody').toBeNull()
    expect(calls.map(call => call.input), 'a fresh nonce each time').toEqual(['/about.php?_=n1', '/about.php?_=n2'])
    expect(calls[0]!.init).toMatchObject({ credentials: 'include' })
  })

  test('a page that is not MyAnimeList\'s says so, and a refusal is read as blocked', async () => {
    const { fetch } = fakeFetch([
      respond('<html>Request blocked</html>', { status: 403 }),
      respond('', { status: 429, headers: { 'retry-after': '120' } }),
      respond('<html>nothing of MyAnimeList</html>'),
    ])
    const page = createMalPage({ fetch, nonce: counter() })

    expect(await page.whoami({})).toMatchObject({ page: false, blocked: true, user: null })
    expect(await page.whoami({})).toMatchObject({ blocked: true, retryAfter: 120 })
    expect(await page.whoami({})).toMatchObject({ page: false, blocked: false })
  })
})

test("an anime's card is the page the session frame holds, for that id, asked with the cookies and a fresh nonce", async () => {
  const { fetch, calls, posts } = fakeFetch([respond(COWBOY_BEBOP_CARD), respond(COWBOY_BEBOP_CARD)])
  const page = createMalPage({ fetch, nonce: counter() })

  expect(await page.anime({ id: 1 })).toMatchObject({ kind: 'answer', status: 200, text: COWBOY_BEBOP_CARD })
  await page.anime({ id: 52991 })
  const held = new URL(MAL_SESSION_URL)
  expect(calls.map(call => call.input)).toEqual([`${held.pathname}${held.search}&_=n1`, '/includes/ajax.inc.php?t=64&id=52991&_=n2'])
  expect(calls[0]!.init).toMatchObject({ credentials: 'include' })
  expect(posts()).toEqual([])
})

describe("the viewer's list", () => {
  test('asks load.json the way the list page does, with the order named and the name encoded', async () => {
    const body = JSON.stringify(ROWS)
    const { fetch, calls } = fakeFetch([respond(body, { url: 'https://myanimelist.net/animelist/a%20b/load.json' })])
    const page = createMalPage({ fetch, nonce: counter() })

    const answer = await page.list({ user: 'a b', status: 7, order: 1, offset: 300 })

    expect(calls[0]!.input).toBe('/animelist/a%20b/load.json?status=7&order=1&offset=300&_=n1')
    expect(calls[0]!.init).toMatchObject({ credentials: 'include' })
    expect(headersOf(calls[0]!)).toEqual({ 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01' })
    expect(answer).toEqual({ kind: 'answer', status: 200, url: 'https://myanimelist.net/animelist/a%20b/load.json', text: body, retryAfter: null })
  })

  test('hands a refusal back as it came, with its Retry-After', async () => {
    const { fetch } = fakeFetch([respond(ERRORS_400, { status: 400 }), respond('', { status: 429, headers: { 'retry-after': '60' } })])
    const page = createMalPage({ fetch, nonce: counter() })

    expect(await page.list({ user: 'x', status: 7, order: 5, offset: 0 })).toMatchObject({ status: 400, text: ERRORS_400 })
    expect(await page.list({ user: 'x', status: 7, order: 5, offset: 0 })).toMatchObject({ status: 429, retryAfter: 60 })
  })
})

describe('a write', () => {
  test("reads about.php afresh, then posts edit.json as MyAnimeList's own client does", async () => {
    const { fetch, calls } = fakeFetch([signedIn, accepted])
    const page = createMalPage({ fetch, nonce: counter() })

    const answer = await page.write({ user: 'viewer', steps: [EDIT] })

    expect(calls.map(call => call.input)).toEqual(['/about.php?_=n1', '/ownlist/anime/edit.json?_=n2'])
    const post = calls[1]!
    expect(post.init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(headersOf(post)).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' })
    expect(JSON.parse(String(post.init?.body))).toEqual({ anime_id: 48, status: 2, score: 8, csrf_token: TOKEN })
    expect(answer).toEqual({ kind: 'sent', answers: [{ kind: 'answer', status: 200, url: 'https://myanimelist.net/ownlist/anime/edit.json', text: '{}', retryAfter: null }] })
  })

  test('add.json goes the same way', async () => {
    const { fetch, calls } = fakeFetch([signedIn, accepted])
    await createMalPage({ fetch, nonce: counter() }).write({ user: 'viewer', steps: [{ kind: 'add', fields: { anime_id: 1, status: 6, score: 0, num_watched_episodes: 0 } }] })
    expect(calls[1]!.input).toBe('/ownlist/anime/add.json?_=n2')
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({ anime_id: 1, status: 6, score: 0, num_watched_episodes: 0, csrf_token: TOKEN })
  })

  test('every write reads about.php afresh: no token is kept between two', async () => {
    const { fetch, calls } = fakeFetch([signedIn, accepted, signedIn, accepted])
    const page = createMalPage({ fetch, nonce: counter() })

    await page.write({ user: 'viewer', steps: [EDIT] })
    await page.write({ user: 'viewer', steps: [EDIT] })

    expect(calls.map(call => call.input.split('?')[0])).toEqual(['/about.php', '/ownlist/anime/edit.json', '/about.php', '/ownlist/anime/edit.json'])
  })

  // the recorded signed-out about.php still carries a token, so a token proves nothing about the session
  test('posts nothing when the fresh about.php names nobody, although it carries a token', async () => {
    const { fetch, posts } = fakeFetch([signedOut])
    const answer = await createMalPage({ fetch, nonce: counter() }).write({ user: 'viewer', steps: [EDIT] })

    expect(answer).toMatchObject({ kind: 'not-sent', whoami: { user: null, token: true, page: true } })
    expect(posts()).toEqual([])
  })

  test('posts nothing when the session is somebody else now', async () => {
    const { fetch, posts } = fakeFetch([signedIn])
    const answer = await createMalPage({ fetch, nonce: counter() }).write({ user: 'someone-else', steps: [EDIT] })

    expect(answer).toMatchObject({ kind: 'not-sent', whoami: { user: 'viewer' } })
    expect(posts()).toEqual([])
  })

  test('posts nothing on a refused about.php, nor on one with no token', async () => {
    const blocked = fakeFetch([respond('', { status: 429 })])
    expect(await createMalPage({ fetch: blocked.fetch, nonce: counter() }).write({ user: 'viewer', steps: [EDIT] })).toMatchObject({ kind: 'not-sent' })
    expect(blocked.posts()).toEqual([])

    const tokenless = fakeFetch([respond(ABOUT_SIGNED_IN.replace(/<meta name='csrf_token'[^>]*>/, ''))])
    expect(await createMalPage({ fetch: tokenless.fetch, nonce: counter() }).write({ user: 'viewer', steps: [EDIT] }))
      .toMatchObject({ kind: 'not-sent', whoami: { user: 'viewer', token: false } })
    expect(tokenless.posts()).toEqual([])
  })

  test('sends its steps in order with no pause, and stops at the first one not accepted', async () => {
    const { fetch, posts } = fakeFetch([signedIn, accepted, respond(ERRORS_400, { status: 400 }), accepted])
    const answer = await createMalPage({ fetch, nonce: counter() }).write({
      user: 'viewer',
      steps: [{ kind: 'finish-rewatch', animeId: 1 }, EDIT, { kind: 'edit', fields: { anime_id: 1, status: 2 } }],
    })

    expect(posts().map(call => call.input)).toEqual(['/includes/ajax.inc.php?t=59&_=n2', '/ownlist/anime/edit.json?_=n3'])
    expect(answer).toMatchObject({ kind: 'sent', answers: [{ status: 200 }, { status: 400, text: ERRORS_400 }] })
  })

  test('a write MyAnimeList refused is posted once, never again', async () => {
    const { fetch, posts } = fakeFetch([signedIn, respond('', { status: 403 }), accepted])
    const answer = await createMalPage({ fetch, nonce: counter() }).write({ user: 'viewer', steps: [EDIT] })

    expect(posts()).toHaveLength(1)
    expect(answer).toMatchObject({ kind: 'sent', answers: [{ status: 403 }] })
  })

  test('a write that ended on the sign-in page stops there', async () => {
    const { fetch, posts } = fakeFetch([signedIn, respond('<html>login</html>', { url: 'https://myanimelist.net/login.php?error=login_required' }), accepted])
    await createMalPage({ fetch, nonce: counter() }).write({ user: 'viewer', steps: [EDIT, EDIT] })
    expect(posts()).toHaveLength(1)
  })

  test("delete and the finish of a rewatch send MyAnimeList's form bodies", async () => {
    const { fetch, posts } = fakeFetch([signedIn, accepted, accepted])
    await createMalPage({ fetch, nonce: counter() }).write({ user: 'viewer', steps: [{ kind: 'finish-rewatch', animeId: 1 }, { kind: 'delete', animeId: 21 }] })

    const [finish, remove] = posts()
    expect(finish!.input).toBe('/includes/ajax.inc.php?t=59&_=n2')
    expect(finish!.init?.body).toBe(`aid=1&csrf_token=${TOKEN}`)
    expect(headersOf(finish!)).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' })
    expect(remove!.input).toBe('/ownlist/anime/21/delete?_=n3')
    expect(remove!.init?.body).toBe(`csrf_token=${TOKEN}`)
  })
})

test('whether the page names a viewer, from what it rendered alone', () => {
  expect(hasViewer({ MAL: { USER_NAME: 'viewer' } })).toBe(true)
  expect(hasViewer({ MAL: { USER_NAME: '' } })).toBe(false)
  expect(hasViewer({}), 'a page with no window.MAL, the session fragment or another site').toBe(false)
})
