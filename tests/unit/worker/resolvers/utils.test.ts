import { expect, test } from 'vite-plus/test'

import { parseHTMLDescription, parseTextDescription } from '../../../../src/worker/resolvers/utils'

// AniDB's summary of Jujutsu Kaisen 2nd Season's episode 6 (anidb 17196), via api.ani.zip on 2026-10-24. TVmaze's
// Black Sails summary ("1715. ...") and three Downton Abbey episode summaries ("1925. ...") open the same way
const YEAR_FIRST = '2018. After finishing a mission one day, Itadori decides to go to the movies, Kugisaki decides to go shopping, and Fushiguro tells them he\'s going home. After parting ways Kugisaki is approached by a woman who suddenly asks if she was with Itadori-kun.'

test('a summary that opens with a year and a full stop keeps the year', () => {
  expect(parseTextDescription(YEAR_FIRST).trim()).toBe(YEAR_FIRST)
  expect(parseHTMLDescription(YEAR_FIRST).trim()).toBe(`<p>${YEAR_FIRST}</p>`)
})

test('the year is kept after blank lines or up to three spaces, and four spaces still start a code block', () => {
  for (const space of [' ', '   ', '\n', ' \n\n  ']) {
    expect(parseTextDescription(`${space}${YEAR_FIRST}`).trim()).toBe(YEAR_FIRST)
  }
  expect(parseHTMLDescription('    2018. After').trim()).toBe('<pre><code>2018. After\n</code></pre>')
})

test('a description is otherwise read as Markdown as before, a numbered list inside it included', () => {
  const description = 'A <i>quiet</i> *town* &lt;3<br>\nIn 2018. [More](https://anilist.co/anime/1)\n\n1. Intro\n2. Outro'

  expect(parseTextDescription(description).trim()).toBe('A quiet town <3\nIn 2018. More\n\nIntro\nOutro')
  expect(parseHTMLDescription(description).trim()).toBe('<p>A <i>quiet</i> <em>town</em> &lt;3<br>\nIn 2018. <a href="https://anilist.co/anime/1">More</a></p>\n<ol>\n<li>Intro</li>\n<li>Outro</li>\n</ol>')
})
