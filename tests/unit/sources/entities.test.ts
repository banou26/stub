import { expect, test } from 'vite-plus/test'

import { decodeEntities } from '../../../src/sources/entities'

// simkl's api sends `en_title` HTML escaped: "Frieren: Beyond Journey&#039;s End" (api.simkl.com/anime/1990194, 2026-10-07)
test('reads numeric references in both bases and the named ones, and leaves anything else as written', () => {
  expect(decodeEntities('Frieren: Beyond Journey&#039;s End')).toBe("Frieren: Beyond Journey's End")
  expect(decodeEntities('&#x2665; &amp; &quot;x&quot; &lt;b&gt;')).toBe('♥ & "x" <b>')
  expect(decodeEntities('&unknown; & plain')).toBe('&unknown; & plain')
})
