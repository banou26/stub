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

// the gear's popup, rendered next to the button's wrapper: the autoplay switch, then the quality group
const SETTINGS_MENU = `
  <div role="menu">
    <div>
      <div role="menu" aria-label="Settings">
        <div role="separator"><span>Settings</span></div>
        <div role="menuitemcheckbox" aria-label="Autoplay Next" aria-checked="true"></div>
      </div>
      <div role="menu" aria-label="Quality">
        <div role="separator"><span>Quality</span></div>
        <div role="menuitemradio" aria-label="Highest Available" aria-checked="true"></div>
        <div role="menuitemradio" aria-label="Moderate" aria-checked="false"></div>
        <div role="menuitemradio" aria-label="Data Saver" aria-checked="false"></div>
      </div>
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
 * Crunchyroll's player, reduced to what its handlers do: a button opens its menu and closes the other
 * one, a track option checks itself and reloads the stream from the start, a quality option checks
 * itself and leaves the stream playing, and the scrubber's input moves the video.
 */
const crunchyroll = (remote: ReturnType<typeof makeRemote>, { menuOpen }: { menuOpen: boolean }) => {
  const realm = pageRealm(`<!doctype html><html><body><div class="video-player-wrapper">
    <button data-testid="track-selection-button"></button>
    ${TRACK_MENU}
    <div class="settings"><div><button data-testid="player-settings-menu-button" aria-expanded="false"></button></div>${SETTINGS_MENU}</div>
    <input class="timeline-slider" type="range" min="0" max="1440" value="0">
  </div></body></html>`)
  const { document } = realm
  const wrapper = document.querySelector('.video-player-wrapper')!
  const gear = document.querySelector('[data-testid="player-settings-menu-button"]')!
  const settings = document.querySelector('.settings')!
  const trackMenu = document.querySelector('[data-testid="audio-text-track-menu"]')!
  const settingsMenu = settings.querySelector(':scope > [role="menu"]')!

  // React keeps the checked option in its state, so a menu closes and comes back as it was
  const wireOptions = (menu: Element, reloads: boolean) => {
    for (const group of menu.querySelectorAll('[role="menu"]')) {
      for (const option of group.querySelectorAll('[role="menuitemradio"]')) {
        option.addEventListener('click', () => {
          for (const other of group.querySelectorAll('[role="menuitemradio"]')) other.setAttribute('aria-checked', String(other === option))
          if (!reloads) return
          remote.currentSrc = `blob:${option.getAttribute('aria-label')}`
          remote.currentTime = 0
        })
      }
    }
  }
  wireOptions(trackMenu, true)
  wireOptions(settingsMenu, false)
  const closeSettings = () => {
    gear.setAttribute('aria-expanded', 'false')
    settingsMenu.remove()
  }
  closeSettings()
  if (!menuOpen) trackMenu.remove()
  document.querySelector('[data-testid="track-selection-button"]')!.addEventListener('click', () => {
    if (trackMenu.isConnected) return
    closeSettings()
    wrapper.append(trackMenu)
  })
  gear.addEventListener('click', () => {
    if (gear.getAttribute('aria-expanded') === 'true') return closeSettings()
    trackMenu.remove()
    gear.setAttribute('aria-expanded', 'true')
    settings.append(settingsMenu)
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

  return { document, frame, refused, ran, slider, trackMenu, settingsMenu }
}

const QUALITY = {
  options: [
    { id: 'Highest Available', label: 'Highest Available', disabled: undefined },
    { id: 'Moderate', label: 'Moderate', disabled: undefined },
    { id: 'Data Saver', label: 'Data Saver', disabled: undefined },
  ],
  selectedId: 'Highest Available',
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
      quality: QUALITY,
    })
    expect(refused).toEqual([])
    expect(ran()).toContain(pressTrackButton)
    expect(ran()).toContain(readTrackMenuOptions)
  })

  // discovery also runs after every audio or subtitle switch, so any wait for the gear is added to each switch
  test('a page with no gear gives its audio and subtitles without waiting for one', async () => {
    const remote = makeRemote()
    const { document, frame } = crunchyroll(remote, { menuOpen: false })
    document.querySelector('.settings')!.remove()

    const started = Date.now()
    const tracks = await discoverCrunchyrollTracks(frame)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(tracks.audio?.selectedId).toBe('Japanese')
    expect(tracks.subtitles?.selectedId).toBe('English')
    expect(tracks.quality).toBeUndefined()
  })

  test('a gear that will not open costs discovery about two seconds, not the track menu\'s ten', async () => {
    const remote = makeRemote()
    const { document, frame } = crunchyroll(remote, { menuOpen: false })
    const gear = document.querySelector('[data-testid="player-settings-menu-button"]')!
    // a clone carries no listener, so pressing it opens nothing
    gear.replaceWith(gear.cloneNode(true))

    const started = Date.now()
    const tracks = await discoverCrunchyrollTracks(frame)
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(tracks.audio?.selectedId).toBe('Japanese')
    expect(tracks.subtitles?.selectedId).toBe('English')
    expect(tracks.quality).toBeUndefined()
  })

  test('picking a quality clicks it in the gear\'s menu as page code, and leaves the playback alone', async () => {
    const remote = makeRemote()
    const { frame, refused, ran, slider, settingsMenu } = crunchyroll(remote, { menuOpen: true })
    let readyStateReads = 0
    Object.defineProperty(remote, 'readyState', { get: () => { readyStateReads += 1; return 4 } })

    const tracks = await selectCrunchyrollTrack(frame, remote as unknown as RemoteVideoElement, 'quality', 'Data Saver')

    const quality = settingsMenu.querySelectorAll('[aria-label="Quality"] [role="menuitemradio"]')
    expect([...quality].map(option => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    expect(tracks.quality?.selectedId).toBe('Data Saver')
    // the audio and subtitles are read again on the way out, with the track menu open in place of the gear's
    expect(tracks.audio?.selectedId).toBe('Japanese')
    // nothing waits for a reload a quality never causes
    expect(readyStateReads).toBe(0)
    expect(slider.value).toBe('0')
    expect(remote.currentTime).toBe(612)
    expect(refused).toEqual([])
    expect(ran()).toContain(pickTrackOption)
    expect(ran()).not.toContain(seekTimeline)
  })

  test('picking audio clicks the option in the page, then puts the viewer back through the scrubber', async () => {
    const remote = makeRemote()
    const { frame, refused, ran, slider, trackMenu } = crunchyroll(remote, { menuOpen: true })

    const tracks = await selectCrunchyrollTrack(frame, remote as unknown as RemoteVideoElement, 'audio', 'English')

    const audio = trackMenu.querySelectorAll('[role="menu"]')[0]!.querySelectorAll('[role="menuitemradio"]')
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
