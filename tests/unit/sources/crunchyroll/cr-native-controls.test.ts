import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { describe, expect, test, vi } from 'vite-plus/test'

import { discoverCrunchyrollTracks, selectCrunchyrollTrack } from '../../../../src/sources/crunchyroll/cr-native-controls'
import { pickTrackOption, pressTrackButton, readTrackMenuOptions, seekTimeline } from '../../../../src/sources/crunchyroll/cr-page'
import { pageRealm } from './page-realm'

// The player asks for Evaluation alone, so every control has to run as page code: a locator call that
// needs Interaction or Site data would be refused on a real frame, and is refused here too
const TRACK_MENU = `
  <div data-testid="audio-text-track-menu">
    <div role="menu">
      <div role="menuitemradio" aria-label="Japanese" aria-checked="true"></div>
      <div role="menuitemradio" aria-label="English" aria-checked="false"></div>
    </div>
    <div role="menu">
      <div role="menuitemradio" aria-label="Off" aria-checked="false"></div>
      <div role="menuitemradio" aria-label="English" aria-checked="true"></div>
      <div role="menuitemradio" aria-label="Deutsch" aria-checked="false" aria-disabled="true"></div>
    </div>
  </div>`

const makeRemote = () => {
  const remote = {
    currentSrc: 'blob:japanese',
    readyState: 4,
    currentTime: 612,
    duration: 1440,
    paused: true,
    seeking: false,
    volume: 0.5,
    muted: false,
    playbackRate: 1,
    pause: () => { remote.paused = true },
    play: async () => { remote.paused = false },
  }
  return remote
}

/**
 * Crunchyroll's player, reduced to what its handlers do: the button opens the menu, an option checks
 * itself and reloads the stream from the start, and the scrubber's input moves the video.
 */
const crunchyroll = (remote: ReturnType<typeof makeRemote>, { menuOpen }: { menuOpen: boolean }) => {
  const realm = pageRealm(`<!doctype html><html><body><div class="video-player-wrapper">
    <button data-testid="track-selection-button"></button>
    ${menuOpen ? TRACK_MENU : ''}
    <input class="timeline-slider" type="range" min="0" max="1440" value="0">
  </div></body></html>`)
  const { document } = realm
  const wrapper = document.querySelector('.video-player-wrapper')!

  const wireOptions = () => {
    for (const group of document.querySelectorAll('[role="menu"]')) {
      for (const option of group.querySelectorAll('[role="menuitemradio"]')) {
        option.addEventListener('click', () => {
          for (const other of group.querySelectorAll('[role="menuitemradio"]')) other.setAttribute('aria-checked', String(other === option))
          remote.currentSrc = `blob:${option.getAttribute('aria-label')}`
          remote.currentTime = 0
        })
      }
    }
  }
  if (menuOpen) wireOptions()
  document.querySelector('[data-testid="track-selection-button"]')!.addEventListener('click', () => {
    if (document.querySelector('[data-testid="audio-text-track-menu"]')) return
    wrapper.insertAdjacentHTML('beforeend', TRACK_MENU)
    wireOptions()
  })
  const slider = document.querySelector<HTMLInputElement>('.timeline-slider')!
  slider.addEventListener('input', () => { remote.currentTime = Number(slider.value) })

  // exists() is severity 0 and stays a locator read; every method that needs a grant is refused
  const refused: string[] = []
  const locator = (selector: string): unknown => {
    const refuse = (method: string) => () => {
      refused.push(`${method} ${selector}`)
      throw new Error(`${method} needs a grant this player does not ask for`)
    }
    return {
      exists: async () => document.querySelector(selector) !== null,
      count: async () => document.querySelectorAll(selector).length,
      locator: (inner: string) => locator(`${selector} ${inner}`),
      nth: () => locator(selector),
      click: refuse('click'),
      hover: refuse('hover'),
      fill: refuse('fill'),
      type: refuse('type'),
      getAttribute: refuse('getAttribute'),
      textContent: refuse('textContent'),
    }
  }
  const evaluate = vi.fn(realm.evaluate)
  const frame = { locator, evaluate } as unknown as Frame
  const ran = () => evaluate.mock.calls.map(([pageFunction]) => pageFunction)

  return { document, frame, refused, ran, slider }
}

describe('Crunchyroll track controls', () => {
  test('discovery opens the menu with the button and reads both groups as page code', async () => {
    const remote = makeRemote()
    const { frame, refused, ran } = crunchyroll(remote, { menuOpen: false })

    expect(await discoverCrunchyrollTracks(frame)).toEqual({
      audio: {
        options: [
          { id: 'Japanese', label: 'Japanese', disabled: undefined },
          { id: 'English', label: 'English', disabled: undefined },
        ],
        selectedId: 'Japanese',
      },
      subtitles: {
        options: [
          { id: 'English', label: 'English', disabled: undefined },
          { id: 'Deutsch', label: 'Deutsch', disabled: true },
        ],
        selectedId: 'English',
        offLabel: 'Off',
      },
    })
    expect(refused).toEqual([])
    expect(ran()).toContain(pressTrackButton)
    expect(ran()).toContain(readTrackMenuOptions)
  })

  test('picking audio clicks the option in the page, then puts the viewer back through the scrubber', async () => {
    const remote = makeRemote()
    const { document, frame, refused, ran, slider } = crunchyroll(remote, { menuOpen: true })

    const tracks = await selectCrunchyrollTrack(frame, remote as unknown as RemoteVideoElement, 'audio', 'English')

    const audio = document.querySelectorAll('[role="menu"]')[0]!.querySelectorAll('[role="menuitemradio"]')
    expect([...audio].map(option => option.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    expect(tracks.audio?.selectedId).toBe('English')
    // the reload started the stream over, and the scrubber's input is what moved it back
    expect(slider.value).toBe('612')
    expect(remote.currentTime).toBe(612)
    expect(remote.paused).toBe(true)
    expect(refused).toEqual([])
    expect(ran()).toContain(pickTrackOption)
    expect(ran()).toContain(seekTimeline)
  })
})
