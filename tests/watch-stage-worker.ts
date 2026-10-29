import { STAGE_PLUGIN, TORRENT_ORIGIN } from './watch-stage-media'

// What tests/watch-stage.spec.ts builds the watch page with in place of src/worker/index.ts: no source of a
// package picks anything, only the torrents' package plays, and no tracker is asked.
export const remoteAccount = async () => undefined
export const remotePicker = async () => null
export const remotePlayer = async (origin: string) => origin === TORRENT_ORIGIN ? { pluginUri: STAGE_PLUGIN } : null
export const trackerCheck = async () => {}
export const selectRemoteRelease = async () => null
