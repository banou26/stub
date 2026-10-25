// What tests/watch-stage.spec.ts builds the watch page with in place of src/worker/index.ts: no source of a
// package plays or picks anything, and no tracker is asked.
export const remotePicker = async () => null
export const remotePlayer = async () => null
export const trackerCheck = async () => {}
export const selectRemoteRelease = async () => null
