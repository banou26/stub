import type { Frame } from '@fkn/lib'

/**
 * Crunchyroll's own pages saying no video is coming:
 * - the region page every url redirects to where Crunchyroll is not served, measured from Japan on
 *   2026-10-12 about 1.1 s after commit, with neither sign-in menu, so a sign-in check never settles there;
 * - the blocked stream's unavailable icon, for an episode the catalogue marks unavailable. Scoped,
 *   since Crunchyroll's client also puts that icon on episode cards, and the blocked stream alone
 *   also renders, empty, behind the terms dialog of an episode that plays;
 * - the 404 page, for an episode the catalogue does not list.
 * The last two were rendered by Crunchyroll's own client from stand-in answers, not yet seen on a live page.
 * The player's error overlay is not one: it shows any player error, told apart only by the text of its
 * code, which is a read that prompts.
 */
export const UNAVAILABLE_PAGE = '.erc-region-restricted, .erc-blocked-stream [data-t="unavailable-svg"], .erc-not-found'

/** True once the frame shows one of them, false once `isCancelled`. A read that fails counts as not yet. */
export const waitForUnavailablePage = async (frame: Frame, isCancelled: () => boolean) => {
  while (!isCancelled()) {
    if (await frame.locator(UNAVAILABLE_PAGE).exists().catch(() => false)) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}
