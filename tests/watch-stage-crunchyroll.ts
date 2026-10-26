import { CHAPTERLESS_ON_CRUNCHYROLL } from './watch-stage-media'

// What tests/watch-stage.spec.ts builds the watch page with in place of src/sources/crunchyroll/relay-check.ts: every
// relay lists every episode, and Crunchyroll's length of the chapterless torrent's episode is the file's.
export const unlistedRelays = async () => []
export const crunchyrollLength = async (url: string) => url === CHAPTERLESS_ON_CRUNCHYROLL ? 40 : undefined
