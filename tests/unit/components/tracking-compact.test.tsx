// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'

import type { WindowSignIn } from '../../../src/sources/login-window'
import type { CompactPrefs } from '../../../src/tracking/compact-prefs'
import type { CompactAnswer, CompactTracking, Fields, TrackerOutcome } from '../../../src/tracking/compact'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Smile', 'Star'].map(name => [name, () => null])))

const { default: TrackingCompact } = await import('../../../src/components/tracking-compact')
const { createCompactPrefs } = await import('../../../src/tracking/compact-prefs')

const anilist: CompactAnswer = {
  state: 'LISTED',
  candidates: [],
  tracker: { id: 'anilist', name: 'AniList', canWrite: true, account: 'banou', scoreScale: 'POINT_10' },
  entry: { status: 'PAUSED', progress: 13, score: 60, episodeCount: 14 },
}
const stub: CompactAnswer = {
  state: 'NOT_LISTED',
  candidates: [],
  tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100' },
  entry: null,
}
const mal: CompactAnswer = {
  state: 'SIGNED_OUT',
  candidates: [],
  tracker: { id: 'mal', name: 'MyAnimeList', canWrite: true, scoreScale: 'POINT_10' },
  entry: null,
}
const tracking: CompactTracking = {
  summary: { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14 },
  disagreements: [],
  answers: [anilist, mal, stub],
}
const nothing: CompactTracking = { summary: null, disagreements: [], answers: [{ ...anilist, state: 'NOT_LISTED', entry: null }, stub] }

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
}

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
})

type Props = Partial<Parameters<typeof TrackingCompact>[0]>

const render = (props: Props = {}, store = createCompactPrefs(memory())) => {
  const onSaveFields = vi.fn(async (targets: string[], _entry: Fields) => targets.map(tracker => ({ tracker, outcome: 'SAVED' })))
  const onRemove = vi.fn(async (targets: string[]) => targets.map(tracker => ({ tracker, outcome: 'SAVED' })))
  let answer: (next: CompactTracking) => void = () => {}
  const Harness = () => {
    const [prefs, setPrefs] = useState(store.read)
    const [live, setLive] = useState(props.tracking ?? tracking)
    answer = setLive
    const onPrefs = (next: CompactPrefs) => { store.write(next); setPrefs(next) }
    return <TrackingCompact episodeCount={14} onSaveFields={onSaveFields} onRemove={onRemove} prefs={prefs} onPrefs={onPrefs} {...props} tracking={live}/>
  }
  const host = mount(<Harness/>)
  hosts.push(host)
  // the trackers answering again, as the subscription does after a write
  const setTracking = async (next: CompactTracking) => { await act(async () => { answer(next) }) }
  return { host, onSaveFields, onRemove, store, setTracking }
}

const q = <T extends Element = HTMLElement>(host: HTMLElement, selector: string) => host.querySelector<T & HTMLElement>(selector)!
const named = (host: HTMLElement, name: string) => q(host, `[aria-label="${name}"]`)
const click = async (element: HTMLElement) => { await act(async () => { element.click() }) }
const fire = async (element: HTMLElement, type: string, extra: Record<string, unknown> = {}) => {
  await act(async () => { element.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), extra)) })
}
const pickStatus = async (host: HTMLElement, value: string) => {
  const select = q<HTMLSelectElement>(host, 'select[name="compact-status"]')
  // linkedom's select has a getter alone
  Object.defineProperty(select, 'value', { value, configurable: true })
  await fire(select, 'change')
}
const tick = async (input: HTMLInputElement, on: boolean) => {
  Object.assign(input, { checked: on })
  await fire(input, 'change')
}
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('the compact tracking row', () => {
  test('lays out star, status, episodes, then the chips, with no advanced toggle', () => {
    const { host } = render()
    const order = [...host.querySelectorAll('.star, select, .progress-field, [data-chip], .advanced')]
      .map(element => element.getAttribute('data-chip') ?? (element.className.split(' ')[0] || element.tagName))
    expect(order).toEqual(['star', 'SELECT', 'progress-field', 'anilist', 'mal', 'stub'])
    expect(host.querySelector('[aria-label="Advanced tracking"]')).toBeNull()
  })

  test('three + clicks save once, after a second of quiet, to every checked tracker', async () => {
    vi.useFakeTimers()
    const long: CompactTracking = {
      ...tracking,
      summary: { ...tracking.summary!, episodeCount: 28 },
      answers: [{ ...anilist, entry: { ...anilist.entry!, episodeCount: 28 } }, mal, stub],
    }
    const { host, onSaveFields } = render({ tracking: long })
    for (let index = 0; index < 3; index++) {
      await click(named(host, 'One episode more'))
      await settle(300)
    }
    expect(q<HTMLInputElement>(host, '#compact-progress').value, 'the row shows the viewer its clicks').toBe('16')
    expect(onSaveFields).not.toHaveBeenCalled()
    await settle(1000)
    expect(onSaveFields.mock.calls).toEqual([
      [['anilist'], { progress: 16 }],
      [['stub'], { status: 'WATCHING', progress: 16, score: 80 }],
    ])
  })

  test('a status pick saves at once: the status alone to a listed tracker, the whole row to one that lists nothing', async () => {
    const { host, onSaveFields } = render()
    await pickStatus(host, 'DROPPED')
    expect(onSaveFields.mock.calls).toEqual([
      [['anilist'], { status: 'DROPPED' }],
      [['stub'], { status: 'DROPPED', progress: 13, score: 80 }],
    ])
  })

  test('Remove from list goes to each checked tracker that lists the media, and to no other', async () => {
    const stubListed: CompactAnswer = { ...stub, state: 'LISTED', entry: { status: 'WATCHING', progress: 13, episodeCount: 14 } }
    const { host, onRemove, onSaveFields } = render({ tracking: { ...tracking, answers: [anilist, mal, stubListed, { ...stub, tracker: { ...stub.tracker, id: 'kitsu', name: 'Kitsu' } }] } })
    await tick(q(host, 'input[name="compact-target-stub"]'), false)
    await pickStatus(host, 'REMOVE')
    expect(onRemove.mock.calls).toEqual([[['anilist']]])
    expect(onSaveFields).not.toHaveBeenCalled()
    expect(q(host, '[role="status"]').textContent).toBe('Removed from AniList')
  })

  test('Remove from list is offered only while a checked tracker lists the media', async () => {
    const options = (host: HTMLElement) => [...host.querySelectorAll('select option')].map(option => option.textContent)
    expect(options(render().host)).toContain('Remove from list')
    expect(options(render({ tracking: nothing }).host)).not.toContain('Remove from list')
    const unchecked = render()
    await tick(q(unchecked.host, 'input[name="compact-target-anilist"]'), false)
    expect(options(unchecked.host)).not.toContain('Remove from list')
  })

  test('a removal that fails says so, and Retry sends the removal again', async () => {
    const { host, onRemove } = render()
    onRemove.mockImplementation(async targets => targets.map(tracker => ({ tracker, outcome: 'FAILED', error: 'AniList is down' })))
    await pickStatus(host, 'REMOVE')
    await act(async () => {})
    expect(q(host, '[data-note="anilist"]').textContent).toContain('AniList did not save the removal: AniList is down')
    await click(button(q(host, '[data-note="anilist"]'), 'Retry')!)
    expect(onRemove.mock.calls).toEqual([[['anilist']], [['anilist']]])
  })

  test('Retry on a failed removal sends the + made while it was in flight, never the removal', async () => {
    vi.useFakeTimers()
    let answer: (outcomes: TrackerOutcome[]) => void = () => {}
    const { host, onRemove, onSaveFields } = render()
    onRemove.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    await pickStatus(host, 'REMOVE')
    await click(named(host, 'One episode more'))
    answer([{ tracker: 'anilist', outcome: 'FAILED', error: 'AniList is down' }])
    await settle()
    expect(q(host, '[data-note="anilist"]').textContent).toContain('did not save the removal')
    await click(button(q(host, '[data-note="anilist"]'), 'Retry')!)
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onSaveFields.mock.calls.filter(([targets]) => targets[0] === 'anilist')).toEqual([[['anilist'], { progress: 14 }]])
  })

  test('a tracker that could not take a removal and then a status retries the status alone', async () => {
    const paused: CompactAnswer = { ...mal, state: 'PAUSED' }
    const { host, onRemove, onSaveFields, setTracking } = render({ tracking: { ...tracking, answers: [anilist, paused, stub] } })
    await pickStatus(host, 'REMOVE')
    await pickStatus(host, 'WATCHING')
    onRemove.mockClear()
    onSaveFields.mockClear()
    await setTracking({ ...tracking, answers: [anilist, { ...mal, state: 'LISTED', entry: { status: 'PAUSED', progress: 3 } }, stub] })
    await click(button(q(host, '[data-note="mal"]'), 'Retry')!)
    expect(onRemove).not.toHaveBeenCalled()
    expect(onSaveFields.mock.calls).toEqual([[['mal'], { status: 'WATCHING' }]])
  })

  test('a removal kept for a paused tracker is dropped once it answers that it lists nothing', async () => {
    const paused: CompactAnswer = { ...mal, state: 'PAUSED' }
    const { host, onRemove, setTracking } = render({ tracking: { ...tracking, answers: [anilist, paused, stub] } })
    await pickStatus(host, 'REMOVE')
    expect(q(host, '[data-note="mal"]').textContent, 'the control').toContain('MyAnimeList did not save the removal: Paused for a while')
    await setTracking({ ...tracking, answers: [anilist, { ...mal, state: 'NOT_LISTED' }, stub] })
    expect(host.querySelector('[data-note="mal"]')).toBeNull()
    expect(host.querySelector('[data-chip="mal"] [data-badge]')).toBeNull()
    expect(onRemove.mock.calls).toEqual([[['anilist']]])
  })

  test('the star is disabled while nothing is listed', () => {
    const { host } = render({ tracking: nothing })
    expect(q<HTMLButtonElement>(host, '.star').disabled).toBe(true)
    expect(q(host, '.star').title).toBe('Pick a status or add an episode first')
    expect(q<HTMLSelectElement>(host, 'select').textContent).toContain('Add to list')
  })

  test('the star opens on the coarsest checked scale, a pick is written at once, no score clears, Escape sends nothing', async () => {
    const { host, onSaveFields } = render()
    expect(named(host, 'Score, 8 out of 10')).toBeTruthy()
    await click(q(host, '.star'))
    expect(q(host, '[role="dialog"]').getAttribute('aria-label')).toBe('Score')
    expect(host.querySelectorAll('[role="dialog"] .grid button').length).toBe(10)
    expect(q(host, '.caption').textContent).toContain('Out of 10')
    await click(named(host, '9 out of 10'))
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { score: 90 }], [['stub'], { status: 'WATCHING', progress: 13, score: 90 }]])
    expect(host.querySelector('[role="dialog"]')).toBeNull()

    await click(q(host, '.star'))
    await click(button(q(host, '[role="dialog"]'), 'No score')!)
    expect(onSaveFields).toHaveBeenCalledWith(['anilist'], { score: null })

    onSaveFields.mockClear()
    await click(q(host, '.star'))
    await fire(q(host, '[role="dialog"]'), 'keydown', { key: 'Escape' })
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(onSaveFields).not.toHaveBeenCalled()
  })

  test('an unchecked tracker is remembered across a remount and gets no write', async () => {
    const first = render()
    await tick(q(first.host, 'input[name="compact-target-stub"]'), false)
    expect(first.store.read().targets).toEqual({ stub: false })
    unmount(hosts.pop()!)

    const second = render({}, first.store)
    expect(q(second.host, '[data-chip="stub"]').className).toContain('off')
    await pickStatus(second.host, 'DROPPED')
    expect(second.onSaveFields.mock.calls).toEqual([[['anilist'], { status: 'DROPPED' }]])
  })

  test('a signed out tracker offers Log in, opens it inside the click, and says when the window was blocked', async () => {
    let finish: (outcome: WindowSignIn) => void = () => {}
    const signIn = vi.fn(() => new Promise<WindowSignIn>(resolve => { finish = resolve }))
    const { host, onSaveFields } = render({ signIns: { mal: signIn } })
    const login = named(host, 'Log in to MyAnimeList')
    expect(login.textContent).toBe('Log in')
    login.click()
    expect(signIn, 'called synchronously, inside the click').toHaveBeenCalledTimes(1)
    await act(async () => {})
    expect(named(host, 'Log in to MyAnimeList').textContent).toBe('Logging in')
    await act(async () => {
      finish('blocked')
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(q(host, '[data-note="mal"]').textContent).toContain('blocked the sign-in window')
    await pickStatus(host, 'DROPPED')
    expect(onSaveFields.mock.calls.map(([targets]) => targets[0])).not.toContain('mal')
  })

  test('a failed save marks the chip, and Retry resends its fields; a refusal says why with nothing to retry', async () => {
    const { host, onSaveFields } = render()
    onSaveFields.mockImplementation(async targets => targets.map(tracker => tracker === 'anilist'
      ? { tracker, outcome: 'FAILED', error: 'AniList asked stub to wait a minute' }
      : { tracker, outcome: 'REFUSED', error: 'Stub cannot' }))
    await pickStatus(host, 'DROPPED')
    await act(async () => {})
    expect(q(host, '[data-chip="anilist"] [data-badge="red"]')).toBeTruthy()
    const note = [...host.querySelectorAll('[data-note="anilist"]')].map(element => element.textContent).join()
    expect(note).toContain('AniList did not save the status: AniList asked stub to wait a minute')
    const refused = q(host, '[data-note="stub"]')
    expect(refused.textContent).toContain('Stub cannot')
    expect(button(refused, 'Retry')).toBeUndefined()

    onSaveFields.mockClear()
    await click(button(q(host, '[data-note="anilist"]'), 'Retry')!)
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { status: 'DROPPED' }]])
  })

  test('a chip is busy while its save is pending, and not once it settles', async () => {
    let finish: () => void = () => {}
    const { host, onSaveFields } = render()
    onSaveFields.mockImplementation(targets => new Promise(resolve => { finish = () => resolve(targets.map(tracker => ({ tracker, outcome: 'SAVED' }))) }))
    await tick(q(host, 'input[name="compact-target-stub"]'), false)
    await pickStatus(host, 'DROPPED')
    expect(q(host, '[data-chip="anilist"]').getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      finish()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(q(host, '[data-chip="anilist"]').hasAttribute('aria-busy')).toBe(false)
  })

  test('suggests Mark completed at the total and Set 14 / 14 when completed below it, and Completed alone sends no progress', async () => {
    const atTotal = render({ tracking: { ...tracking, summary: { ...tracking.summary!, progress: 14 } } })
    await click(button(atTotal.host, 'Mark completed')!)
    expect(atTotal.onSaveFields).toHaveBeenCalledWith(['anilist'], { status: 'COMPLETED' })

    const below = render({ tracking: { ...tracking, summary: { ...tracking.summary!, status: 'COMPLETED' } } })
    expect(button(below.host, 'Set 14 / 14')).toBeTruthy()
    await click(button(below.host, 'Set 14 / 14')!)
    expect(below.onSaveFields).toHaveBeenCalledWith(['anilist'], { progress: 14 })

    const picked = render()
    await pickStatus(picked.host, 'COMPLETED')
    expect(picked.onSaveFields).toHaveBeenCalledWith(['anilist'], { status: 'COMPLETED' })
  })

  test('names every control for a screen reader', () => {
    const { host } = render()
    expect(q(host, 'input[name="compact-target-anilist"]').getAttribute('aria-label')).toBe('Save to AniList')
    expect(named(host, 'Score, 8 out of 10').tagName).toBe('BUTTON')
    expect(named(host, 'One episode more').tagName).toBe('BUTTON')
    expect(q(host, 'label[for="compact-progress"]').textContent).toBe('Episodes')
  })

  test('with no checked tracker that can write, every editing control is disabled', async () => {
    const { host } = render()
    await tick(q(host, 'input[name="compact-target-anilist"]'), false)
    await tick(q(host, 'input[name="compact-target-stub"]'), false)
    for (const selector of ['.star', 'select', '#compact-progress', '.more']) {
      expect(q<HTMLButtonElement>(host, selector).disabled, selector).toBe(true)
    }
  })

  test('marks a field the trackers hold differently, naming each value and nothing else', () => {
    const stubListed: CompactAnswer = { ...stub, state: 'LISTED', entry: { status: 'WATCHING', progress: 11, episodeCount: 14 } }
    const { host } = render({ tracking: { ...tracking, disagreements: ['PROGRESS'], answers: [anilist, mal, stubListed] } })
    const marker = q(host, '.progress-field [data-differs="PROGRESS"]')
    expect(marker.title).toBe('AniList 13, Stub 11')
    expect(host.querySelector('[data-differs="STATUS"]')).toBeNull()
  })

  test('a tracker that counts other episodes says the row leaves its progress alone', () => {
    const { host } = render({ tracking: { ...tracking, answers: [{ ...anilist, entry: { ...anilist.entry!, episodeCount: 28 } }, mal, stub] } })
    const title = q(host, '[data-chip="anilist"]').title
    expect(title).toContain('AniList counts 28 episodes, so the row does not save progress there')
    expect(title).not.toMatch(/advanced|sync/i)
  })
})
