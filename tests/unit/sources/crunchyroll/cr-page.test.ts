import { describe, expect, test } from 'vite-plus/test'

import { pickTrackOption, pressTrackButton, readTrackMenuOptions, seekTimeline } from '../../../../src/sources/crunchyroll/cr-page'
import { pageRealm, recordEvents } from './page-realm'

// The selectors cr-native-controls.ts passes, over markup shaped like Crunchyroll's player
const MENU = { menu: '[data-testid="audio-text-track-menu"]', section: '[role="menu"]', option: '[role="menuitemradio"]' }
const BUTTON = '[data-testid="track-selection-button"]'
const TIMELINE = '.timeline-slider'

const TRACK_MENU = `
  <div data-testid="audio-text-track-menu">
    <div role="menu">
      <div role="menuitemradio" aria-label="Japanese" aria-checked="true"></div>
      <div role="menuitemradio" aria-label=" English  (US) " aria-checked="false"></div>
    </div>
    <div role="menu">
      <div role="menuitemradio" aria-label="Off" aria-checked="false"></div>
      <div role="menuitemradio" aria-label="English" aria-checked="true"></div>
      <div role="menuitemradio" aria-label="Deutsch" aria-checked="false" aria-disabled="true"></div>
    </div>
  </div>`

const page = (body: string) => pageRealm(`<!doctype html><html><body><div class="video-player-wrapper">${body}</div></body></html>`)

const CLICK = ['PointerEvent:pointerdown', 'MouseEvent:mousedown', 'PointerEvent:pointerup', 'MouseEvent:mouseup', 'MouseEvent:click']

const missing = { name: 'CrunchyrollControlMissingError' }

describe('readTrackMenuOptions', () => {
  test('reads the audio group, then the subtitles group, from each option\'s aria attributes', async () => {
    const { evaluate } = page(TRACK_MENU)

    expect(await evaluate(readTrackMenuOptions, { ...MENU, sectionIndex: 0 })).toEqual([
      { label: 'Japanese', selected: true, disabled: false },
      { label: ' English  (US) ', selected: false, disabled: false },
    ])
    expect(await evaluate(readTrackMenuOptions, { ...MENU, sectionIndex: 1 })).toEqual([
      { label: 'Off', selected: false, disabled: false },
      { label: 'English', selected: true, disabled: false },
      { label: 'Deutsch', selected: false, disabled: true },
    ])
  })

  // the caller treats an empty group as "not rendered yet" and asks again
  test('answers no options while the menu is closed', async () => {
    const { evaluate } = page('')
    expect(await evaluate(readTrackMenuOptions, { ...MENU, sectionIndex: 0 })).toEqual([])
    expect(await evaluate(readTrackMenuOptions, { ...MENU, sectionIndex: 1 })).toEqual([])
  })
})

describe('pickTrackOption', () => {
  test('clicks only the option asked for, with the lib\'s click sequence at its centre', async () => {
    const { document, evaluate, place } = page(TRACK_MENU)
    const options = [...document.querySelectorAll('[role="menu"]')[1]!.querySelectorAll('[role="menuitemradio"]')]
    const seen = options.map(recordEvents)
    place(options[2]!, { left: 100, top: 40, width: 200, height: 10 })

    await evaluate(pickTrackOption, { ...MENU, sectionIndex: 1, optionIndex: 2 })

    expect(seen[0]).toEqual([])
    expect(seen[1]).toEqual([])
    expect(seen[2]!.map(({ event }) => event)).toEqual(CLICK)
    expect(seen[2]!.every(({ clientX, clientY }) => clientX === 200 && clientY === 45)).toBe(true)
  })

  test('an option that is gone is a named failure', async () => {
    const { evaluate } = page(TRACK_MENU)
    await expect(evaluate(pickTrackOption, { ...MENU, sectionIndex: 1, optionIndex: 3 }))
      .rejects.toMatchObject({ ...missing, message: 'Crunchyroll track option 3 is not in the menu' })
  })
})

describe('pressTrackButton', () => {
  test('waits for a button that renders late, then clicks it', async () => {
    const { document, evaluate } = page('')
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'track-selection-button')
    const seen = recordEvents(button)
    setTimeout(() => document.querySelector('.video-player-wrapper')!.append(button), 150)

    await evaluate(pressTrackButton, { button: BUTTON, timeout: 2_000 })

    expect(seen.map(({ event }) => event)).toEqual(CLICK)
  })

  test('a button that never renders is a named failure once the deadline passes', async () => {
    const { evaluate } = page('')
    const started = Date.now()
    await expect(evaluate(pressTrackButton, { button: BUTTON, timeout: 250 }))
      .rejects.toMatchObject({ ...missing, message: 'Crunchyroll track button is not on the page' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
  })
})

describe('seekTimeline', () => {
  // React's own bookkeeping for a controlled input: it shadows `value` on the element so a write
  // through it updates `_valueTracker`, and its input handler fires onChange only when the element's
  // value differs from what the tracker holds
  const reactControlled = (slider: HTMLInputElement) => {
    const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(slider), 'value')!
    const tracker = { value: slider.value, setValue: (next: string) => { tracker.value = next } }
    Object.defineProperty(slider, 'value', {
      configurable: true,
      get: () => native.get!.call(slider),
      set: (next: string) => {
        tracker.value = String(next)
        native.set!.call(slider, next)
      },
    })
    Object.assign(slider, { _valueTracker: tracker })
    const onChange: string[] = []
    slider.addEventListener('input', () => {
      if (tracker.value === slider.value) return
      tracker.value = slider.value
      onChange.push(slider.value)
    })
    return onChange
  }

  test('moves the scrubber so React\'s onChange sees the new value, pressed where that value sits', async () => {
    const { document, evaluate, place } = page(`<input class="timeline-slider" type="range" min="0" max="1440" value="0">`)
    const slider = document.querySelector<HTMLInputElement>(TIMELINE)!
    place(slider, { left: 0, top: 700, width: 1440, height: 8 })
    const onChange = reactControlled(slider)
    const seen = recordEvents(slider)

    await evaluate(seekTimeline, { timeline: TIMELINE, time: 900, timeout: 1_000 })

    expect(onChange).toEqual(['900'])
    expect(seen.map(({ event }) => event)).toEqual([
      'PointerEvent:pointerdown', 'MouseEvent:mousedown', 'Event:input', 'PointerEvent:pointerup', 'MouseEvent:mouseup', 'Event:change',
    ])
    expect(seen.filter(({ clientX }) => clientX !== undefined).every(({ clientX, clientY }) => clientX === 900 && clientY === 704)).toBe(true)
  })

  test('a timeline that is not on the page is a named failure', async () => {
    const { evaluate } = page('')
    await expect(evaluate(seekTimeline, { timeline: TIMELINE, time: 900, timeout: 50 }))
      .rejects.toMatchObject({ ...missing, message: 'Crunchyroll timeline is not on the page' })
  })
})
