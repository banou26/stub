// Whether the link preview's copies of stub's worker (functions-lib/preview.js, from vite.preview.config.ts) can be
// collected, measured in workerd: one copy is built per request, then a full collection is forced over the inspector
// and the heap read. Exits 1 when the heap grows by more than LIMIT_MB across the copies.
//
// As a copy's modules load, @fkn/lib's file systems listen for `pagehide` through the bare `addEventListener`, and its
// page channel listens on `self`. On the Worker's global either keeps the whole copy alive, about 11 MB a copy here and
// 18 MB after a preview (measured 2026-10-23), which is why the factory shadows both. Run after `npm run build`:
//
//   node scripts/preview-heap.mjs [the directory holding preview.js, default functions-lib]
//
// It starts `wrangler dev` (WRANGLER names the binary, default `npx wrangler`) on a scratch Worker, asks no upstream,
// and stops it on exit.
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const COPIES = 12
const LIMIT_MB = 4
const PORT = 8797
const INSPECTOR = 9237

const from = resolve(process.argv[2] ?? 'functions-lib')
const dir = mkdtempSync(join(tmpdir(), 'stub-preview-heap-'))
copyFileSync(join(from, 'preview.js'), join(dir, 'preview.js'))
writeFileSync(join(dir, 'entry.mjs'), `
import { createPreview } from './preview.js'

export default {
  fetch: () => new Response(typeof createPreview().answer),
}
`)

const [command, ...args] = (process.env.WRANGLER ?? 'npx wrangler').split(' ')
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

const until = async (ready, what, ms = 60_000) => {
  for (const started = Date.now(); Date.now() - started < ms; await new Promise(resolve => setTimeout(resolve, 200))) {
    if (await ready().catch(() => false)) return
  }
  throw new Error(`${what} within ${ms / 1000} s\n${log}`)
}

try {
  await until(async () => (await fetch(`http://127.0.0.1:${PORT}/`)).ok, 'no answer from wrangler dev')
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
    waiting.set(n, resolve)
    socket.send(JSON.stringify({ id: n, method, params }))
    setTimeout(() => waiting.delete(n) && reject(new Error(`the inspector did not answer ${method}`)), 30_000)
  })
  // workerd's inspector answers no `HeapProfiler.collectGarbage`; a heap snapshot collects first, and its chunks are dropped
  const collectedMB = async () => {
    await call('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
    const { result } = await call('Runtime.getHeapUsage')
    return Math.round(result.usedSize / 1e5) / 10
  }
  await call('HeapProfiler.enable')
  const heaps = []
  for (let copy = 0; copy < COPIES; copy++) {
    const answered = await fetch(`http://127.0.0.1:${PORT}/`)
    if (await answered.text() !== 'function') throw new Error(`copy ${copy + 1} was not built: ${answered.status}`)
    heaps.push(await collectedMB())
  }
  const grown = Math.round((heaps.at(-1) - heaps[0]) * 10) / 10
  console.log(JSON.stringify({ copies: COPIES, heapMB: heaps, grownMB: grown, limitMB: LIMIT_MB }))
  socket.close()
  process.exitCode = grown > LIMIT_MB ? 1 : 0
} finally {
  stop()
}
