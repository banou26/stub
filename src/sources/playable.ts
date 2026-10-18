/**
 * Which origins and urls stub can play itself, answered without loading a player.
 *
 * THIS FILE EXISTS TO BE CHEAP TO IMPORT. The question "can this origin be played" is asked on the
 * home page, in the media modal and on the watch page, all of which only ever want a boolean: a play
 * button is drawn or it is not. Asking it through `./players` answered the same boolean and dragged
 * in the two player components, and behind them `@banou/media-player`, videojs, mux and libav.
 *
 * Measured 2026-09-14: that was **353 kB of JavaScript parsed on every page load**, including a
 * listing page that cannot play anything, because `router/home/media-modal.tsx` imported `getPlayer`
 * to write `Boolean(getPlayer(origin.id) && handle?.url)`. The only place that RENDERS a player is
 * `src/embed.tsx`, which is its own vite entry loaded in an iframe, so none of that weight belongs in
 * the main bundle at all.
 *
 * So it imports only small modules that import no player themselves: the sources turned off, and
 * Prime Video's site rules with the country and its zone table (3.5 kB gzipped).
 *
 * KEEP IT IN STEP WITH `./players`. The two lists are separate on purpose, since the whole point is
 * that this one imports no player, and separate lists drift. `tests/unit/sources/playable.test.ts`
 * compares them and fails if a player is added to one and not the other.
 */
import type { FknBackend } from '../utils/fkn-backend'

import { isViewersPrime, primePlaysOnCloud, primeSiteOf } from './amazon/session'
import { readDisabledSources } from './disabled-sources'

export const PLAYABLE_ORIGINS: ReadonlySet<string> = new Set(['cr', 'nf', 'amazon'])

/** Origins whose player works only with the FKN browser extension: on the cloud the watch page asks for it instead of framing the player. */
export const EXTENSION_ONLY_ORIGINS: ReadonlySet<string> = new Set(['nf'])

const PLAYABLE_URLS: Readonly<Record<string, (url: string, backend: FknBackend | undefined) => boolean>> = {
  amazon: (url, backend) => isViewersPrime(url) && (backend === 'extension' || primePlaysOnCloud(primeSiteOf(url))),
}

/**
 * Whether stub's own player for this origin plays `url` on `backend`, and the viewer has not turned the
 * source off. A `backend` not known yet counts as the cloud. The cheap half of `getPlayer`. Read on every
 * call, so a source turned off in Settings loses its play button at once, even on data it answered before.
 */
export const canPlay = (origin: string, url: string | null | undefined, backend: FknBackend | undefined): boolean =>
  !!url && PLAYABLE_ORIGINS.has(origin) && (PLAYABLE_URLS[origin]?.(url, backend) ?? true) && !readDisabledSources().includes(origin)
