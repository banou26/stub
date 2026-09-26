/**
 * The code stub runs inside Crunchyroll's own page with `frame.evaluate`, one function per thing the
 * player does to Crunchyroll's controls. Nothing here runs in stub's own document.
 *
 * Each function is sent as its SOURCE and compiled in the page's realm, so it closes over nothing:
 * no import, no module constant, no helper from this file. Everything it needs comes through its one
 * argument, and argument and result both cross by structured clone, so a result is plain data. A
 * missing control throws an Error named `CrunchyrollControlMissingError`, which comes back to the
 * caller with that name and message. Every wait inside has a deadline under `evaluate`'s own 30 s.
 *
 * The events are the ones @fkn/lib 0.9.36's locator `click` and `fill` dispatched in the page, in the
 * same order and with the same fields, so Crunchyroll's handlers see exactly what they saw while
 * these calls needed the Interaction and Site data grants.
 *
 * This module imports nothing, so node can load it directly to print the sources for a paste into
 * the live page.
 */

export type TrackMenuSelectors = {
  menu: string
  section: string
  option: string
}

export type TrackMenuRow = {
  label: string
  selected: boolean
  disabled: boolean
}

/** Every option of one group of the track menu, which holds audio first and subtitles second. */
export const readTrackMenuOptions = (
  { menu, section, option, sectionIndex }: TrackMenuSelectors & { sectionIndex: number },
): TrackMenuRow[] => {
  const group = [...document.querySelectorAll(menu)].flatMap(root => [...root.querySelectorAll(section)])[sectionIndex]
  return [...(group?.querySelectorAll(option) ?? [])].map(row => ({
    label: row.getAttribute('aria-label') ?? '',
    selected: row.getAttribute('aria-checked') === 'true',
    disabled: row.getAttribute('aria-disabled') === 'true',
  }))
}

/** Clicks the button that opens the track menu, once it renders or `timeout` ms have passed. */
export const pressTrackButton = async ({ button, timeout }: { button: string, timeout: number }) => {
  const deadline = Date.now() + timeout
  let target = document.querySelector(button)
  while (!target && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    target = document.querySelector(button)
  }
  if (!target) {
    throw Object.assign(new Error('Crunchyroll track button is not on the page'), { name: 'CrunchyrollControlMissingError' })
  }
  const box = target.getBoundingClientRect()
  const mouse = { bubbles: true, cancelable: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0 }
  const pointer = { ...mouse, pointerType: 'mouse', pointerId: 1, isPrimary: true }
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
  target.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }))
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('click', { ...mouse, buttons: 0 }))
}

/** Clicks one option of the open track menu, by its position as `readTrackMenuOptions` listed it. */
export const pickTrackOption = (
  { menu, section, option, sectionIndex, optionIndex }: TrackMenuSelectors & { sectionIndex: number, optionIndex: number },
) => {
  const group = [...document.querySelectorAll(menu)].flatMap(root => [...root.querySelectorAll(section)])[sectionIndex]
  const target = group?.querySelectorAll(option)[optionIndex]
  if (!target) {
    throw Object.assign(new Error(`Crunchyroll track option ${optionIndex} is not in the menu`), { name: 'CrunchyrollControlMissingError' })
  }
  const box = target.getBoundingClientRect()
  const mouse = { bubbles: true, cancelable: true, composed: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, button: 0 }
  const pointer = { ...mouse, pointerType: 'mouse', pointerId: 1, isPrimary: true }
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
  target.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }))
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('click', { ...mouse, buttons: 0 }))
}

/**
 * Moves Crunchyroll's scrubber, a native `<input type="range">` whose `max` is the duration, to
 * `time` seconds, once it renders or `timeout` ms have passed.
 *
 * React keeps the value it last saw in `_valueTracker` and shadows `value` with a setter of its own on
 * the element, so the tracker is reset and the value written through the prototype's setter: that way
 * the `input` event reads as a change and Crunchyroll's `onChange` seeks.
 */
export const seekTimeline = async ({ timeline, time, timeout }: { timeline: string, time: number, timeout: number }) => {
  const deadline = Date.now() + timeout
  let found = document.querySelector(timeline)
  while (!found && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
    found = document.querySelector(timeline)
  }
  if (found?.tagName !== 'INPUT') {
    throw Object.assign(new Error('Crunchyroll timeline is not on the page'), { name: 'CrunchyrollControlMissingError' })
  }
  const slider = found as HTMLInputElement & { _valueTracker?: { setValue: (value: string) => void } }
  const min = Number(slider.min || 0)
  const max = Number(slider.max || 100)
  const box = slider.getBoundingClientRect()
  const fraction = Math.max(0, Math.min(1, (time - min) / (max - min)))
  const mouse = { bubbles: true, cancelable: true, composed: true, clientX: box.left + box.width * fraction, clientY: box.top + box.height / 2, button: 0 }
  const pointer = { ...mouse, pointerType: 'mouse', pointerId: 1, isPrimary: true }
  const pressed = slider.type === 'range' && Number.isFinite(min) && Number.isFinite(max) && max > min
  if (pressed) {
    slider.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
    slider.dispatchEvent(new MouseEvent('mousedown', { ...mouse, buttons: 1 }))
  }
  slider._valueTracker?.setValue('')
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(slider), 'value')!.set!.call(slider, String(time))
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  if (pressed) {
    slider.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
    slider.dispatchEvent(new MouseEvent('mouseup', { ...mouse, buttons: 0 }))
  }
  slider.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Makes a click in Crunchyroll's page open its video in picture in picture, and keeps that click from
 * every other handler, so Crunchyroll's own never pauses the video on it.
 *
 * The request has to be made here, inside the click: a browser opens picture in picture only for a
 * gesture in the document that owns the video. Stub's player lets the click on its control through to
 * this frame (see picture-in-picture.ts), and the frame takes no pointer events at any other time, so
 * a real click reaching this page is one meant for this. Clicks this module dispatches itself (the
 * track menu's, above) are not `isTrusted`, and pass untouched.
 *
 * On the window in the capture phase, so it runs before anything of the page's. Resolves false,
 * installing nothing, where the video cannot enter picture in picture, so the player offers no
 * control there.
 */
export const enterPictureInPictureOnClick = ({ video }: { video: string }) => {
  const element = document.querySelector(video) as HTMLVideoElement | null
  if (typeof element?.requestPictureInPicture !== 'function') return false
  window.addEventListener('click', event => {
    if (!event.isTrusted) return
    event.stopImmediatePropagation()
    event.preventDefault()
    const target = document.querySelector(video) as HTMLVideoElement | null
    target?.requestPictureInPicture().catch(() => {})
  }, true)
  return true
}
