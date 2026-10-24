import { expect, test } from 'vite-plus/test'

import { descriptionAs, descriptionHtml, descriptionText } from '../../../../src/worker/resolvers/utils'

// AniDB's summary of Jujutsu Kaisen 2nd Season's episode 6 (anidb 17196), via api.ani.zip on 2026-10-24. TVmaze's
// Black Sails summary ("1715. ...") and three Downton Abbey episode summaries ("1925. ...") open the same way
const YEAR_FIRST = '2018. After finishing a mission one day, Itadori decides to go to the movies, Kugisaki decides to go shopping, and Fushiguro tells them he\'s going home. After parting ways Kugisaki is approached by a woman who suddenly asks if she was with Itadori-kun.'

// AniList's formatting with a script, two handlers, a javascript: link, a style attribute, a style sheet and a form
// among it, and a remote image
const UNSAFE = '<p>A <i style="color:red">quiet</i> <b>town</b>.<br>Its <a href="https://anilist.co/anime/1">sequel</a>, <a href="javascript:window.ran=\'link\'">a link</a> and <span onmouseover="window.ran=\'handler\'">a span</span>.</p>'
  + '<img src="https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg" alt="Its banner"><img src="x" onerror="window.ran=\'onerror\'"><script>window.ran=\'script\'</script>'
  + '<style>.description{color:red}</style><form action="https://e.example/collect"></form>'

test('a summary that opens with a year and a full stop keeps the year', () => {
  expect(descriptionText(YEAR_FIRST).trim()).toBe(YEAR_FIRST)
})

test('the year is kept after blank lines or up to three spaces, and four spaces show no backslash', () => {
  for (const space of [' ', '   ', '\n', ' \n\n  ']) {
    expect(descriptionText(`${space}${YEAR_FIRST}`).trim()).toBe(YEAR_FIRST)
  }
  expect(descriptionText('    2018. After').trim()).toBe('2018. After')
})

test('the plain text reads a description as Markdown, a numbered list inside it included', () => {
  const description = 'A <i>quiet</i> *town* &lt;3 &amp; more<br>\nIn 2018. [More](https://anilist.co/anime/1)\n\n1. Intro\n2. Outro'

  expect(descriptionText(description).trim()).toBe('A quiet town <3 & more\nIn 2018. More\n\nIntro\nOutro')
})

test('the HTML keeps a description\'s formatting, links and remote images, and none of its scripts, handlers, styles or forms', () => {
  expect(descriptionHtml(UNSAFE)).toBe(
    '<p>A <i>quiet</i> <b>town</b>.<br />Its <a href="https://anilist.co/anime/1">sequel</a>, <a>a link</a> and <span>a span</span>.</p>'
    + '<img src="https://s4.anilist.co/file/anilistcdn/media/anime/banner/1.jpg" alt="Its banner" /><img src="x" />',
  )
  expect(descriptionText(UNSAFE)).toBe('A quiet town.Its sequel, a link and a span.')
})

test('the HTML is the source\'s own, its Markdown left as written', () => {
  expect(descriptionHtml('A <i>quiet</i> *town* &lt;3<br>\n\n1. Intro')).toBe('A <i>quiet</i> *town* &lt;3<br />\n\n1. Intro')
})

test('a resolver answers HTML only when asked for it, and plain text otherwise', () => {
  const description = 'A <i>quiet</i> town<script>window.ran = true</script>'

  expect(descriptionAs(description, 'HTML')).toBe('A <i>quiet</i> town')
  for (const type of ['TEXT', null, undefined] as const) expect(descriptionAs(description, type).trim()).toBe('A quiet town')
})
