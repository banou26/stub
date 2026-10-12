// Proves on a live site that `spread` requests leave from more than one FKN node while tied requests
// stay on one, from a single session.
//
// The broker's data plane is a SHARED worker on fkn.app inside a cross-origin iframe, and neither
// page-level request events nor `page.workers()` see it (measured 2026-09-06: zero proxied requests
// captured either way while the page was busy). A browser-level CDP session attached to every worker
// target in the legacy non-flat mode does see them, headers included, so that is what this reads.
//
// Run from inside the repo: an ESM script elsewhere cannot resolve `playwright`.
//   STUB_ORIGIN=http://localhost:4560 node scripts/check-spread-nodes.mjs
import { chromium } from 'playwright'

const origin = process.env.STUB_ORIGIN ?? 'https://anime.fkn.app'
const NODE = /^([a-z]{2}-[a-z]{3}-\d{3})\.fkn\.app$/
// the upstreams stub asks to spread; everything else is expected on the session's own node
const SPREAD_UPSTREAMS = /^graphql\.anilist\.co$/

const browser = await chromium.launch({
  headless: true,
  executablePath: '/etc/profiles/per-user/banou/bin/google-chrome-stable',
  args: ['--mute-audio'],
})
const page = await browser.newPage()
const cdp = await browser.newBrowserCDPSession()

// upstream host -> node -> count
const seen = new Map()
let nextId = 1
cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
  const event = JSON.parse(message)
  if (event.method !== 'Network.requestWillBeSent') return
  const node = NODE.exec(new URL(event.params.request.url).hostname)?.[1]
  if (!node) return
  const headers = event.params.request.headers
  // a CORS preflight or a probe carries no target and is not a proxied request
  const upstream = headers['fkn-proxy-hostname'] ?? headers['Fkn-Proxy-Hostname']
  if (!upstream) return
  const nodes = seen.get(upstream) ?? new Map()
  nodes.set(node, (nodes.get(node) ?? 0) + 1)
  seen.set(upstream, nodes)
})
cdp.on('Target.targetCreated', async ({ targetInfo }) => {
  if (!['worker', 'shared_worker', 'service_worker'].includes(targetInfo.type)) return
  try {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false })
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: nextId++, method: 'Network.enable', params: {} }) })
  } catch {}
})
await cdp.send('Target.setDiscoverTargets', { discover: true })

await page.goto(origin, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(40_000)
await browser.close()

const rows = [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
for (const [upstream, nodes] of rows) console.log(upstream.padEnd(28), [...nodes.entries()].map(([node, count]) => `${node}:${count}`).join('  '))
const total = rows.reduce((sum, [, nodes]) => sum + [...nodes.values()].reduce((a, b) => a + b, 0), 0)
if (total === 0) { console.log('\nRIG BLIND: no proxied request was seen, so nothing here proves anything'); process.exit(2) }

const spreadNodes = new Set(rows.filter(([upstream]) => SPREAD_UPSTREAMS.test(upstream)).flatMap(([, nodes]) => [...nodes.keys()]))
const tiedNodes = new Set(rows.filter(([upstream]) => !SPREAD_UPSTREAMS.test(upstream)).flatMap(([, nodes]) => [...nodes.keys()]))
console.log(`\ntied upstreams used ${tiedNodes.size} node(s), spread upstreams used ${spreadNodes.size} node(s), ${total} proxied requests`)
// the control: if tied traffic itself moved between nodes, a second node under spread proves nothing
if (tiedNodes.size !== 1) { console.log('CONTROL FAILED: tied traffic was not on exactly one node'); process.exit(3) }
if (spreadNodes.size < 2) { console.log('NOT SPREAD: anilist requests all went to one node'); process.exit(1) }
console.log('SPREAD OK')
