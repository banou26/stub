/**
 * The player COMPONENTS, which pull in `@banou/media-player`, videojs, mux and libav behind them.
 *
 * Importing this module is expensive and only `src/embed.tsx` should do it: it is the only place a
 * player is rendered, and it is its own vite entry loaded in an iframe. Anything that just wants to
 * know WHETHER an origin is playable wants `./playable`, which is a set of strings (see its header
 * for the 353 kB this separation keeps off every page load).
 */
import type { TrackLanguages } from '../utils/track-languages'

import PrimeVideoPlayer from './amazon/player'
import CrunchyrollPlayer from './crunchyroll/player'
import NetflixPlayer from './unogs/player'

export type PlayerProps = {
  url: string
  mediaUri: string
  episodeUri: string
  sourceUri: string
  /** the episode as `episodeLabel` names it, drawn over the picture; it can arrive after the player mounts */
  title?: string
  /** the relays this show was unavailable through earlier in the visit, which the player starts past */
  triedRelays?: readonly string[]
  /** the relays a light check found the episode unlisted on, ahead of one that lists it, which a cloud frame also starts past */
  unlistedRelays?: Promise<readonly string[]>
  /** the audio and subtitle languages the viewer last picked, which the player starts in */
  languages?: TrackLanguages
}

const players: Record<string, (props: PlayerProps) => any> = {
  cr: CrunchyrollPlayer,
  nf: NetflixPlayer,
  amazon: PrimeVideoPlayer
}

export const getPlayer = (origin: string) => players[origin]
