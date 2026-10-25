import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { hearTrackLanguages, tellTrackLanguage, trackLanguagesOf, trackLanguagesParams } from '../../src/embed-languages'
import { ACCOUNT_SETTINGS_KEY } from '../../src/settings-store'
import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, readTrackLanguages } from '../../src/utils/track-languages'

// The watch page and its embed as fake windows, as in embed-relays.test.ts: a message is delivered a
// task later, carries the sender as `source`, and is dropped when the target origin does not match.

type FakeWindow = EventTarget & {
  location: { origin: string }
  parent: FakeWindow
  postMessage: (data: unknown, targetOrigin: string) => void
}

const makeWindow = (origin: string) => {
  const win = Object.assign(new EventTarget(), { location: { origin } }) as FakeWindow
  win.parent = win
  win.postMessage = deliver(win, win)
  return win
}

const deliver = (target: FakeWindow, source: FakeWindow) => (data: unknown, targetOrigin: string) => {
  if (targetOrigin !== target.location.origin) return
  setTimeout(() => target.dispatchEvent(Object.assign(new Event('message'), { data, source, origin: source.location.origin })), 0)
}

const APP = 'https://anime.fkn.app'

const makePage = () => {
  const page = makeWindow(APP)
  const embed = makeWindow(APP)
  embed.parent = page
  page.postMessage = deliver(page, embed)
  const iframe = { contentWindow: embed } as unknown as HTMLIFrameElement
  return { page: page as unknown as Window, embed: embed as unknown as Window, iframe }
}

const delivered = () => new Promise(resolve => setTimeout(resolve, 5))

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
const stops: (() => void)[] = []
afterEach(() => {
  while (stops.length) stops.pop()!()
  vi.unstubAllGlobals()
})

test('the page hands the embed the languages kept, the account\'s when signed in, and the embed reads them back', () => {
  expect(trackLanguagesParams()).toEqual({})
  expect(trackLanguagesOf(new URLSearchParams({ url: 'https://www.crunchyroll.com/watch/GX1' }))).toEqual({ audio: undefined, subtitles: undefined })

  stored.set(SUBTITLE_LANGUAGE_KEY, 'off')
  expect(trackLanguagesOf(new URLSearchParams(trackLanguagesParams()))).toEqual({ audio: undefined, subtitles: null })

  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'English' }))
  expect(trackLanguagesOf(new URLSearchParams(trackLanguagesParams()))).toEqual({ audio: 'Japanese', subtitles: 'English' })
})

test('each language the viewer picks in the embed is kept by the page, subtitles off included', async () => {
  const { page, embed, iframe } = makePage()
  stops.push(hearTrackLanguages(iframe, page))
  tellTrackLanguage('audio', 'Japanese', embed)
  tellTrackLanguage('subtitles', null, embed)
  await vi.waitFor(() => expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: null }))
  tellTrackLanguage('subtitles', 'Deutsch', embed)
  await vi.waitFor(() => expect(readTrackLanguages().subtitles).toBe('Deutsch'))
})

test('signed in, a pick goes to the account\'s settings', async () => {
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [AUDIO_LANGUAGE_KEY]: 'English' }))
  const { page, embed, iframe } = makePage()
  stops.push(hearTrackLanguages(iframe, page))
  tellTrackLanguage('audio', 'Japanese', embed)
  await vi.waitFor(() => expect(JSON.parse(stored.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'Japanese' }))
  expect(stored.has(AUDIO_LANGUAGE_KEY)).toBe(false)
})

test('only the embed the page frames, on this app\'s origin, with a language of its kind, is heard', async () => {
  stored.set(AUDIO_LANGUAGE_KEY, 'English')
  const framed = makePage()
  const other = makePage()
  stops.push(hearTrackLanguages(framed.iframe, framed.page))
  const picked = (kind: unknown, language: unknown) => ({ type: 'stub:embed-language-picked', kind, language })
  const send = (data: unknown, source: Window, origin = APP) =>
    framed.page.dispatchEvent(Object.assign(new Event('message'), { data, source, origin }))
  send(picked('audio', 'Japanese'), framed.embed, 'https://other.example')
  send(picked('audio', 'Japanese'), other.embed)
  send({ type: 'stub:embed-title', kind: 'audio', language: 'Japanese' }, framed.embed)
  send(picked('audio', null), framed.embed)
  send(picked('subtitles', 3), framed.embed)
  send(picked('quality', 'Data Saver'), framed.embed)
  await delivered()
  expect(Object.fromEntries(stored)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'English' })

  tellTrackLanguage('audio', 'Japanese', framed.embed)
  await vi.waitFor(() => expect(readTrackLanguages().audio).toBe('Japanese'))
})

test('an embed with no page around it tells nobody', async () => {
  const top = makeWindow(APP)
  const heard = vi.fn()
  top.addEventListener('message', heard)
  tellTrackLanguage('audio', 'Japanese', top as unknown as Window)
  await delivered()
  expect(heard).not.toHaveBeenCalled()
})
