// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// urql is faked as one stream: `publish` answers whatever subscription is running, and `started`
// records each one the page starts, by its input, in order.
const stream = vi.hoisted(() => ({
  data: undefined as unknown,
  started: [] as Record<string, unknown>[],
  running: undefined as string | undefined,
  listeners: new Set<() => void>(),
}))
vi.mock('urql', async () => {
  const { useEffect, useState } = await import('preact/hooks')
  return {
    useSubscription: ({ variables, pause }: { variables: { input: Record<string, unknown> }, pause?: boolean }) => {
      const [, setRenders] = useState(0)
      useEffect(() => {
        const render = () => setRenders(count => count + 1)
        stream.listeners.add(render)
        return () => { stream.listeners.delete(render) }
      }, [])
      const key = pause ? undefined : JSON.stringify(variables.input)
      if (key && key !== stream.running) stream.started.push(variables.input)
      stream.running = key
      return [{ data: stream.data }]
    },
  }
})
vi.mock('lucide-react', () => ({ Search: () => null, X: () => null }))
vi.mock('../../../src/components/display-mode-toggle', () => ({ default: () => null }))
vi.mock('../../../src/components/filter-select', () => ({
  default: () => null,
  FilterField: ({ children }: { children: unknown }) => children,
}))
const Result = ({ media }: { media: { _id: string } }) => <a className="result">{media._id}</a>
vi.mock('../../../src/components/media-title', () => ({ default: Result }))
vi.mock('../../../src/components/media-card', () => ({ default: Result }))
vi.mock('../../../src/components/media-row', () => ({ default: Result }))

const { default: Search } = await import('../../../src/router/search')

const publish = (...ids: string[]) => act(() => {
  stream.data = { mediaPage: { nodes: ids.map(id => ({ _id: id, uri: id })) } }
  for (const listener of stream.listeners) listener()
})
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  stream.data = undefined
  stream.started.length = 0
  stream.running = undefined
  delete (document as { activeElement?: Element }).activeElement
})

// what a browser reports while the reader is typing in the header's box: the header's first keystroke
// is what brought them to the search page
const typingInHeader = () => {
  const box = document.createElement('header').appendChild(document.createElement('input'))
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => box })
}

const open = (path: string) => {
  vi.useFakeTimers()
  const location = memoryLocation({ path, record: true })
  const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><Search/></Router>)
  hosts.push(host)
  const field = host.querySelector<HTMLInputElement>('input[aria-label="Search by title"]')!
  return {
    history: location.history!,
    results: () => [...host.querySelectorAll('.result')].map(result => result.textContent),
    status: () => host.querySelector('.status')?.textContent,
    // the placeholder items drawn while the search is out
    pending: () => host.querySelectorAll('.pending').length,
    field: () => field.value,
    // linkedom tracks no focus, so this says which element a browser would report as focused
    focus: () => Object.defineProperty(document, 'activeElement', { configurable: true, get: () => field }),
    type: (value: string) => act(() => {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }),
    // what the header's box does on each keystroke once the search page is open
    go: (path: string) => act(() => { location.navigate(path, { replace: true }) }),
  }
}

describe('the search page', () => {
  test('a keystroke in its field writes the url at once', () => {
    const page = open('/search?q=mushoku&year=2020')
    page.type('naruto')
    expect(page.history).toEqual(['/search?q=naruto&year=2020'])
  })

  test('the url writes its field back, except while the reader is typing in it', () => {
    const page = open('/search?q=mushoku')
    page.go('/search?q=naruto')
    expect(page.field()).toBe('naruto')
    page.focus()
    page.type('naruto shi')
    page.go('/search?q=bleach')
    expect(page.field()).toBe('naruto shi')
  })

  test('typing hides the previous results at once, before the new query is even fetched', async () => {
    const page = open('/search?q=mushoku')
    await wait(350)
    await publish('mushoku-1')
    expect(page.results()).toEqual(['mushoku-1'])

    page.type('naruto')
    expect(page.results()).toEqual([])
    expect(page.pending()).toBeGreaterThan(0)
  })

  test('a url change hides them too, while the fetch still lags behind it', async () => {
    const page = open('/search?q=mushoku')
    await wait(350)
    await publish('mushoku-1')
    page.go('/search?q=naruto')
    expect(page.results()).toEqual([])
    await wait(350)
    expect(page.results()).toEqual([])
    await publish('naruto-1')
    expect(page.results()).toEqual(['naruto-1'])
  })

  test('a letter typed and deleted again brings back the results it already had, without fetching again', async () => {
    const page = open('/search?q=mushoku')
    await wait(350)
    await publish('mushoku-1')
    page.type('mushokux')
    expect(page.results()).toEqual([])
    await wait(100)
    page.type('mushoku')
    expect(page.results()).toEqual(['mushoku-1'])
    await wait(400)
    expect(stream.started).toEqual([expect.objectContaining({ search: 'mushoku' })])
  })

  test('a word typed letter by letter starts one subscription, for the whole word', async () => {
    typingInHeader()
    const page = open('/search?q=m')
    for (const query of ['mu', 'mus', 'mush', 'musho', 'mushok', 'mushoku']) {
      await wait(100)
      page.go(`/search?q=${query}`)
    }
    expect(stream.started).toEqual([])
    await wait(350)
    expect(stream.started).toEqual([expect.objectContaining({ search: 'mushoku' })])
  })

  test('a link, a reload or Back fetches its query at once', () => {
    open('/search?q=mushoku')
    expect(stream.started).toEqual([expect.objectContaining({ search: 'mushoku' })])
  })

  test('a filter control fetches at once', async () => {
    const page = open('/search?season=WINTER')
    expect(stream.started).toEqual([expect.objectContaining({ season: 'WINTER' })])
    await publish('winter-1')
    page.go('/search?season=SPRING')
    expect(page.results()).toEqual([])
    expect(stream.started.at(-1)).toEqual(expect.objectContaining({ season: 'SPRING' }))
  })

  test('no result is declared before the query actually fetched has had its 5 s', async () => {
    const page = open('/search?q=a')
    await wait(350)
    page.go('/search?q=ab')
    // in two steps, since act renders only once a step is over and the fetch starts on that render
    await wait(350)
    await wait(4_650)
    expect(page.status()).toBeUndefined()
    expect(page.pending()).toBeGreaterThan(0)
    await wait(350)
    expect(page.status()).toBe('No results found.')
    expect(page.pending()).toBe(0)
  })

  test('while the search is out, placeholders stand in the layout picked, and go once the results land', async () => {
    const page = open('/search?q=mushoku')
    expect(page.pending()).toBe(12)
    expect(page.status(), 'no line of text in their place').toBeUndefined()
    await publish('mushoku-1')
    expect(page.results()).toEqual(['mushoku-1'])
    expect(page.pending()).toBe(0)
  })
})
