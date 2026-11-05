// A media modal shows the works it is related to, with the relation named and the right way round.
//
// The whole path only exists end to end: AniList names the edges, the store flattens and merges them
// across a cluster, and the modal draws them. None of that is reachable from a unit test, and the one
// failure it is really guarding against is silent. `relationType` defaults to AniList's VERSION 1
// vocabulary, which collapses SOURCE into ADAPTATION, so a query missing `(version: 2)` labels the
// novel a show was adapted FROM as something the show is an adaptation OF. Every card still renders.
//
// THE CONTROLS, because "some cards appeared" proves very little:
//
//   - a relation must be one the schema declares, not the raw enum spelling and not the catch-all,
//     since unknown values are deliberately carried as "Related" and would otherwise pass as wording;
//   - a card must link somewhere OTHER than the page it is on, which is what catches a self edge
//     surviving the cluster filter;
//   - the set must contain at least one NON-anime work. A franchise's source novel is the relation a
//     viewer most wants and the one most easily dropped, because `MediaType` cannot spell it and the
//     format has to travel on the edge instead.
//
// A run that finds no media with relations at all is INCONCLUSIVE (exit 2) rather than green: only
// AniList supplies these today, and its public API is off, so the whole row rides the frontend
// fallback in src/sources/anilist/frontend.ts. That being down looks exactly like a page with no
// relations.
//
//   npm run dev            # serves on 4560
//   node scripts/check-media-relations.mjs
//
// Run it from INSIDE the repo: an ESM script resolves bare specifiers against its own location.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const ORIGIN = process.env.STUB_ORIGIN ?? 'http://localhost:4560'

const chromePath = () => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (!existsSync('/etc/NIXOS')) return undefined
  for (const bin of ['google-chrome-stable', 'chromium']) {
    try { return execFileSync('which', [bin], { encoding: 'utf-8' }).trim() } catch {}
  }
  return undefined
}

let failures = 0
const ok = (label, detail = '') => console.log(`  ok    ${label}${detail ? `  (${detail})` : ''}`)
const bad = (label, detail = '') => { failures++; console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ''}`) }
const check = (condition, label, detail) => condition ? ok(label, detail) : bad(label, detail)

/** The wording the app is allowed to print, derived from the schema so the two cannot drift. */
const wording = () => {
  const schema = readFileSync(new URL('../src/worker/resolvers/media/schema.gql', import.meta.url), 'utf-8')
  const block = schema.match(/enum MediaRelation \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('MediaRelation is not in the schema, so this check measures nothing')
  return [...block[1].matchAll(/^\s*([A-Z_]+)\s*$/gm)].map(m => m[1])
}

const main = async () => {
  console.log(`[media relations] ${ORIGIN}`)
  const relations = wording()
  console.log(`  ...   the schema declares ${relations.length} relations`)

  const browser = await chromium.launch({ headless: true, executablePath: chromePath(), args: ['--mute-audio'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' })

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('a[href^="/media/"]').first().waitFor({ timeout: 90_000 })
  const hrefs = await page.locator('a[href^="/media/"]').evaluateAll(links =>
    [...new Set(links.map(link => link.getAttribute('href')).filter(Boolean))])

  let found
  for (const href of hrefs.slice(0, 8)) {
    await page.goto(`${ORIGIN}${href}`, { waitUntil: 'domcontentloaded' })
    let count = 0
    for (let attempt = 0; attempt < 60 && !count; attempt++) {
      count = await page.locator('.relation-card').count()
      if (!count) await page.waitForTimeout(500)
    }
    if (!count) continue
    await page.waitForTimeout(2_500)
    const cards = await page.locator('.relation-card').evaluateAll(nodes => nodes.map(node => ({
      relation: node.querySelector('.relation')?.textContent?.trim() ?? '',
      title: node.querySelector('.title')?.textContent?.trim() ?? '',
      meta: node.querySelector('.meta')?.textContent?.trim() ?? '',
      href: node.getAttribute('href') ?? '',
      cover: Boolean(node.querySelector('img.cover')?.getAttribute('src')),
    })))
    found = { href, cards }
    break
  }

  if (!found) {
    await browser.close()
    console.log('\nINCONCLUSIVE: no media on the home page named a relation')
    console.log('             only AniList supplies these, and its public api is off, so the row rides')
    console.log('             the frontend fallback in src/sources/anilist/frontend.ts. Check that first.')
    process.exit(2)
  }

  console.log(`\nthe modal names what this work is related to  (${found.href})`)
  const { cards } = found
  for (const card of cards) console.log(`  ...   ${card.relation.padEnd(12)} | ${card.meta.padEnd(24)} | ${card.title.slice(0, 40)}`)

  check(cards.length > 0, 'the row rendered cards', `${cards.length}`)
  check(cards.every(card => card.title), 'every card names the work', `${cards.filter(card => card.title).length} of ${cards.length}`)
  check(cards.every(card => card.cover), 'and shows its cover', `${cards.filter(card => card.cover).length} of ${cards.length}`)

  // the wording, against the schema rather than against a list retyped here
  const spelled = cards.map(card => card.relation)
  check(
    spelled.every(word => word && !/[A-Z]{2,}|_/.test(word)),
    'CONTROL: no card printed the enum as the schema spells it',
    spelled.join(', '),
  )
  check(
    spelled.some(word => word !== 'Related'),
    'CONTROL: at least one relation is a NAMED one, not the catch-all everything falls back to',
    spelled.join(', '),
  )

  // Stub aggregates video, so the row shows nothing you can only read. This USED to assert the
  // opposite, since the light novel a show adapts is the relation that proves the edge format carries
  // what MediaType cannot spell; that proof moved into the graph below, where the books can be shown.
  const reading = cards.filter(card => /Light Novel|Manga|Novel|One Shot/.test(card.meta))
  check(reading.length === 0, 'and nothing you can only read is offered as somewhere to go', reading.map(card => card.meta).join(', ') || 'none')

  const here = decodeURIComponent(new URL(page.url()).pathname)
  check(
    cards.every(card => card.href && decodeURIComponent(card.href) !== here),
    'and no card links back to the page it is on',
    `${cards.filter(card => decodeURIComponent(card.href) === here).length} self links`,
  )
  // A bare source uri opens a page pinned to that one source, which never fans out. The cluster form
  // is what makes the store keep asking.
  check(
    cards.every(card => decodeURIComponent(card.href).startsWith('/media/ag:(')),
    'and every card opens the work as a CLUSTER, not as the one source that named it',
    cards.map(card => decodeURIComponent(card.href)).join(' '),
  )

  console.log('\nthe graph draws the same relations, and a click on one lands')
  const opened = await page.locator('[data-franchise-open]').count()
  check(opened > 0, 'the graph opens from beside the Relations heading', `${opened} button`)
  if (opened) {
    await page.locator('[data-franchise-open]').click()
    await page.waitForTimeout(2_000)
    // show everything, so the source material is on the graph even though the row hides it
    const off = page.locator('[data-franchise] .kinds input:not(:checked)')
    for (let index = await off.count(); index > 0; index--) await off.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(1_200)

    const labels = await page.locator('[data-franchise] .edge-label').allTextContents()
    check(labels.length > 0, 'its arrows are labelled', labels.slice(0, 6).join(', '))
    // THE VERSION-2 TELL, moved here from the row. `relationType` defaults to AniList's older
    // vocabulary, which collapses SOURCE into ADAPTATION, so a query missing `(version: 2)` labels the
    // novel a show was adapted FROM as something the show is an adaptation OF: backwards, silently,
    // on every franchise, with every arrow still drawn.
    check(
      labels.includes('SOURCE') || !labels.includes('ADAPTATION'),
      'CONTROL: source material reads as SOURCE, which only the version 2 vocabulary says',
      [...new Set(labels)].join(', '),
    )

    const node = page.locator('[data-franchise] .node:not(.current)').first()
    const wanted = await node.count() ? decodeURIComponent(await node.getAttribute('href') ?? '') : ''
    check(Boolean(wanted), 'and a work other than this one is on it to click', wanted)
    if (wanted) {
      const box = await node.boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(2_500)
      const landed = decodeURIComponent(new URL(page.url()).pathname)
      // Not equality: the store folds more sources in and the address grows to name them, which is the
      // point of linking to a cluster. What matters is that it MOVED, and moved to the work clicked.
      // the uri alone, without the work's name after it
      const asked = wanted.split('/')[2].replace(/^ag:\(|\)$/g, '')
      check(landed !== here, 'clicking a work in the graph actually goes there', `${here.slice(0, 34)} -> ${landed.slice(0, 46)}`)
      check(landed.includes(asked), 'and lands on the work that was clicked', `asked ${asked}, landed ${landed.slice(0, 60)}`)
      check(landed.startsWith('/media/ag:('), 'as a cluster the store can keep growing', landed.slice(0, 60))
    }
  }

  await browser.close()
  console.log(failures ? `\n${failures} FAILED` : '\nall good')
  process.exit(failures ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(2) })
