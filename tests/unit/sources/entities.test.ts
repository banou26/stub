import { expect, test } from 'vite-plus/test'

import { decodeEntities } from '../../../src/sources/entities'

// simkl's api sends `en_title` HTML escaped: "Frieren: Beyond Journey&#039;s End" (api.simkl.com/anime/1990194, 2026-10-07)
test('reads numeric references in both bases and the named ones, and leaves anything else as written', () => {
  expect(decodeEntities('Frieren: Beyond Journey&#039;s End')).toBe("Frieren: Beyond Journey's End")
  expect(decodeEntities('&#x2665; &amp; &quot;x&quot; &lt;b&gt;')).toBe('♥ & "x" <b>')
  expect(decodeEntities('&unknown; & plain')).toBe('&unknown; & plain')
})

// myanimelist.net's title pages name accented letters and dashes, measured on 57 pages 2026-10-13:
// `na&iuml;ve` on mal:199, `&eacute;` on mal:11617, `&mdash;` on most of them
test('reads the Latin-1 names case by case, and the typographic ones', () => {
  expect(decodeEntities('na&iuml;ve, caf&eacute;, &Eacute;cole, &ntilde;, &yuml;, &times;, &frac12;'))
    .toBe('naïve, café, École, ñ, ÿ, ×, ½')
  expect(decodeEntities('the trio&mdash;Frieren&rsquo;s&hellip;')).toBe('the trio\u2014Frieren\u2019s\u2026')
  expect(decodeEntities('&AMP; &nbsp;')).toBe('&  ')
})
