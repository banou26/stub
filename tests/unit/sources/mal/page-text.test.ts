// What stub reads out of myanimelist.net's own pages, on the lines the site rendered.
import { describe, expect, test } from 'vitest'

import { csrfTokenOf, episodesOf, isBlockPage, userNameOf, writeAccepted } from '../../../../src/sources/mal/page-text'
import { ABOUT_CSRF_LINE, ABOUT_SIGNED_IN, ABOUT_SIGNED_OUT, ABOUT_USER_LINES, COWBOY_BEBOP_CARD, ERRORS_400, cardOf } from './list-fixtures'

describe("the page's token and viewer", () => {
  test('reads the CSRF token MyAnimeList renders in single quotes, and in double quotes too', () => {
    expect(csrfTokenOf(ABOUT_CSRF_LINE)).toBe('0f9d61e1cb561a5d581cd53c0db5f26d0cf4f559')
    expect(csrfTokenOf(ABOUT_CSRF_LINE.replaceAll("'", '"'))).toBe('0f9d61e1cb561a5d581cd53c0db5f26d0cf4f559')
    expect(csrfTokenOf('<meta name="csrf_token" content="short">'), 'not a token').toBeUndefined()
    expect(csrfTokenOf('<html></html>')).toBeUndefined()
  })

  test('a USER_NAME of "" is nobody, a missing line is not a MyAnimeList page', () => {
    expect(userNameOf(ABOUT_USER_LINES), 'the recorded line, with no semicolon').toBeNull()
    expect(userNameOf(ABOUT_SIGNED_OUT)).toBeNull()
    expect(userNameOf(ABOUT_SIGNED_IN)).toBe('viewer')
    expect(userNameOf('window.MAL.USER_NAME = "a\\"b";')).toBe('a"b')
    expect(userNameOf('<html><body>Cowboy Bebop</body></html>')).toBeUndefined()
  })
})

test("an anime's hover card names its episode count, one it does not know is none, and a page with none is no card", () => {
  expect(episodesOf(COWBOY_BEBOP_CARD), 'the recorded card').toBe(26)
  expect(episodesOf(cardOf(1_100))).toBe(1_100)
  expect(episodesOf(cardOf('Unknown'))).toBeNull()
  expect(episodesOf(cardOf(0))).toBeNull()
  expect(episodesOf(ABOUT_SIGNED_OUT)).toBeUndefined()
})

describe('a refused client', () => {
  test.each([
    'Request blocked. You have been blocked.',
    'Sorry, your IP has been banned from accessing this site.',
    'Please confirm you are not a bot',
  ])('reads %j as a block page', text => {
    expect(isBlockPage(text)).toBe(true)
  })

  test('the recorded about.php and a JSON error are not block pages', () => {
    expect(isBlockPage(ABOUT_SIGNED_OUT)).toBe(false)
    expect(isBlockPage(ERRORS_400)).toBe(false)
  })
})

test('a write is accepted on a 2xx that did not end on the sign-in page', () => {
  expect(writeAccepted(200, 'https://myanimelist.net/ownlist/anime/edit.json?_=n')).toBe(true)
  expect(writeAccepted(200, 'https://myanimelist.net/login.php?from=%2Fpanel.php&error=login_required')).toBe(false)
  expect(writeAccepted(400, 'https://myanimelist.net/ownlist/anime/edit.json')).toBe(false)
  expect(writeAccepted(302, 'https://myanimelist.net/ownlist/anime/1/delete')).toBe(false)
})
