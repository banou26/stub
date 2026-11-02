// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('lucide-react', () => Object.fromEntries(['Camera', 'ChevronDown', 'ListVideo', 'Search', 'Settings', 'X'].map(name => [name, () => null])))
vi.mock('../../../src/components/account-widget', () => ({ default: () => null, menuStyle: [] }))
vi.mock('../../../src/components/party-widget', () => ({ default: () => null }))
vi.mock('@fkn/lib/react', () => ({ PoweredByFkn: () => null }))
const where = vi.hoisted(() => ({ site: 'anime' }))
vi.mock('../../../src/site', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/site')>()
  return { ...real, get site () { return where.site }, siteLinks: [] }
})
const CODE = 'gwebWzth7oPe2UIubOJmozi1NDFp'
vi.mock('../../../src/scene/code', () => ({
  pictureCode: async (file: File) => {
    if (!file.type.startsWith('image/')) throw new Error('not a picture')
    return CODE
  },
}))

const { Header } = await import('../../../src/components/header')
const { usePictureSearch } = await import('../../../src/router/search/picture')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  where.site = 'anime'
})

// what the search page reads of the shared scene search, drawn beside the bar
const Unreadable = () => <i className="unreadable">{String(usePictureSearch().unreadable)}</i>

const open = (path: string, site = 'anime') => {
  where.site = site
  const location = memoryLocation({ path, record: true })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><Header/><Unreadable/></Router>))
  hosts.push(host)
  const form = host.querySelector('header form')!
  return {
    history: location.history!,
    button: () => form.querySelector<HTMLButtonElement>('button[aria-label="Search by picture"]'),
    picker: () => form.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]'),
    unreadable: () => host.querySelector('.unreadable')?.textContent,
    go: (to: string) => act(() => { location.navigate(to) }),
    // a file handed to the bar as the browser hands it over, answering whether the bar took it
    hand: (type: 'paste' | 'drop', file: File, at: EventTarget = form) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      const transfer = { files: [file], types: ['Files'] }
      Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer })
      act(() => { at.dispatchEvent(event) })
      return event.defaultPrevented
    },
  }
}

const flush = () => act(async () => { await Promise.resolve() })
const picture = () => new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
const notPicture = () => new File(['text'], 'notes.txt', { type: 'text/plain' })
const pick = (picker: HTMLInputElement, file: File) => act(() => {
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] })
  picker.dispatchEvent(new Event('change', { bubbles: true }))
})

describe('the header bar\'s picture button', () => {
  test('is in the bar on the anime site and the all-in-one site, and on neither the film nor the series site', () => {
    const offered = (site: string) => {
      const bar = open('/', site)
      return [Boolean(bar.button()), Boolean(bar.picker())]
    }
    expect(offered('anime')).toEqual([true, true])
    expect(offered('stub')).toEqual([true, true])
    expect(offered('movie')).toEqual([false, false])
    expect(offered('series')).toEqual([false, false])
  })

  test('is named as the search page names it, and a click opens the picker', () => {
    const bar = open('/')
    expect(bar.button()!.getAttribute('title')).toBe('Search by picture')
    const opened = vi.fn()
    bar.picker()!.click = opened
    act(() => { bar.button()!.click() })
    expect(opened).toHaveBeenCalledOnce()
  })

  test('a picked picture opens its scene search as a new step', async () => {
    const bar = open('/media/ag:(anilist:21034)')
    await pick(bar.picker()!, picture())
    await flush()
    expect(bar.history).toEqual(['/media/ag:(anilist:21034)', `/search?scene=${CODE}`])
  })

  test('a picture the browser cannot read opens the search page, which says so until the address moves on', async () => {
    const bar = open('/')
    await pick(bar.picker()!, notPicture())
    await flush()
    expect(bar.history).toEqual(['/', '/search'])
    expect(bar.unreadable()).toBe('true')
    bar.go('/search?q=frieren')
    expect(bar.unreadable()).toBe('false')
    bar.go('/search')
    expect(bar.unreadable(), 'not again on a later visit').toBe('false')
  })

  test('a picture pasted or dropped on the bar opens its scene search, and one pasted elsewhere stays the page\'s', async () => {
    const bar = open('/')
    expect(bar.hand('paste', picture(), document.body), 'outside the bar').toBe(false)
    expect(bar.hand('paste', picture())).toBe(true)
    await flush()
    expect(bar.history).toEqual(['/', `/search?scene=${CODE}`])
    bar.go('/')
    expect(bar.hand('drop', picture())).toBe(true)
    await flush()
    expect(bar.history.at(-1)).toBe(`/search?scene=${CODE}`)
  })

  test('on the search page the bar leaves a pasted picture to the page, which takes it from the whole page', async () => {
    const bar = open('/search?q=x')
    expect(bar.hand('paste', picture())).toBe(false)
    await flush()
    expect(bar.history).toEqual(['/search?q=x'])
  })

  test('the phone\'s field stays open while focus moves on to the button, and a press on it keeps the field focused', () => {
    const bar = open('/')
    const host = hosts.at(-1)!
    const form = host.querySelector('header form')!
    act(() => { host.querySelector<HTMLButtonElement>('.search-toggle')!.click() })
    // on the form itself: linkedom hands a bubbling event to preact's handler as its target's
    const leave = (to: Element) => act(() => {
      const event = new Event('focusout', { bubbles: true })
      Object.defineProperty(event, 'relatedTarget', { value: to })
      form.dispatchEvent(event)
    })
    leave(bar.button()!)
    expect(form.className).toBe('search open')
    const press = new Event('pointerdown', { bubbles: true, cancelable: true })
    act(() => { bar.button()!.dispatchEvent(press) })
    expect(press.defaultPrevented).toBe(true)
    leave(document.body)
    expect(form.className, 'the control: focus leaving the field closes it').toBe('search')
  })

  test('the film and series sites take no picture on the bar', async () => {
    const bar = open('/', 'movie')
    expect(bar.hand('paste', picture())).toBe(false)
    await flush()
    expect(bar.history).toEqual(['/'])
  })
})
