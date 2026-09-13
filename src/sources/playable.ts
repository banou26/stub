/**
 * Which origins stub can play itself, as a list of ids and NOTHING ELSE.
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
 * KEEP IT IN STEP WITH `./players`. The two lists are separate on purpose, since the whole point is
 * that this one imports nothing, and separate lists drift. `tests/unit/sources/playable.test.ts`
 * compares them and fails if a player is added to one and not the other.
 */
export const PLAYABLE_ORIGINS: ReadonlySet<string> = new Set(['cr', 'nf'])

/** Whether stub has its own player for this origin. The cheap half of `getPlayer`. */
export const canPlay = (origin: string): boolean => PLAYABLE_ORIGINS.has(origin)
