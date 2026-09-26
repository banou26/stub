// The stub tracker's journal on this device's origin private file system, through @fkn/lib/opfs. Only
// this device, and only this origin: anime.fkn.app and the fkn.app tenant are two devices here.

import type { JournalStore } from '../../tracking/journal'

import { flush, promises as fs, remount } from '@fkn/lib/opfs'

const ROOT = 'tracking/v1'
const DEVICE = `${ROOT}/device.json`
const LOCK = 'stub:tracker-own'

const readText = async (path: string): Promise<string | undefined> => {
  try {
    const content = await fs.readFile(path, { encoding: 'utf8' })
    return typeof content === 'string' ? content : new TextDecoder().decode(content)
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return undefined
    throw error
  }
}

const writeText = async (path: string, text: string) => {
  await fs.mkdir(path.split('/').slice(0, -1).join('/'), { recursive: true })
  await fs.writeFile(path, text, { encoding: 'utf8' })
  // the mirror writes back to OPFS on a timer, and a worker never sees the page's `pagehide`: a
  // save answers SAVED only once it is on disk
  await flush()
}

let device: Promise<string> | undefined

export const opfsJournalStore = (): JournalStore => {
  const deviceId = () => (device ??= (async () => {
    const saved = await readText(DEVICE).catch(() => undefined)
    const id = saved ? (JSON.parse(saved) as { id?: unknown }).id : undefined
    if (typeof id === 'string' && id) return id
    const minted = crypto.randomUUID()
    await writeText(DEVICE, JSON.stringify({ id: minted }))
    return minted
  })())

  return {
    device: deviceId,
    read: async () => {
      // the mirror is loaded once per worker, so another tab's write is only seen after a remount
      await remount()
      return await readText(`${ROOT}/devices/${await deviceId()}.json`)
    },
    write: async (text) => { await writeText(`${ROOT}/devices/${await deviceId()}.json`, text) },
    exclusive: (work) =>
      typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(LOCK, work)
        : work(),
  }
}
