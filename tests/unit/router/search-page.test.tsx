// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, describe, expect, test, vi, type Mock } from 'vite-plus/test'
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
  pickers: {} as Record<string, { options: { value: string }[], onChange: (labels: string[]) => void }>,
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
vi.mock('lucide-react', () => ({ Search: () => null, X: () => null, ImageIcon: () => null, LucidePlay: () => null }))
// trace.moe as the worker answers it, and the picture's code as the browser computes it
const scenes = vi.hoisted(() => ({ search: undefined as unknown as Mock<(code: string) => Promise<unknown>> }))
vi.mock('../../../src/worker', async () => {
  const { vi } = await import('vite-plus/test')
  scenes.search = vi.fn()
  return { searchScene: (code: string) => scenes.search(code) }
})
vi.mock('../../../src/scene/code', () => ({
  pictureCode: async (file: File) => {
    if (!file.type.startsWith('image/')) throw new Error('not a picture')
    return CODE
  },
}))
const CODE = 'gwebWzth7oPe2UIubOJmozi1NDFp'
vi.mock('../../../src/components/display-mode-toggle', () => ({ default: () => null }))
vi.mock('../../../src/components/filter-select', () => ({
  default: (props: { label: string, options: { value: string }[], onChange: (labels: string[]) => void }) => {
    stream.pickers[props.label] = props
    return null
  },
  FilterField: ({ children }: { children: unknown }) => children,
}))
const Result = ({ media }: { media: { _id: string } }) => <a className="result">{media._id}</a>
vi.mock('../../../src/components/media-title', () => ({ default: Result }))
vi.mock('../../../src/components/media-card', () => ({ default: Result }))
vi.mock('../../../src/components/media-row', () => ({ default: Result }))

const { default: Search } = await import('../../../src/router/search')

const publish = (...nodes: (string | { _id: string, genres: string[], tags: string[] })[]) => act(() => {
  stream.data = { mediaPage: { nodes: nodes.map(node => typeof node === 'string' ? { _id: node, uri: node } : { ...node, uri: node._id }) } }
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
  scenes.search.mockReset()
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

  // outside a season Jikan's "Award Winning" and "Isekai" are genres no source lists by, and AniList lists "Isekai" as a tag
  test('outside a season the genres offered are the site\'s own, never one only the results carry, and a label AniList tags is a tag', async () => {
    const page = open('/search?q=frieren')
    await publish({ _id: 'frieren', genres: ['Adventure', 'Award Winning', 'Isekai'], tags: ['Travel', 'Isekai'] })
    const picker = stream.pickers['Genres & Tags']!
    const offered = picker.options.map(option => option.value)
    expect(offered).toEqual(expect.arrayContaining(['Adventure', 'Mecha', 'Science-Fiction', 'Travel', 'Isekai']))
    expect(offered).not.toContain('Award Winning')
    act(() => picker.onChange(['Isekai']))
    expect(page.history.at(-1)).toBe('/search?q=frieren&tag=Isekai')
  })

  // MyAnimeList's season page gives its titles their themes and demographics as genres
  test('inside a season the genres its results carry are offered, and each writes genre=', async () => {
    const page = open('/search?season=FALL&year=2026')
    await publish({ _id: 'psyren', genres: ['Action', 'Suspense', 'Isekai'], tags: ['Isekai', 'Time Manipulation'] })
    const picker = stream.pickers['Genres & Tags']!
    expect(picker.options.map(option => option.value)).toEqual(expect.arrayContaining(['Suspense', 'Isekai', 'Time Manipulation']))
    act(() => picker.onChange(['Suspense', 'Isekai', 'Time Manipulation']))
    expect(page.history.at(-1)).toBe('/search?season=FALL&year=2026&genre=Suspense&genre=Isekai&tag=Time+Manipulation')
  })

  test('a season with no year names no season page, so the genres only its results carry are not offered', async () => {
    open('/search?season=FALL')
    await publish({ _id: 'psyren', genres: ['Action', 'Suspense'], tags: ['Time Manipulation'] })
    const offered = stream.pickers['Genres & Tags']!.options.map(option => option.value)
    expect(offered, 'the control: the results landed').toContain('Time Manipulation')
    expect(offered).not.toContain('Suspense')
  })

  test('a genre the url names stays a genre when another label is picked', () => {
    const page = open('/search?q=frieren&genre=Award+Winning')
    act(() => stream.pickers['Genres & Tags']!.onChange(['Award Winning', 'Travel']))
    expect(page.history.at(-1)).toBe('/search?q=frieren&genre=Award+Winning&tag=Travel')
  })
})

// a picture's color code asked of trace.moe, its address /search?scene=<code>
describe('the scene search', () => {
  const rabbit = { matches: [{ anilist: 21034, moments: [{ episode: 1, from: 272.19 }, { episode: 2, from: 5 }] }] }
  const showMedia = () => act(() => {
    stream.data = { media: { _id: 'rabbit', uri: 'ag:(anilist:21034)', type: 'TV', episodes: [{ _id: 'e1', uri: 'ep:1', episodeNumber: 1 }] } }
    for (const listener of stream.listeners) listener()
  })
  const flush = () => act(async () => { await Promise.resolve() })
  const pasted = (file?: File, types = file ? ['Files'] : ['text/plain']) => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: file ? [file] : [], types } })
    act(() => { document.dispatchEvent(event) })
    return event
  }
  const picture = () => new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
  const notPicture = () => new File(['text'], 'notes.txt', { type: 'text/plain' })

  test('its address asks trace.moe once, names it, and asks no text search', async () => {
    scenes.search.mockResolvedValue(rabbit)
    const page = open(`/search?scene=${CODE}&q=frieren`)
    await flush()
    expect(scenes.search).toHaveBeenCalledExactlyOnceWith(CODE)
    const host = hosts.at(-1)!
    expect(host.querySelector('.heading')?.textContent).toBe('Scene search')
    expect(host.querySelector('.credit')?.textContent).toBe('Scenes found by trace.moe')
    expect(host.querySelector('.credit a')?.getAttribute('href')).toBe('https://trace.moe')
    expect(stream.started).toEqual(expect.arrayContaining([{ uri: 'anilist:21034' }]))
    expect(stream.started.filter(input => !('uri' in input)), 'no text search').toEqual([])
    page.go(`/search?scene=${CODE}`)
    await flush()
    expect(scenes.search, 'the same address, not asked again').toHaveBeenCalledOnce()
  })

  test('each show it found is its card, with a link per episode that opens it at the scene', async () => {
    scenes.search.mockResolvedValue(rabbit)
    open(`/search?scene=${CODE}`)
    await flush()
    const host = hosts.at(-1)!
    expect(host.querySelectorAll('.pending').length, 'the show is still being read').toBe(1)
    await showMedia()
    expect([...host.querySelectorAll('.result')].map(result => result.textContent)).toEqual(['rabbit'])
    const moments = [...host.querySelectorAll('.moment')]
    expect(moments.map(moment => [moment.tagName, moment.textContent, moment.getAttribute('href')])).toEqual([
      ['A', 'Episode 1, 4:32', '/watch/ag:(anilist:21034)/ep:1?t=272'],
      ['SPAN', 'Episode 2, 0:05', null],
    ])
  })

  test('a film plays from the time alone, and a special with no episode opens only the show', async () => {
    scenes.search.mockResolvedValue({ matches: [{ anilist: 50, moments: [{ episode: null, from: 3723.9 }] }] })
    open(`/search?scene=${CODE}`)
    await flush()
    const host = hosts.at(-1)!
    const moments = () => [...host.querySelectorAll('.moment')].map(moment => [moment.textContent, moment.getAttribute('href')])
    await act(() => {
      stream.data = { media: { _id: 'film', uri: 'ag:(anilist:50)', type: 'MOVIE', episodes: [{ _id: 'f', uri: 'ep:film', episodeNumber: null }] } }
      for (const listener of stream.listeners) listener()
    })
    expect(moments()).toEqual([['1:02:03', '/watch/ag:(anilist:50)/ep:film?t=3723']])
    await act(() => {
      stream.data = { media: { _id: 'special', uri: 'ag:(anilist:50)', type: 'SPECIAL', episodes: [{ _id: 's', uri: 'ep:s', episodeNumber: null }] } }
      for (const listener of stream.listeners) listener()
    })
    expect([...host.querySelectorAll('.result')].map(result => result.textContent)).toEqual(['special'])
    expect(moments()).toEqual([])
  })

  test('nothing at 0.9 or more is no result, and a refusal is its one line', async () => {
    scenes.search.mockResolvedValue({ matches: [] })
    const page = open(`/search?scene=${CODE}`)
    expect(page.pending(), 'while trace.moe is asked').toBe(12)
    await flush()
    expect(page.status()).toBe('No results found.')

    scenes.search.mockResolvedValue({ error: "trace.moe's daily limit is reached. Try again tomorrow." })
    page.go('/search?scene=eOOEIPhB0IQhB8IQg-TPYQg-D0IQ')
    await flush()
    expect(page.status()).toBe("trace.moe's daily limit is reached. Try again tomorrow.")
  })

  test('a pasted picture opens its scene address as a new step, and a paste of text is the field\'s', async () => {
    const page = open('/search?q=mushoku')
    expect(pasted().defaultPrevented, 'no file').toBe(false)
    expect(page.history).toEqual(['/search?q=mushoku'])
    const event = pasted(picture())
    await flush()
    expect(event.defaultPrevented).toBe(true)
    expect(page.history).toEqual(['/search?q=mushoku', `/search?scene=${CODE}`])
  })

  test('a paste of text with a picture beside it, as Word and Excel copy, is the field\'s', async () => {
    const page = open('/search?q=mushoku')
    const event = pasted(picture(), ['text/plain', 'text/html', 'Files'])
    await flush()
    expect(event.defaultPrevented).toBe(false)
    expect(page.history).toEqual(['/search?q=mushoku'])
  })

  test('a new code draws placeholders until its own answer, never the last code\'s', async () => {
    scenes.search.mockResolvedValueOnce(rabbit)
    const page = open(`/search?scene=${CODE}`)
    await flush()
    await showMedia()
    expect(page.results()).toEqual(['rabbit'])
    let answer!: (value: unknown) => void
    scenes.search.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    page.go('/search?scene=eOOEIPhB0IQhB8IQg-TPYQg-D0IQ')
    await flush()
    expect(page.results()).toEqual([])
    expect(page.pending()).toBe(12)
    answer({ matches: [] })
    await flush()
    expect(page.status()).toBe('No results found.')
  })

  test('a file that is no picture says so in one line, and asks nothing', async () => {
    const page = open('/search')
    pasted(notPicture())
    await flush()
    expect(page.status()).toBe('This picture could not be read.')
    expect(scenes.search).not.toHaveBeenCalled()
    page.type('frieren')
    expect(page.status(), 'gone once the address moves on').not.toBe('This picture could not be read.')
  })

  test('the same picture again after a file that is no picture draws its results again, in the same step', async () => {
    scenes.search.mockResolvedValue(rabbit)
    const page = open(`/search?scene=${CODE}`)
    await flush()
    await showMedia()
    pasted(notPicture())
    await flush()
    expect(page.status()).toBe('This picture could not be read.')
    pasted(picture())
    await flush()
    expect(page.status()).toBeUndefined()
    expect(page.results()).toEqual(['rabbit'])
    expect(page.history).toEqual([`/search?scene=${CODE}`])
  })

  test('the search field has the picture button', () => {
    open('/search')
    expect(hosts.at(-1)!.querySelector('.text-field button[aria-label="Search by picture"]')).not.toBeNull()
    expect(hosts.at(-1)!.querySelector('.text-field input[type="file"][accept="image/*"]')).not.toBeNull()
  })
})
