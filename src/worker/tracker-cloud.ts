// FKN storage for the stub tracker, from the worker. The broker lives on the main thread, so every
// call crosses to it over the `fetch` channel (src/worker.ts), and every answer comes back as a value.

import type { TrackerCloud } from '../tracking/account-link'

import { mainThread } from './fetch'

export const workerTrackerCloud: TrackerCloud = {
  availability: () => mainThread.then(main => main.trackerAvailability()),
  unlocked: () => mainThread.then(main => main.trackerUnlocked()),
  list: () => mainThread.then(main => main.trackerList()),
  read: (path) => mainThread.then(main => main.trackerRead(path)),
  write: (path, text) => mainThread.then(main => main.trackerWrite(path, text)),
}
