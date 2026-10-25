/** The show tests/watch-stage.tsx answers, and the address of each of its two episodes on Crunchyroll. */
export const STAGE_MEDIA = 'ag:(anilist:900090)'
export const stageEpisode = (number: number) => `ag:(anilist:900090-${number})`
export const stageWatchPath = (number: number) => `/watch/${STAGE_MEDIA}/${stageEpisode(number)}/cr:GSTAGE${number}`
