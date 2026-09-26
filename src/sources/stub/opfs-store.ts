// The stub tracker's journal on this device's origin private file system, through @fkn/lib/opfs. Only
// this device, and only this origin: anime.fkn.app and the fkn.app tenant are two devices here.

import type { JournalStore } from '../../tracking/journal'

import { flush, promises as fs, remount } from '@fkn/lib/opfs'

const ROOT = 'tracking/v1'
const DEVICE = `${ROOT}/device.json`
const LOCK = 'stub:tracker-own'
// a lock of its own, since `read` asks for the device id while the journal holds LOCK, and a Web Lock
// is not reentrant
const DEVICE_LOCK = 'stub:tracker-device'

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

const locked = <T>(name: string, work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(name, work)
    : work()

let device: Promise<string> | undefined

export const opfsJournalStore = (): JournalStore => {
  // Minted holding a lock, from a fresh read of the disk. Two tabs a session restore opens together
  // would otherwise each mint an id, and the one whose device.json lost would save to a file nothing
  // reads again. A device file that exists and cannot be read fails the open rather than being
  // replaced, for the same reason.
  const deviceId = () => (device ??= locked(DEVICE_LOCK, async () => {
    // the mirror is loaded once per worker, so another tab's device.json is only seen after a remount
    await remount()
    const saved = await readText(DEVICE)
    const id = saved ? (JSON.parse(saved) as { id?: unknown }).id : undefined
    if (typeof id === 'string' && id) return id
    const minted = crypto.randomUUID()
    await writeText(DEVICE, JSON.stringify({ id: minted }))
    return minted
  }).catch(error => { device = undefined; throw error }))

  return {
    device: deviceId,
    read: async () => {
      await remount()
      return await readText(`${ROOT}/devices/${await deviceId()}.json`)
    },
    write: async (text) => { await writeText(`${ROOT}/devices/${await deviceId()}.json`, text) },
    exclusive: (work) => locked(LOCK, work),
  }
}
