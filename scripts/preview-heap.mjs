// Whether the link preview's copies of stub's worker (functions-lib/preview.js, from vite.preview.config.ts) are
// collected once their previews end, measured in workerd: copies answer one after another as the middleware asks them
// (the crawler answered at the deadline, the rest in `waitUntil`), a full collection is forced over the inspector, and
// the heap read. Exits 1 when any case grows the heap by more than LIMIT_MB.
//
// Each case is a way a copy was found to stay alive, about 12 MB a copy (measured 2026-10-23 and 2026-10-24):
//   listeners  @fkn/lib listens on the Worker's global as its modules load, which the factory's shadowed
//              `addEventListener` and `self` stop
//   silent     a source waiting on a relay call its request outlived, which `stop()` in src/preview/fetch.ts ends
//   unnamed    a source waiting for a media nobody names, which a dropped ask ends (`waitForMedia`)
//
// Run after `npm run build`:
//
//   node scripts/preview-heap.mjs [the directory holding preview.js and the two .wasm files, default functions-lib]
//
// It starts `wrangler dev` (WRANGLER names the binary, default `npx -y wrangler@4.152.0`, the one measured) on a
// scratch Worker whose relay is a stand-in, so no upstream is asked, and stops it on exit.
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const COPIES = 4
const LIMIT_MB = 4
const PORT = 8797
const INSPECTOR = 9237
const CASES = [
  { name: 'listeners', uri: 'ag:(offline:mal-61967)', relay: 'missing', settleBy: 3_000 },
  { name: 'silent', uri: 'ag:(anilist:195604)', relay: 'silent', settleBy: 1_000 },
  { name: 'unnamed', uri: 'ag:(none:0)', relay: 'missing', settleBy: 1_000 },
]

const from = resolve(process.argv[2] ?? 'functions-lib')
const dir = mkdtempSync(join(tmpdir(), 'stub-preview-heap-'))
for (const file of ['preview.js', 'frizbee_wasm_bg.wasm', 'sacha_bg.wasm']) copyFileSync(join(from, file), join(dir, file))
writeFileSync(join(dir, 'entry.mjs'), `
import { createPreview } from './preview.js'
import frizbee from './frizbee_wasm_bg.wasm'
import sacha from './sacha_bg.wasm'

const RELAY = 'https://relay.invalid/v0'
let relay = 'missing'
let ended = 0
// 'missing' answers every upstream request 404 at once; 'silent' never answers, as a call cut by its request's end
globalThis.fetch = async (input, init) => {
  if (String(input) === 'https://fkn.app/v1/relays') return Response.json({ relays: [{ id: 'stand-in', region: 'eu', proxyOrigin: RELAY, healthy: true }] })
  if (relay === 'missing') return new Response(null, { headers: { 'fkn-proxy-status': '404' } })
  return new Promise((_, reject) => {
    init?.signal?.throwIfAborted()
    init?.signal?.addEventListener('abort', () => reject(init.signal.reason))
  })
}

export default {
  async fetch(request, env, context) {
    const asked = new URL(request.url).searchParams
    if (asked.has('ended')) return new Response(String(ended))
    if (!asked.has('uri')) return new Response('ready')
    relay = asked.get('relay')
    const { first, last } = createPreview().answer(asked.get('uri'), 'anime', { frizbee, sacha }, { deadline: 0, settleBy: Number(asked.get('settleBy')) })
    context.waitUntil(last.finally(() => { ended++ }))
    await first
    return new Response('answered')
  },
}
`)

const [command, ...args] = (process.env.WRANGLER ?? 'npx -y wrangler@4.152.0').split(' ')
const wrangler = spawn(command, [...args, 'dev', 'entry.mjs', '--port', String(PORT), '--inspector-port', String(INSPECTOR), '--compatibility-date', '2026-10-01', '--local'], {
  cwd: dir,
  detached: true,
  env: { ...process.env, X_LOCAL_OBSERVABILITY: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
wrangler.stdout.on('data', chunk => { log += chunk })
wrangler.stderr.on('data', chunk => { log += chunk })
const stop = () => {
  try { process.kill(-wrangler.pid) } catch {}
  rmSync(dir, { recursive: true, force: true })
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (ready, what, ms = 60_000) => {
  for (const started = Date.now(); Date.now() - started < ms; await wait(200)) {
    if (await ready().catch(() => false)) return
  }
  throw new Error(`${what} within ${ms / 1000} s\n${log}`)
}
const ask = async query => (await fetch(`http://127.0.0.1:${PORT}/?${new URLSearchParams(query)}`)).text()

try {
  await until(async () => await ask({}) === 'ready', 'no answer from wrangler dev')
  const targets = await (await fetch(`http://127.0.0.1:${INSPECTOR}/json`)).json()
  // wrangler's inspector proxy refuses a socket that names no origin
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl, { headers: { origin: `http://127.0.0.1:${INSPECTOR}` } })
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let id = 0
  const waiting = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    waiting.get(message.id)?.(message)
    waiting.delete(message.id)
  }
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    const late = setTimeout(() => waiting.delete(n) && reject(new Error(`the inspector did not answer ${method}`)), 60_000)
    waiting.set(n, message => {
      clearTimeout(late)
      resolve(message)
    })
    socket.send(JSON.stringify({ id: n, method, params }))
  })
  // workerd's inspector answers no `HeapProfiler.collectGarbage`; a heap snapshot collects first, and its chunks are
  // dropped. The inspector keeps what was logged, which a deployed Function has no inspector to do, and a logged error
  // reaches its whole copy, so that goes first.
  const collectedMB = async () => {
    await call('Runtime.discardConsoleEntries')
    await call('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    const { result } = await call('Runtime.getHeapUsage')
    return Math.round(result.usedSize / 1e5) / 10
  }
  await call('Runtime.enable')
  await call('HeapProfiler.enable')
  let asked = 0
  // the crawler is answered at the deadline, and the copy's request ends with its `waitUntil`
  const answer = async ({ uri, relay, settleBy }) => {
    if (await ask({ uri, relay, settleBy }) !== 'answered') throw new Error(`${uri} was not answered\n${log}`)
    asked++
    await until(async () => Number(await ask({ ended: '' })) >= asked, `${uri} did not end`, settleBy + 30_000)
    await wait(500)
  }
  // the first copy compiles what every later one reuses
  await answer(CASES[0])
  const results = []
  for (const kind of CASES) {
    const before = await collectedMB()
    for (let copy = 0; copy < COPIES; copy++) await answer(kind)
    const after = await collectedMB()
    results.push({ case: kind.name, copies: COPIES, beforeMB: before, afterMB: after, grownMB: Math.round((after - before) * 10) / 10 })
  }
  console.log(JSON.stringify({ limitMB: LIMIT_MB, results }))
  socket.close()
  process.exitCode = results.some(({ grownMB }) => grownMB > LIMIT_MB) ? 1 : 0
} finally {
  stop()
}
