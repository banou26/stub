/** The show tests/watch-stage.tsx answers, and the address of each of its two episodes on Crunchyroll. */
export const STAGE_MEDIA = 'ag:(anilist:900090)'
export const stageEpisode = (number: number) => `ag:(anilist:900090-${number})`
export const stageWatchPath = (number: number) => `/watch/${STAGE_MEDIA}/${stageEpisode(number)}/cr:GSTAGE${number}`

/** Its show of three episodes, each a plugin release of PLUGIN_SOURCE_ORIGIN, which the source package at STAGE_PLUGIN plays. */
export const PLUGIN_SOURCE_MEDIA = 'ag:(anilist:900091)'
export const PLUGIN_SOURCE_ORIGIN = 'spec-plugin'
export const STAGE_PLUGIN = 'npm:@spec/stage-player'
export const pluginEpisode = (number: number) => `ag:(anilist:900091-${number})`
export const pluginWatchPath = (number: number) => `/watch/${PLUGIN_SOURCE_MEDIA}/${pluginEpisode(number)}/${PLUGIN_SOURCE_ORIGIN}:${number}`
/** The second plugin release marks no ending, and its episode is on Crunchyroll too, at this address and as long. */
export const CHAPTERLESS_PLUGIN = 2
export const CHAPTERLESS_ON_CRUNCHYROLL = 'https://www.crunchyroll.com/watch/GPLUGIN2'

/** Where the package's frame (./watch-stage-plugin.ts) and the player it frames (./watch-stage-nested-player.ts) are served. */
export const PLUGIN_ORIGIN = 'https://plugin.test'
export const PLAYER_ORIGIN = 'https://player.test'
