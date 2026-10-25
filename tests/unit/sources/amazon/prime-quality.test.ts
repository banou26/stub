import { describe, expect, test, vi } from 'vite-plus/test'

import { primeQuality, type PrimeQualitySelectors } from '../../../../src/sources/amazon/prime-page'
import { pageRealm } from '../crunchyroll/page-realm'
import { PRIME_PLAYER, wirePrimeControls } from './player-controls'

// the page function over a stand-in of Amazon's player, compiled from its source in a page realm as
// frame.evaluate does; the selectors are the player's own
const QUALITY: PrimeQualitySelectors = {
  reveal: '.atvwebplayersdk-loading-overlay',
  settings: '#atvwebplayersdk-settings-button',
  item: '#atvwebplayersdk-video-quality-button',
  menu: '#atvwebplayersdk-video-quality-menu',
  option: 'input[type="radio"]',
  menus: '#atvwebplayersdk-settings-menu, #atvwebplayersdk-video-quality-menu',
  timeout: 1_000,
}

const ROWS = [
  { id: 'good', label: 'Good', selected: false },
  { id: 'better', label: 'Better', selected: false },
  { id: 'best', label: 'Best', selected: true },
]

const prime = (options?: Parameters<typeof wirePrimeControls>[1], html = PRIME_PLAYER) => {
  const realm = pageRealm(`<!doctype html><html><body><div id="dv-web-player">${html}</div></body></html>`, 'https://www.amazon.co.jp/gp/video/detail/0PJQL97FNFXU3VZWEHILB694SJ')
  const controls = wirePrimeControls(realm.document, options)
  const run = (pick?: string) => realm.evaluate(primeQuality, { ...QUALITY, ...(pick === undefined ? {} : { pick }) })
  return { ...realm, ...controls, run }
}

const rejected = (promise: Promise<unknown>) => promise.then(() => { throw new Error('resolved') }, (error: Error) => error)

describe('reading Prime Video\'s quality', () => {
  test('brings the controls up, reads Good, Better and Best from the quality menu, and closes it', async () => {
    const { run, state, document } = prime()
    expect(await run()).toEqual(ROWS)
    expect(state.menu).toBe('none')
    expect(document.querySelector(QUALITY.menu)).toBeNull()
  })

  test('reads the choice the player stands at', async () => {
    const { run } = prime({ quality: 'good' })
    expect((await run()).filter(row => row.selected).map(row => row.id)).toEqual(['good'])
  })

  test('a settings menu left open goes straight to its Video Quality, without closing it first', async () => {
    const { run, open, state } = prime()
    open('settings')
    expect(await run()).toEqual(ROWS)
    expect(state.menu).toBe('none')
  })

  test('a quality menu left open is read where it is', async () => {
    const { run, open } = prime({ quality: 'better' })
    open('quality')
    expect((await run()).find(row => row.selected)?.id).toBe('better')
  })

  test('a player that never shows its controls throws PrimeControlMissingError once the time is up', async () => {
    const { run } = prime(undefined, '<div class="atvwebplayersdk-loading-overlay"></div>')
    const started = Date.now()
    const error = await rejected(run())
    expect(error.name).toBe('PrimeControlMissingError')
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  test('a settings menu with no Video Quality, as a live title\'s, throws PrimeControlMissingError and is closed again', async () => {
    const { run, state } = prime({ live: true })
    expect((await rejected(run())).name).toBe('PrimeControlMissingError')
    expect(state.menu).toBe('none')
  })

  test('a menu the player closed on its own is not opened again', async () => {
    const { run, state, closeAll } = prime({ live: true })
    const error = rejected(run())
    await vi.waitFor(() => expect(state.menu).toBe('settings'))
    closeAll()
    expect((await error).name).toBe('PrimeControlMissingError')
    expect(state.menu).toBe('none')
  })
})

describe('picking Prime Video\'s quality', () => {
  test('checks the choice in the player\'s menu and closes it', async () => {
    const { run, state } = prime()
    expect(await run('better')).toEqual([
      { id: 'good', label: 'Good', selected: false },
      { id: 'better', label: 'Better', selected: true },
      { id: 'best', label: 'Best', selected: false },
    ])
    expect(state).toMatchObject({ quality: 'better', menu: 'none' })
  })

  test('a choice the menu does not hold throws PrimeControlMissingError, checks nothing and closes the menu', async () => {
    const { run, state } = prime()
    expect((await rejected(run('ultra'))).name).toBe('PrimeControlMissingError')
    expect(state).toMatchObject({ quality: 'best', menu: 'none' })
  })

  test('a pick the player does not take is an error, with the menu closed', async () => {
    const { run, state } = prime({ picks: false })
    expect((await rejected(run('good'))).message).toBe('Prime Video did not switch to quality good')
    expect(state).toMatchObject({ quality: 'best', menu: 'none' })
  })
})
