/**
 * Is the `similarMedia` machinery reachable and observable on a deployed build? Opens one run's page
 * and reads the worker's `similarMedia: ` console lines: the funnel in worker/extractor.ts prints one
 * line per ask for EVERY caller (`asked`, then `answered`, `refused`, `declined` or `joined`), and the
 * consumer in worker/similar-consumer.ts prints what it did with the answer (`claimed`,
 * `refused-by-title`, `refused-by-origin`, `refused`, `declined`, `settled`, `skipped`, `deferred`,
 * `merged`, `dropped`).
 *
 *   node scripts/check-similar-media.mjs [origin] [uri] [--expect <sha7>]
 *   origin default https://anime.fkn.app
 *   uri default    ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)   Mushoku Tensei season 3
 *
 * THE URI IS PUSHED RAW, never through encodeURIComponent: a percent-encoded path segment reaches the
 * route undecoded and, before 2e7057a, the page never subscribed. Three probe scripts were blinded by
 * exactly this on 2026-09-05 and reported a silent page that was in fact never asked.
 *
 * WHAT A PASS MEANS. The funnel logs every caller, so a page where anilist's own ask (its Crunchyroll
 * mapping goes through ctx.similarMedia) claims the handle before the consumer plans is a PASS through
 * the `by 'anilist'` line, and the consumer summary says whether `'app'` asked. Deliberate: the check
 * measures whether the machinery is reachable and observable on the deployed build, which is what was
 * impossible before these lines existed. It does not judge the answer.
 *
 * CONTROLS, all before navigation, any failure exits 2 rather than reporting a result: the page has a
 * dedicated worker (the store lives there); a `console.warn` evaluated INSIDE that worker and one in
 * the page both arrive on the page's console hook with the prefix intact (Chromium delivers a
 * dedicated worker's console calls on the page's `console` event); and a line carrying the token
 * mid-sentence is NOT read as a similarMedia line. With --expect, a version line lacking the sha
 * exits 2 too.
 *
 * A `declined ... (timeout|error)` line ends an ask too: the poll stops on it rather than waiting out the
 * 60 s, and the verdict is a FAIL naming the decline, since the funnel already said what happened.
 * The other declines (ceiling, no-evidence, bad-show-id, not-implemented) are printed and never end
 * the poll: the consumer retries a ceiling on the next read.
 *
 * EXIT CODES: 0 PASS (an asked pair whose origin the header renders reached an answer or a refusal),
 * 1 FAIL (no ask, no answer or refusal within 60 s, every ask ended in a timeout or an error, or the
 * header renders none of the asked origins), 2 a control failed or the version did not match, so
 * nothing was measured.
 *
 * Headless and muted: it reads the console and the DOM and nothing else.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const expectAt = args.indexOf('--expect')
const EXPECT = expectAt >= 0 ? args[expectAt + 1] : undefined
// without --expect, expectAt is -1 and `index !== expectAt + 1` would drop the first positional argument
const positional = args.filter((arg, index) => arg !== '--expect' && !(expectAt >= 0 && index === expectAt + 1))
const ORIGIN = positional[0] ?? 'https://anime.fkn.app'
const URI = positional[1] ?? 'ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)'
const chrome = process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome-stable'], { encoding: 'utf-8' }).trim()

const POLL_MS = 1000
const DEADLINE_MS = 60_000
const HEADER_SETTLE_MS = 15_000

// the hosts of PACKAGE_ORIGIN_MAP (src/sources/justwatch/id.ts), keyed the way a rendered url reads;
// a copy of check-part-of-links.mjs's table, the two scripts are separate files by design
const HOST_ORIGIN = {
  'netflix.com': 'nf',
  'hulu.com': 'hulu',
  'disneyplus.com': 'disney',
  'tv.apple.com': 'appletv',
  'crunchyroll.com': 'cr',
  'amazon.com': 'amazon',
  'max.com': 'hbo',
  'peacocktv.com': 'peacock',
  'paramountplus.com': 'paramount',
  'fubo.tv': 'fubo',
  'hidive.com': 'hidive',
  'tubitv.com': 'tubi',
  'therokuchannel.roku.com': 'roku',
  'pluto.tv': 'pluto',
  'watch.plex.tv': 'plex',
  'hoopladigital.com': 'hoopla',
  'starz.com': 'starz',
  'amcplus.com': 'amcplus',
  'philo.com': 'philo',
}
const hostOf = href => { try { return new URL(href).hostname } catch { return '' } }
const originOfHost = host => {
  const match = Object.keys(HOST_ORIGIN).find(known => host === known || host.endsWith(`.${known}`))
  return match ? HOST_ORIGIN[match] : undefined
}
const basename = url => { try { return new URL(url).pathname.split('/').pop() || url } catch { return url } }

const isLine = text => /^similarMedia: /.test(text)
const ASKED = /^similarMedia: asked (\S+) (\S+) by '([^']*)'/
const ANSWERED = /^similarMedia: answered (\S+) to '[^']*' for (\S+) (\S+)$/
const REFUSED = /^similarMedia: refused (\S+) (\S+) to '/
const DECLINED = /^similarMedia: declined (\S+) (\S+) to '[^']*' \((\S+)/
const CONSUMER = /^similarMedia: consumer (claimed|refused-by-title|refused-by-origin|refused|declined|settled|skipped|asked|deferred|merged|dropped) /
// a timeout or an error is the end of that ask; the consumer retries it on a later read, which this check does not wait for
const FINAL_DECLINE = new Set(['timeout', 'error'])

const pairKey = (origin, showId) => `${origin} ${showId}`
const parse = lines => {
  const asked = new Map()
  const terminal = new Map()
  const finalDeclines = new Map()
  const consumer = { claimed: 0, 'refused-by-title': 0, 'refused-by-origin': 0, refused: 0, declined: 0, settled: 0, skipped: 0, asked: 0, deferred: 0, merged: 0, dropped: 0 }
  for (const { text } of lines) {
    let match
    if ((match = ASKED.exec(text))) asked.set(pairKey(match[1], match[2]), { origin: match[1], showId: match[2], caller: match[3] })
    else if ((match = ANSWERED.exec(text))) terminal.set(pairKey(match[2], match[3]), `answered ${match[1]}`)
    else if ((match = REFUSED.exec(text))) terminal.set(pairKey(match[1], match[2]), 'refused')
    else if ((match = DECLINED.exec(text))) { if (FINAL_DECLINE.has(match[3])) finalDeclines.set(pairKey(match[1], match[2]), `declined (${match[3]})`) }
    else if ((match = CONSUMER.exec(text))) consumer[match[1]] += 1
  }
  return { asked, terminal, finalDeclines, consumer }
}
// every asked pair has either an answer or a refusal, or a timeout or an error; nothing more is coming without another read
const everyAskEnded = ({ asked, terminal, finalDeclines }) =>
  asked.size > 0 && [...asked.keys()].every(key => terminal.has(key) || finalDeclines.has(key))

const browser = await chromium.launch({ headless: true, executablePath: chrome, args: ['--mute-audio'] })
try {
  const page = await browser.newPage()
  const lines = []
  const startedAt = Date.now()
  page.on('console', msg => lines.push({ at: Date.now(), text: msg.text(), url: msg.location()?.url ?? '' }))

  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(8000)
  const version = await page.evaluate(() => document.body.innerText.match(/v[\d.]+ [0-9a-f]{7}/)?.[0] ?? '(none)')
  console.log(`${ORIGIN}  ${version}\n`)
  if (EXPECT && !version.includes(EXPECT)) {
    console.log(`VERSION MISMATCH: expected ${EXPECT} in '${version}', so this build is not the one under test`)
    process.exitCode = 2
  } else {
    const workers = page.workers()
    const controls = []
    if (!workers.length) controls.push('no dedicated worker on the page (the store lives in one)')
    else {
      await workers[0].evaluate(() => console.warn('similarMedia: control alive in the worker'))
      await page.evaluate(() => console.warn('similarMedia: control alive in the page'))
      await page.evaluate(() => console.warn('probe control with no prefix, the token similarMedia: sits mid-line'))
      await page.waitForTimeout(500)
      const texts = lines.map(line => line.text)
      if (!texts.some(text => text === 'similarMedia: control alive in the worker' && isLine(text))) controls.push('the worker console line did not arrive with its prefix')
      if (!texts.some(text => text === 'similarMedia: control alive in the page' && isLine(text))) controls.push('the page console line did not arrive with its prefix')
      const negative = texts.find(text => text.startsWith('probe control with no prefix'))
      if (!negative) controls.push('the negative control line did not arrive')
      else if (isLine(negative)) controls.push('a mid-line token was read as a similarMedia line')
    }
    for (const control of controls) console.log(`CONTROL FAILED: ${control}`)
    if (controls.length) {
      process.exitCode = 2
    } else {
      console.log('controls: worker present, worker and page lines arrive with the prefix, a mid-line token is not a line\n')
      const controlTexts = new Set(['similarMedia: control alive in the worker', 'similarMedia: control alive in the page'])
      for (let i = lines.length - 1; i >= 0; i--) {
        if (controlTexts.has(lines[i].text) || lines[i].text.startsWith('probe control with no prefix')) lines.splice(i, 1)
      }

      // RAW, never encodeURIComponent: a percent-encoded segment reaches the route undecoded and blinded three probes on 2026-09-05
      await page.evaluate(url => {
        history.pushState({}, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, '/media/' + URI)

      const navigatedAt = Date.now()
      let parsed = parse([])
      while (Date.now() - navigatedAt < DEADLINE_MS) {
        await page.waitForTimeout(POLL_MS)
        parsed = parse(lines)
        if ([...parsed.asked.keys()].some(key => parsed.terminal.has(key))) break
        if (everyAskEnded(parsed)) break
      }

      // the media header's origin row; the Episode rows use the same class names one level deeper,
      // which the child combinators exclude. A claimed row lands as a union and the header re-renders
      // a beat later, so the header is given up to HEADER_SETTLE_MS to show an asked origin before it
      // is judged: read in the same tick as the terminal line it rendered hulu alone and failed a page
      // whose crunchyroll link arrived a second later (2026-09-05)
      const readHeader = () => page.evaluate(() =>
        [...document.querySelectorAll('.modal > .content > .header > .origins > a.origin')].map(a => a.href)
      )
      const settleUntil = Date.now() + HEADER_SETTLE_MS
      let links = await readHeader()
      let headerOrigins = new Set(links.map(hostOf).map(originOfHost).filter(Boolean))
      while (Date.now() < settleUntil && ![...parsed.asked.values()].some(ask => headerOrigins.has(ask.origin))) {
        await page.waitForTimeout(500)
        parsed = parse(lines)
        links = await readHeader()
        headerOrigins = new Set(links.map(hostOf).map(originOfHost).filter(Boolean))
      }

      const similarLines = lines.filter(line => isLine(line.text))
      for (const line of similarLines) {
        console.log(`+${((line.at - startedAt) / 1000).toFixed(1)}s  ${basename(line.url)}  ${line.text}`)
      }
      const declined = similarLines.map(line => DECLINED.exec(line.text)).filter(Boolean)
      if (declined.length) console.log(`\ndeclined (never terminal): ${declined.map(match => `${match[1]} ${match[2]} (${match[3]})`).join('; ')}`)
      console.log(`\nLINKS (${links.length})`)
      for (const link of links) console.log(`   ${link}`)
      console.log(`\nasked pairs: ${parsed.asked.size ? [...parsed.asked.values()].map(a => `${a.origin} ${a.showId} by '${a.caller}'`).join('; ') : 'none'}`)
      console.log(`terminal pairs: ${parsed.terminal.size ? [...parsed.terminal.entries()].map(([key, how]) => `${key} ${how}`).join('; ') : 'none'}`)
      const c = parsed.consumer
      console.log(`consumer: claimed ${c.claimed}, refused-by-title ${c['refused-by-title']}, refused-by-origin ${c['refused-by-origin']}, refused ${c.refused}, declined ${c.declined}, deferred ${c.deferred}, merged ${c.merged}, dropped ${c.dropped}`)

      const askedOrigins = new Set([...parsed.asked.values()].map(a => a.origin))
      const rendered = [...parsed.asked.entries()].filter(([, ask]) => headerOrigins.has(ask.origin))
      const passing = rendered.filter(([key]) => parsed.terminal.has(key))
      if (passing.length) {
        console.log(`\nPASS: ${passing.map(([key, ask]) => `${key} (by '${ask.caller}') ${parsed.terminal.get(key)}`).join('; ')}`)
        process.exitCode = 0
      } else if (!parsed.asked.size) {
        console.log('\nFAIL: no similarMedia ask was made on this page')
        process.exitCode = 1
      } else if (!rendered.length) {
        console.log(`\nFAIL: asked ${[...askedOrigins].join(', ')} but the header renders none of them`)
        process.exitCode = 1
      } else if (rendered.every(([key]) => parsed.finalDeclines.has(key))) {
        console.log(`\nFAIL: asked ${rendered.map(([key]) => key).join(', ')} but every ask ended in a decline: ${rendered.map(([key]) => `${key} ${parsed.finalDeclines.get(key)}`).join('; ')}`)
        process.exitCode = 1
      } else {
        console.log(`\nFAIL: asked ${rendered.map(([key]) => key).join(', ')} but no answer or refusal arrived within ${DEADLINE_MS / 1000}s`)
        process.exitCode = 1
      }
    }
  }
} finally {
  await browser.close()
}
