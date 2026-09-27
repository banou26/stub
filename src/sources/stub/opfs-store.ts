// The stub tracker's files on this device's origin private file system, through @fkn/lib/opfs. Only
// this device, and only this origin: anime.fkn.app and the fkn.app tenant are two devices here. What
// reaches the FKN account is decided by tracking/account-link.ts, never by this file.

import type { TrackerDisk } from '../../tracking/account-link'

import { flush, promises as fs, remount } from '@fkn/lib/opfs'

import { parseSession } from '../../tracking/account-link'

const ROOT = 'tracking/v1'
const SESSION = `${ROOT}/device.json`
const LOCK = 'stub:tracker-own'
// a lock of its own, since the journal asks for the device while holding LOCK, and a Web Lock is not
// reentrant
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

const removeText = async (path: string) => {
  try {
    await fs.unlink(path)
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error
  }
  await flush()
}

const locked = <T>(name: string, work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(name, work)
    : work()

export const opfsTrackerDisk = (): TrackerDisk => ({
  // Read fresh every time, since another tab can start a new device, and minted holding a lock from a
  // fresh read of the disk: two tabs a session restore opens together would otherwise each mint an
  // id, and the one whose device.json lost would save to a file nothing reads again. A device file
  // that exists and cannot be read fails rather than being replaced, for the same reason.
  session: () => locked(DEVICE_LOCK, async () => {
    // the mirror is loaded once per worker, so another tab's device.json is only seen after a remount
    await remount()
    const saved = parseSession(await readText(SESSION))
    if (saved) return saved
    const minted = { id: crypto.randomUUID(), scope: 'device' as const, uploaded: 0 }
    await writeText(SESSION, JSON.stringify(minted))
    return minted
  }),
  setSession: (session) => locked(DEVICE_LOCK, () => writeText(SESSION, JSON.stringify(session))),
  read: async (name) => {
    await remount()
    return await readText(`${ROOT}/${name}`)
  },
  write: (name, text) => writeText(`${ROOT}/${name}`, text),
  remove: (name) => removeText(`${ROOT}/${name}`),
  exclusive: (work) => locked(LOCK, work),
})
