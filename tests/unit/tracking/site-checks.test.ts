import type { MalWhoAmI } from '../../../src/sources/mal/session-page'

import { expect, test } from 'vite-plus/test'

import { anilistSignInState, malSignInState } from '../../../src/tracking/site-checks'

test('AniList: a Viewer is signed in; no Viewer, or a 401 in the status or the body, is signed out', () => {
  expect(anilistSignInState({ status: 200, body: { data: { Viewer: { id: 1 } } } })).toBe('signed-in')
  expect(anilistSignInState({ status: 200, body: { data: { Viewer: null } } })).toBe('signed-out')
  expect(anilistSignInState({ status: 401, body: null })).toBe('signed-out')
  expect(anilistSignInState({ status: 400, body: { data: { Viewer: null }, errors: [{ message: 'Invalid token', status: 401 }] } })).toBe('signed-out')
})

test('AniList: a rate limit or an error is no answer', () => {
  expect(() => anilistSignInState({ status: 429, body: null })).toThrow('AniList asked stub to wait')
  expect(() => anilistSignInState({ status: 500, body: { errors: [{ message: 'Internal Server Error', status: 500 }] } })).toThrow('AniList answered 500')
})

const whoami = (overrides: Partial<MalWhoAmI>): MalWhoAmI => ({ kind: 'whoami', status: 200, url: 'https://myanimelist.net/about.php', page: true, user: null, token: false, blocked: false, retryAfter: null, ...overrides })

test('MyAnimeList: a page naming a user is signed in, one naming nobody is signed out', () => {
  expect(malSignInState(whoami({ user: 'Banou', token: true }))).toBe('signed-in')
  expect(malSignInState(whoami({ user: null }))).toBe('signed-out')
})

test('MyAnimeList: a block, or a page stub could not read, is no answer', () => {
  expect(() => malSignInState(whoami({ blocked: true, status: 429 }))).toThrow('MyAnimeList asked stub to wait')
  expect(() => malSignInState(whoami({ page: false, status: 503 }))).toThrow('MyAnimeList answered 503')
})
