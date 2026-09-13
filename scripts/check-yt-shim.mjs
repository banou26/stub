// Does the embed actually answer the postMessage protocol this component implements, with NO
// YouTube script on the page? Headless and MUTED; the video is muted at load anyway.
//
// THE CONTROL is the second arm: the identical page with the handshake NOT sent must never see
// onReady. Without it a rig that reports "ready" for any reason would look like a pass.
import { chromium } from 'playwright'
import { readdirSync, readFileSync } from 'node:fs'

const VIDEO = process.argv[2] ?? 'aqz-KE-bpKQ'   // Big Buck Bunny, embeddable

// the BUILT bundle, not the source: the source names iframe_api in the comment that explains why it
// no longer loads it, and a source grep reads that as a failure. The artifact is what ships.
const assets = new URL('../build/assets/', import.meta.url)
const bundled = readdirSync(assets).filter(name => name.endsWith('.js'))
  .filter(name => readFileSync(new URL(name, assets), 'utf8').includes('iframe_api'))
if (bundled.length) { console.log('FAIL: the build still loads iframe_api:', bundled.join(', ')); process.exit(1) }
console.log(`checked ${bundled.length === 0 ? readdirSync(assets).filter(n => n.endsWith('.js')).length : 0} built chunks, none names iframe_api`)

const page = (handshake) => `<!doctype html><meta charset="utf-8"><body>
<script>
const YT = 'https://www.youtube.com'
const params = new URLSearchParams({ enablejsapi:'1', controls:'0', autoplay:'1', mute:'1', loop:'1', playlist:'${VIDEO}', origin: location.origin })
const f = document.createElement('iframe')
f.allow = 'autoplay; encrypted-media'
f.src = YT + '/embed/${VIDEO}?' + params
document.body.append(f)
globalThis.__events = []
addEventListener('message', (e) => {
  if (e.origin !== YT || e.source !== f.contentWindow) return
  let p; try { p = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
  if (p && p.event) globalThis.__events.push(p.event)
  // newer embeds report state through infoDelivery rather than onStateChange, so record both
  if (p && p.info && typeof p.info === 'object' && 'playerState' in p.info) globalThis.__states.push(p.info.playerState)
  if (p && p.event === 'onStateChange' && typeof p.info === 'number') globalThis.__states.push(p.info)
})
globalThis.__states = []
${handshake ? `setInterval(() => f.contentWindow?.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}), YT), 250)` : '/* CONTROL: no handshake */'}
globalThis.__cmd = (func, args=[]) => f.contentWindow?.postMessage(JSON.stringify({event:'command',func,args}), YT)
</script></body>`

const browser = await chromium.launch({ headless: true, executablePath: '/etc/profiles/per-user/banou/bin/google-chrome', args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] })
for (const handshake of [true, false]) {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.route('https://probe.test/', r => r.fulfill({ contentType: 'text/html', body: page(handshake) }))
  await p.goto('https://probe.test/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(12000)
  // COMMANDS are the half the component depends on, so drive one and read the state back.
  // 1 is PLAYING and 2 is PAUSED in the player state enum.
  let playing = null, paused = null
  if (handshake) {
    await p.evaluate(() => globalThis.__cmd('playVideo'))
    await p.waitForTimeout(3000)
    playing = await p.evaluate(() => globalThis.__states.at(-1))
    await p.evaluate(() => globalThis.__cmd('pauseVideo'))
    await p.waitForTimeout(3000)
    paused = await p.evaluate(() => globalThis.__states.at(-1))
    await p.evaluate(() => { globalThis.__cmd('unMute'); globalThis.__cmd('setVolume', [42]) })
    await p.waitForTimeout(1500)
  }
  const events = await p.evaluate(() => globalThis.__events)
  const label = handshake ? 'WITH handshake' : 'CONTROL, no handshake'
  console.log(`${label}: onReady=${events.includes('onReady')} lastStateAfterPlay=${playing} lastStateAfterPause=${paused} events=${[...new Set(events)].join(',') || 'none'}`)
  if (handshake && paused !== 2) console.log('  *** pauseVideo did not take effect: the command path is NOT proven ***')
  await ctx.close()
}
await browser.close()
