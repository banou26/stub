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

export type PrimeQualitySelectors = {
  /** An element inside the player's overlays, where a mousemove brings its controls up. */
  reveal: string
  /** The controls' Settings button, which opens the settings menu, or closes every open menu. */
  settings: string
  /** The settings menu's Video Quality entry, which opens the quality menu in its place. */
  item: string
  /** The quality menu. */
  menu: string
  /** Each choice in the quality menu, a radio whose value is its id. */
  option: string
  /** How long the controls and the menu are waited for, in ms. */
  timeout: number
}

export type PrimeQualityRow = { id: string, label: string, selected: boolean }

/**
 * The player's quality choices, read from its own menu after checking `pick` there when one is
 * given; the menu is closed again before it answers. Throws an Error named `PrimeControlMissingError`
 * when the controls or the menu do not show within `timeout`, or `pick` is not one of the choices,
 * and a plain Error when the player has not checked `pick` by then.
 */
export const primeQuality = async (
  { reveal, settings, item, menu, option, timeout, pick }: PrimeQualitySelectors & { pick?: string },
): Promise<PrimeQualityRow[]> => {
  const deadline = Date.now() + timeout
  const sleep = () => new Promise(resolve => setTimeout(resolve, 50))
  const missing = (what: string) => Object.assign(new Error(`Prime Video ${what} is not on the page`), { name: 'PrimeControlMissingError' })
  const until = async (selector: string, nudge = false) => {
    while (Date.now() < deadline) {
      const found = document.querySelector<HTMLElement>(selector)
      if (found) return found
      // Amazon mounts its controls on a mousemove that moved, and drops them again a few seconds later
      if (nudge) document.querySelector(reveal)?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: 1 }))
      await sleep()
    }
    throw missing(selector)
  }
  const options = () => [...document.querySelectorAll<HTMLInputElement>(`${menu} ${option}`)]
  // a choice's label holds its name, then a line on the data it uses
  const labelOf = (input: HTMLInputElement) =>
    [...input.closest('label')?.querySelectorAll('*') ?? []].find(element => !element.children.length && element.textContent?.trim())?.textContent?.trim() ?? input.value

  if (!document.querySelector(menu)) {
    const gear = await until(settings, true)
    if (!document.querySelector(item)) gear.click()
    ;(await until(item)).click()
    await until(menu)
  }
  if (pick !== undefined) {
    const target = options().find(input => input.value === pick)
    if (!target) throw missing(`quality ${pick}`)
    if (!target.checked) target.click()
    while (Date.now() < deadline && !options().find(input => input.value === pick)?.checked) await sleep()
  }
  const rows = options().map(input => ({ id: input.value, label: labelOf(input), selected: input.checked }))
  document.querySelector<HTMLElement>(settings)?.click()
  if (pick !== undefined && !rows.find(row => row.id === pick)?.selected) throw new Error(`Prime Video did not switch to quality ${pick}`)
  return rows
}
