import type { PartyState } from '../../../src/party/store'

import { parseHTML } from 'linkedom'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { layer } from '../../../src/layers'
import { createUpdateGate } from '../../../src/update/gate'

/** A tab: its address, its focus, its party, its connection and its storage, each one a test can move. */
const tab = () => {
  const { document } = parseHTML('<!doctype html><html><head></head><body><main>Frieren</main></body></html>')
  const state = { party: { status: 'idle' } as PartyState, focused: null as Element | null, online: true }
  const stored = new Map<string, string>()
  const location = { pathname: '/', reload: vi.fn() }
  Object.defineProperty(document, 'activeElement', { get: () => state.focused })
  vi.stubGlobal('document', document)
  vi.stubGlobal('location', location)
  vi.stubGlobal('navigator', { get onLine () { return state.online } })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
  const party = { getState: () => state.party }
  return { document, state, location, stored, party, gate: createUpdateGate({ party }) }
}

/** The same tab after the reload: a fresh document and gate, the same storage. */
const reloaded = (before: ReturnType<typeof tab>) => {
  const after = tab()
  for (const [key, value] of before.stored) after.stored.set(key, value)
  return after
}

const updating = (document: Document) => [...document.body.children].find(element => element.textContent === 'Updating Stub') as HTMLElement | undefined

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('a due update at a safe moment covers the page with Updating Stub alone and reloads once', () => {
  const { document, location, gate } = tab()
  gate.due()
  expect(location.reload).toHaveBeenCalledOnce()
  const page = updating(document)
  expect(page?.style.cssText.replaceAll(' ', '')).toContain(`position:fixed;inset:0;z-index:${layer.updating}`)
  gate.due()
  vi.advanceTimersByTime(10_000)
  expect(location.reload).toHaveBeenCalledOnce()
})

describe('an update waits for its safe moment', () => {
  test('on /watch, until the page leaves it', () => {
    const { document, location, gate } = tab()
    location.pathname = '/watch/anilist-154587/1'
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
    expect(updating(document), 'nothing shows while it waits').toBeUndefined()
    location.pathname = '/title/anilist-154587'
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  test.each(['joining', 'active'] as const)('in a party %s, until it ends', status => {
    const { state, location, gate } = tab()
    state.party = status === 'joining'
      ? { status, invite: 'invite' }
      : { status, role: 'guest', invite: 'invite', members: 2, self: 'me', owner: 'host' }
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
    state.party = { status: 'ended', reason: 'left' }
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  test.each(['input', 'textarea', 'div contenteditable'])('while a %s is focused, until it blurs', field => {
    const { document, state, location, gate } = tab()
    const [tag, attribute] = field.split(' ')
    const element = document.createElement(tag!)
    if (attribute) element.setAttribute(attribute, '')
    document.body.append(element)
    state.focused = element
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
    state.focused = document.body
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  test.each([['type', 'checkbox'], ['readonly', '']])('a focused input with %s takes no typing, so it holds nothing', (name, value) => {
    const { document, state, location, gate } = tab()
    const input = document.createElement('input')
    input.setAttribute(name, value)
    state.focused = input
    gate.due()
    expect(location.reload).toHaveBeenCalledOnce()
  })

  test('while a video of the page plays, until it pauses', () => {
    const { document, location, gate } = tab()
    const video = Object.assign(document.createElement('video'), { paused: false, ended: false })
    document.body.append(video)
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
    video.paused = true
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })

  test('offline, until the connection is back', () => {
    const { state, location, gate } = tab()
    state.online = false
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
    state.online = true
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })
})

describe('the loop guard', () => {
  test('refuses a third automatic reload within five minutes, showing nothing, and goes once there is room', () => {
    const first = tab()
    first.gate.due()
    vi.advanceTimersByTime(60_000)
    const second = reloaded(first)
    second.gate.due()
    expect([first.location.reload, second.location.reload].map(reload => reload.mock.calls.length)).toEqual([1, 1])
    vi.advanceTimersByTime(60_000)
    const third = reloaded(second)
    third.gate.due()
    vi.advanceTimersByTime(2 * 60_000)
    expect(third.location.reload).not.toHaveBeenCalled()
    expect(updating(third.document)).toBeUndefined()
    // the first reload leaves the window five minutes after it
    vi.advanceTimersByTime(60_000)
    expect(third.location.reload).toHaveBeenCalledOnce()
  })

  test('with no storage to keep its record in, it never reloads by itself', () => {
    const { location, gate } = tab()
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} })
    gate.due()
    vi.advanceTimersByTime(30_000)
    expect(location.reload).not.toHaveBeenCalled()
  })
})
