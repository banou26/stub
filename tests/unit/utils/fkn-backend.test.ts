import { expect, test } from 'vite-plus/test'

import { canAddExtension } from '../../../src/utils/fkn-backend'

// The FKN extension is on the Chrome Web Store and on AMO for desktop Firefox; its manifest names no
// gecko_android, so Firefox for Android does not offer it either.
const computer = { maxTouchPoints: 0 }
const touch = { maxTouchPoints: 5 }

test('Chromium and Firefox on a computer can add the extension', () => {
  for (const userAgent of [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0',
  ]) expect(canAddExtension({ userAgent, ...computer }), userAgent).toBe(true)
  const touchLaptop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  expect(canAddExtension({ userAgent: touchLaptop, ...touch }), 'a Windows laptop with a touch screen').toBe(true)
})

test('a phone, a tablet and Safari cannot', () => {
  for (const userAgent of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0',
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  ]) expect(canAddExtension({ userAgent, ...computer }), userAgent).toBe(false)
})

test('an iPad asking for the desktop site, which reads as a Mac with a touch screen, cannot', () => {
  const desktopFirefox = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0'
  expect(canAddExtension({ userAgent: desktopFirefox, ...touch })).toBe(false)
  expect(canAddExtension({ userAgent: desktopFirefox, ...computer }), 'the control: the same browser on a Mac').toBe(true)
})
