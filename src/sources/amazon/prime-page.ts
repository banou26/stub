/**
 * The code the Prime Video player runs inside Amazon's own page with `frame.evaluate`.
 *
 * Each function is sent as its SOURCE and compiled in the page's realm, so it closes over nothing: no
 * import, no module constant, no helper from this file. What it needs comes through its one argument,
 * and argument and result both cross by structured clone.
 */

export type PrimePageSelectors = {
  /** The detail page's Play control, an anchor that opens the in-page player. */
  play: string
  /** The header's sign-in link, there only when signed out. */
  signIn: string
  /**
   * The detail page's offer to rent or buy the episode, in its top action box. A signed-out page shows
   * it too, so it says the episode is not included only once the page is signed in.
   */
  rent: string
}

export type PrimePageState = 'play' | 'signed-out' | 'rent' | 'pending'

/**
 * Where the episode's page stands: its Play control is up, Amazon asks to sign in, the page offers the
 * episode only to rent or buy, or none of these yet.
 */
export const readPrimePage = ({ play, signIn, rent }: PrimePageSelectors): PrimePageState => {
  // Amazon's own sign-in pages, which a signed-out autoplay link goes through (measured 2026-10-12)
  if (/^\/(ap\/signin|ax\/claim)\b|\/auth-redirect\b/.test(location.pathname)) return 'signed-out'
  if (document.querySelector(play)) return 'play'
  if (document.querySelector(signIn)) return 'signed-out'
  return document.querySelector(rent) ? 'rent' : 'pending'
}

/** Presses the Play control. Throws an Error named `PrimeControlMissingError` when it is not on the page. */
export const pressPrimePlay = ({ play }: Pick<PrimePageSelectors, 'play'>) => {
  const control = document.querySelector<HTMLElement>(play)
  if (!control) throw Object.assign(new Error('Prime Video Play is not on the page'), { name: 'PrimeControlMissingError' })
  control.click()
}

/**
 * Which of the elements `videos` matches is the episode playing: the first with a `readyState` above 0,
 * as its index, or -1 while there is none.
 */
export const findPrimeVideo = ({ videos }: { videos: string }) =>
  [...document.querySelectorAll<HTMLVideoElement>(videos)].findIndex(video => video.readyState > 0)
