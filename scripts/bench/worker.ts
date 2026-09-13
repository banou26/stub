/// <reference lib="webworker" />
// The same workload against both variants, so the only difference is where the engine runs.
type Row = Record<string, unknown>
type Api = {
  label: string
  query: (cypher: string, params?: Record<string, unknown>) => Promise<Row[]>
  close: () => Promise<void>
}

const FAT = 'x'.repeat(900)

const openAsync = async (): Promise<Api> => {
  const module = await import('@ladybugdb/wasm-core')
  const engine = (module as unknown as { default?: typeof module }).default ?? module
  engine.setWorkerPath('/lbug_wasm_worker.js')
  const db = new engine.Database(':memory:')
  const conn = new engine.Connection(db)
  await conn.init()
  const query = async (cypher: string, params?: Record<string, unknown>) => {
    if (!params) {
      const result = await conn.query(cypher)
      try {
        if (!result.isSuccess()) throw new Error(await result.getErrorMessage())
        return (await result.getAllObjects()) as Row[]
      } finally { await result.close() }
    }
    const prepared = await conn.prepare(cypher)
    try {
      if (!prepared.isSuccess()) throw new Error(await prepared.getErrorMessage())
      const result = await conn.execute(prepared, params)
      try {
        if (!result.isSuccess()) throw new Error(await result.getErrorMessage())
        return (await result.getAllObjects()) as Row[]
      } finally { await result.close() }
    } finally { await prepared.close() }
  }
  return { label: 'async (separate worker)', query, close: async () => { await conn.close(); await db.close() } }
}

const openSync = async (): Promise<Api> => {
  // loaded from a URL rather than bundled: the file carries the wasm as raw bytes and is 22 MB, the
  // same reason lbug_wasm_worker.js is served rather than imported
  const url = '/lbug_sync.js'
  const module = await import(/* @vite-ignore */ url)
  const engine = (module as { default?: Record<string, unknown> }).default ?? module
  if (typeof (engine as { init?: unknown }).init !== 'function') {
    throw new Error(`sync module shape: moduleKeys=${Object.keys(module).join(',')} defaultKeys=${
      Object.keys((module as { default?: object }).default ?? {}).join(',')} defaultType=${typeof (module as { default?: unknown }).default}`)
  }
  // the ONLY async call in this variant: compiling the wasm. Everything after it is synchronous.
  await engine.init()
  const db = new engine.Database(':memory:')
  // no conn.init() here: unlike the async API the sync Connection connects in its constructor
  const conn = new engine.Connection(db)
  const query = async (cypher: string, params?: Record<string, unknown>) => {
    const result = params ? conn.execute(conn.prepare(cypher), params) : conn.query(cypher)
    try {
      if (!result.isSuccess()) throw new Error(result.getErrorMessage())
      return result.getAllObjects() as Row[]
    } finally { result.close() }
  }
  return { label: 'sync (in this worker)', query, close: async () => { conn.close(); db.close() } }
}

const run = async (api: Api, sizes: { rows: number, points: number, scans: number }) => {
  const t = (label: string, ms: number) => ({ label, ms: Math.round(ms) })
  const marks: { label: string, ms: number }[] = []
  let start = performance.now()
  await api.query('CREATE NODE TABLE Thing(id STRING PRIMARY KEY, by STRING, payload STRING)')
  marks.push(t('schema', performance.now() - start))

  start = performance.now()
  const batch = 500
  for (let i = 0; i < sizes.rows; i += batch) {
    const rows = Array.from({ length: Math.min(batch, sizes.rows - i) }, (_, k) => ({
      id: `n${i + k}`, by: 'bench', payload: FAT,
    }))
    await api.query('UNWIND $rows AS r CREATE (:Thing {id: r.id, by: r.by, payload: r.payload})', { rows })
  }
  marks.push(t(`insert ${sizes.rows} rows`, performance.now() - start))

  start = performance.now()
  for (let i = 0; i < sizes.points; i += 1) {
    await api.query('MATCH (n:Thing {id: $id}) RETURN n.id AS id, n.by AS by', { id: `n${i % sizes.rows}` })
  }
  marks.push(t(`${sizes.points} point queries`, performance.now() - start))

  // THE SAME LOOKUPS, BATCHED. This is the third lever priced against the other two: not a faster
  // round trip and not a smaller row, but one query instead of a thousand.
  start = performance.now()
  const ids = Array.from({ length: sizes.points }, (_, i) => `n${i % sizes.rows}`)
  for (let i = 0; i < ids.length; i += 500) {
    await api.query('UNWIND $ids AS i MATCH (n:Thing {id: i}) RETURN n.id AS id, n.by AS by', { ids: ids.slice(i, i + 500) })
  }
  marks.push(t(`the same ${sizes.points} lookups, BATCHED into ${Math.ceil(sizes.points / 500)} queries`, performance.now() - start))

  start = performance.now()
  let scanned = 0
  for (let i = 0; i < sizes.scans; i += 1) {
    const rows = await api.query('MATCH (n:Thing) WHERE n.by = $by RETURN n.id AS id, n.by AS by, n.payload AS payload', { by: 'bench' })
    scanned += rows.length
  }
  marks.push(t(`${sizes.scans} full scans with the fat column (${scanned} rows)`, performance.now() - start))

  start = performance.now()
  for (let i = 0; i < sizes.scans; i += 1) {
    await api.query('MATCH (n:Thing) WHERE n.by = $by RETURN n.id AS id, n.by AS by', { by: 'bench' })
  }
  marks.push(t(`${sizes.scans} full scans, NARROW projection`, performance.now() - start))

  await api.close()
  return marks
}

self.onmessage = async (event: MessageEvent) => {
  const { arm, sizes } = event.data
  try {
    const opened = performance.now()
    const api = arm === 'sync' ? await openSync() : await openAsync()
    const openMs = Math.round(performance.now() - opened)
    const marks = await run(api, sizes)
    self.postMessage({ ok: true, label: api.label, openMs, marks })
  } catch (error) {
    self.postMessage({ ok: false, error: String((error as Error)?.stack ?? error) })
  }
}
