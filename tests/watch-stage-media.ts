/** The show tests/watch-stage.tsx answers, and the address of each of its two episodes on Crunchyroll. */
export const STAGE_MEDIA = 'ag:(anilist:900090)'
export const stageEpisode = (number: number) => `ag:(anilist:900090-${number})`
export const stageWatchPath = (number: number) => `/watch/${STAGE_MEDIA}/${stageEpisode(number)}/cr:GSTAGE${number}`

/** Its show of three episodes, each a torrent of TORRENT_ORIGIN, which the source package at STAGE_PLUGIN plays. */
export const TORRENT_MEDIA = 'ag:(anilist:900091)'
export const TORRENT_ORIGIN = 'spec-torrent'
export const STAGE_PLUGIN = 'npm:@spec/stage-player'
export const torrentEpisode = (number: number) => `ag:(anilist:900091-${number})`
export const torrentWatchPath = (number: number) => `/watch/${TORRENT_MEDIA}/${torrentEpisode(number)}/${TORRENT_ORIGIN}:${number}`

/** Where the package's frame (./watch-stage-plugin.ts) and the player it frames (./watch-stage-ripple.ts) are served. */
export const PLUGIN_ORIGIN = 'https://plugin.test'
export const PLAYER_ORIGIN = 'https://player.test'
