/**
 * The player COMPONENTS, which pull in `@banou/media-player`, videojs, mux and libav behind them.
 *
 * Importing this module is expensive and only `src/embed.tsx` should do it: it is the only place a
 * player is rendered, and it is its own vite entry loaded in an iframe. Anything that just wants to
 * know WHETHER an origin is playable wants `./playable`, which is a set of strings (see its header
 * for the 353 kB this separation keeps off every page load).
 */
import CrunchyrollPlayer from './crunchyroll/player'
import NetflixPlayer from './unogs/player'

export type PlayerProps = {
  url: string
  mediaUri: string
  episodeUri: string
  sourceUri: string
}

const players: Record<string, (props: PlayerProps) => any> = {
  cr: CrunchyrollPlayer,
  nf: NetflixPlayer
}

export const getPlayer = (origin: string) => players[origin]
