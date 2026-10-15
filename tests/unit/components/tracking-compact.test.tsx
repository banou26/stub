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
  delete (document as { activeElement?: Element }).activeElement
})

// linkedom tracks no focus, so this says which element a browser would report as focused
const focusOn = (element: Element) => {
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => element })
}

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
const fire = async (target: EventTarget, type: string, extra: Record<string, unknown> = {}) => {
  await act(async () => { target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), extra)) })
}
// the row's own menu comes first, so on the whole row this is the row's and on a card the card's
const pickStatus = async (host: HTMLElement, value: string) => {
  const select = q<HTMLSelectElement>(host, 'select')
  // linkedom's select has a getter alone
  Object.defineProperty(select, 'value', { value, configurable: true })
  await fire(select, 'change')
}
const tick = async (input: HTMLInputElement, on: boolean) => {
  Object.assign(input, { checked: on })
  await fire(input, 'change')
}
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
const wait = async (ms: number) => {
  if (vi.isFakeTimers()) await settle(ms)
  else await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)) })
}
const chip = (host: HTMLElement, id: string) => q(host, `[data-chip="${id}"]`)
const cardOf = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-card="${id}"]`)
// linkedom delivers an event to preact's handlers only on the element it is dispatched on, so these
// fire on the chip itself what a browser bubbles up to it
const hover = async (host: HTMLElement, id: string, pointerType = 'mouse') => {
  await fire(chip(host, id), 'pointerenter', { pointerType })
  await fire(chip(host, id), 'mouseenter')
  await wait(150)
  return cardOf(host, id)!
}

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
    await hover(host, 'mal')
    const logins = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Log in to MyAnimeList"]')]
    expect(logins.map(login => [login.textContent, login.disabled]), "the chip's and the card's").toEqual([['Logging in', true], ['Logging in', true]])
    logins[1]!.click()
    expect(signIn, 'one window at a time').toHaveBeenCalledTimes(1)
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

  test("unchecking a chip drops the row's waiting change for it, never what its own card holds", async () => {
    vi.useFakeTimers()
    const row = render()
    await click(q(q(row.host, '.row > .edit'), '.more'))
    await tick(q(row.host, 'input[name="compact-target-anilist"]'), false)
    await settle(1000)
    expect(row.onSaveFields.mock.calls.map(([targets]) => targets[0])).toEqual(['stub'])

    const card = render()
    await click(q(await hover(card.host, 'stub'), '.more'))
    await tick(q(card.host, 'input[name="compact-target-stub"]'), false)
    await settle(1000)
    expect(card.onSaveFields.mock.calls).toEqual([[['stub'], { status: 'WATCHING', progress: 1 }]])

    // the card's 14 and the row's 11 wait as one write to AniList
    const both = render({ tracking: { ...tracking, summary: { ...tracking.summary!, progress: 10 }, disagreements: ['PROGRESS'] } })
    await click(q(await hover(both.host, 'anilist'), '.more'))
    await click(q(q(both.host, '.row > .edit'), '.more'))
    await tick(q(both.host, 'input[name="compact-target-anilist"]'), false)
    await settle(1000)
    expect(both.onSaveFields.mock.calls.filter(([targets]) => targets[0] === 'anilist')).toEqual([[['anilist'], { progress: 14 }]])

    // a card's removal already sent is not sent again
    const removed = render()
    await pickStatus(await hover(removed.host, 'anilist'), 'REMOVE')
    await click(q(q(removed.host, '.row > .edit'), '.more'))
    await tick(q(removed.host, 'input[name="compact-target-anilist"]'), false)
    await settle(1000)
    expect(removed.onRemove.mock.calls).toEqual([[['anilist']]])
    expect(removed.onSaveFields.mock.calls.map(([targets]) => targets[0])).toEqual(['stub'])
  })

  test("unchecking a chip keeps a removal its card made while that tracker's save was in flight", async () => {
    vi.useFakeTimers()
    const { host, onSaveFields, onRemove } = render()
    let land = () => {}
    onSaveFields.mockImplementation(async (targets: string[]) => {
      if (targets[0] === 'anilist') await new Promise<void>(resolve => { land = resolve })
      return targets.map(tracker => ({ tracker, outcome: 'SAVED' }))
    })
    await click(q(await hover(host, 'anilist'), '.more'))
    await settle(1000)
    await pickStatus(cardOf(host, 'anilist')!, 'REMOVE')
    await tick(q(host, 'input[name="compact-target-anilist"]'), false)
    await act(async () => { land() })
    await settle(3000)
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { progress: 14 }]])
    expect(onRemove.mock.calls).toEqual([[['anilist']]])
  })

  test('a tracker that counts other episodes gets no progress from the row, which says so, and its card takes it', async () => {
    vi.useFakeTimers()
    const { host, onSaveFields } = render({ tracking: { ...tracking, answers: [{ ...anilist, entry: { ...anilist.entry!, episodeCount: 28 } }, mal, stub] } })
    await click(q(q(host, '.row > .edit'), '.more'))
    await settle(1000)
    expect(onSaveFields.mock.calls.map(([targets]) => targets[0])).toEqual(['stub'])
    expect(q(host, '[data-note="anilist"]').textContent).toBe('AniList: set progress on its card')
    expect(host.querySelector('[data-note="stub"]'), 'the control: stub counts what the row counts').toBeNull()

    onSaveFields.mockClear()
    const card = await hover(host, 'anilist')
    expect(card.textContent).not.toMatch(/advanced|sync/i)
    expect(q(card, '.of').textContent, 'counted on its own episodes').toBe('/ 28')
    await click(q(card, '.more'))
    await settle(1000)
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { progress: 14 }]])
  })
})

describe('a tracker with no id for the media', () => {
  // AniList and MyAnimeList key an entry on their own id, which no live-action title has
  test('has no chip, while one that is signed out still offers Log in', () => {
    const { host } = render({ tracking: { ...tracking, answers: [{ ...anilist, state: 'NO_ID', entry: null }, mal, stub] } })
    expect(host.querySelector('[data-chip="anilist"]')).toBeNull()
    expect(chip(host, 'mal').classList.contains('login')).toBe(true)
    expect(chip(host, 'stub')).toBeTruthy()
  })

  test('a media no tracker has an id for has no row', () => {
    const { host } = render({ tracking: { summary: null, disagreements: [], answers: [{ ...anilist, state: 'NO_ID', entry: null }, { ...stub, state: 'NO_ID' }] } })
    expect(host.querySelector('.tracking-compact')).toBeNull()
  })
})

describe("a read-only tracker, Crunchyroll's own history", () => {
  const cr = (state: string, entry: CompactAnswer['entry'] = null, extra: Partial<CompactAnswer> = {}): CompactAnswer =>
    ({ state, candidates: [], tracker: { id: 'cr', name: 'Crunchyroll', canWrite: false, readOnly: true, scoreScale: 'POINT_100' }, entry, ...extra })

  test("its chip shows how far the viewer got there, with nothing to check, and so does its card, on the row's count", async () => {
    const { host } = render({ tracking: { ...tracking, answers: [anilist, mal, stub, cr('LISTED', { progress: 8 })] } })

    expect(named(host, 'Crunchyroll: 8 watched').textContent).toBe('8')
    expect(chip(host, 'cr').querySelector('input, .login-button')).toBeNull()
    const card = await hover(host, 'cr')
    expect(card.textContent).toContain('Watched 8 / 14')
    expect(card.querySelector('select, input, .star')).toBeNull()
    expect(card.textContent).not.toContain('cannot track')
  })

  test('nothing watched there reads 0', () => {
    const { host } = render({ tracking: { ...tracking, answers: [anilist, mal, stub, cr('NOT_LISTED')] } })
    expect(named(host, 'Crunchyroll: 0 watched').textContent).toBe('0')
  })

  test('the row marks where its progress differs from the others, naming each', () => {
    const answers = [anilist, mal, stub, cr('LISTED', { progress: 8 })]
    const { host } = render({ tracking: { summary: { ...tracking.summary, progress: 13 }, disagreements: ['PROGRESS'], answers } })
    expect(q(host, '.progress-field [data-differs="PROGRESS"]').title).toBe('AniList 13, Crunchyroll 8')
  })

  test('signed out, it offers its sign in like any tracker', () => {
    const { host } = render({ tracking: { ...tracking, answers: [anilist, mal, stub, cr('SIGNED_OUT')] } })
    expect(chip(host, 'cr').classList.contains('login')).toBe(true)
  })

  test('a change on the row never goes to it, and a failing read shows its badge and reason with no save problem', async () => {
    vi.useFakeTimers()
    const failing = cr('ERROR', null, { error: 'Crunchyroll answered 503' })
    const { host, onSaveFields } = render({ tracking: { ...tracking, answers: [anilist, mal, stub, failing] } })

    await pickStatus(host, 'COMPLETED')
    await click(named(host, 'One episode more'))
    await settle(1000)
    expect(onSaveFields.mock.calls.flatMap(([targets]) => targets).sort()).toEqual(['anilist', 'anilist', 'stub', 'stub'])
    expect(host.querySelector('[data-note="cr"]')).toBeNull()
    expect(host.querySelector('[data-chip="cr"] [data-badge="red"]')).toBeTruthy()
    expect(named(host, 'Crunchyroll: Crunchyroll answered 503')).toBeTruthy()
    expect((await hover(host, 'cr')).textContent).toContain('Crunchyroll answered 503')
  })
})

describe('a tracker that has not answered yet', () => {
  test('has its chip at once, busy, with nothing to check, and the row writes to the trackers that answered', async () => {
    vi.useFakeTimers()
    const loading: CompactAnswer = { ...mal, state: 'LOADING' }
    const { host, onSaveFields } = render({ tracking: { ...tracking, answers: [anilist, loading, stub] } })

    expect(chip(host, 'mal').classList.contains('loading')).toBe(true)
    expect(chip(host, 'mal').getAttribute('aria-busy')).toBe('true')
    expect(named(host, 'MyAnimeList loading')).toBeTruthy()
    expect(chip(host, 'mal').querySelector('input, .login-button')).toBeNull()

    await click(named(host, 'One episode more'))
    await settle(1000)
    expect(onSaveFields.mock.calls.map(([targets]) => targets).flat().sort()).toEqual(['anilist', 'stub'])
  })

  test('its card names it and offers nothing to change', async () => {
    const { host } = render({ tracking: { ...tracking, answers: [anilist, { ...mal, state: 'LOADING' }, stub] } })
    const card = await hover(host, 'mal')
    expect(card.querySelector('.head')?.textContent).toContain('MyAnimeList')
    expect(card.querySelector('select, button, .why')).toBeNull()
  })
})

// HOR-329: a movie is watched or not, so its row and cards carry one Watched toggle instead of a count
describe('a movie', () => {
  const movieAnilist: CompactAnswer = { ...anilist, entry: { status: 'PLANNING', progress: 0, score: null, episodeCount: 1 } }
  const planned: CompactTracking = { summary: { status: 'PLANNING', progress: 0, score: null, episodeCount: 1 }, disagreements: [], answers: [movieAnilist, mal, stub] }
  const watchedOnes: CompactTracking = {
    summary: { status: 'COMPLETED', progress: 1, score: null, episodeCount: 1 },
    disagreements: [],
    answers: [{ ...movieAnilist, entry: { status: 'COMPLETED', progress: 1, score: null, episodeCount: 1 } }, mal, stub],
  }
  const watchedButton = (host: HTMLElement) => q<HTMLButtonElement>(host, 'button.watched')

  test('the row has a Watched toggle and no episode count, Mark completed or Set 1 / 1', () => {
    const { host } = render({ movie: true, episodeCount: 1, tracking: planned })
    expect(watchedButton(host).textContent).toBe('Watched')
    expect(watchedButton(host).getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('.progress-field'), 'no episode count').toBeNull()
    expect(button(host, 'Mark completed')).toBeFalsy()
    expect(button(host, 'Set 1 / 1')).toBeFalsy()
  })

  test('Watched marks it completed with its one episode, on every checked tracker', async () => {
    const { host, onSaveFields } = render({ movie: true, episodeCount: 1, tracking: planned })
    await click(watchedButton(host))
    expect(onSaveFields.mock.calls.map(([targets]) => targets).flat().sort()).toEqual(['anilist', 'stub'])
    for (const [, fields] of onSaveFields.mock.calls) expect(fields).toEqual({ progress: 1, status: 'COMPLETED' })
  })

  test('once watched it reads as pressed, and turning it off takes it back to the plan with no progress', async () => {
    const { host, onSaveFields } = render({ movie: true, episodeCount: 1, tracking: watchedOnes })
    expect(watchedButton(host).getAttribute('aria-pressed')).toBe('true')
    expect(watchedButton(host).classList.contains('on')).toBe(true)
    await click(watchedButton(host))
    expect(onSaveFields.mock.calls.find(([targets]) => targets.includes('anilist'))?.[1]).toEqual({ progress: 0, status: 'PLANNING' })
  })

  test("a tracker's card carries the same toggle, writing to that tracker alone", async () => {
    const { host, onSaveFields } = render({ movie: true, episodeCount: 1, tracking: planned })
    const card = await hover(host, 'anilist')
    expect(card.querySelector('.progress-field')).toBeNull()
    await click(watchedButton(card))
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { progress: 1, status: 'COMPLETED' }]])
  })

  test('a series keeps its episode count', () => {
    const { host } = render()
    expect(host.querySelector('button.watched')).toBeNull()
    expect(host.querySelector('.progress-field')).toBeTruthy()
  })
})

describe("a tracker's card", () => {
  test("opens on hover over the chip, with that tracker's own entry in the same controls as the row", async () => {
    const { host } = render()
    expect(cardOf(host, 'anilist')).toBeNull()
    const card = await hover(host, 'anilist')
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.textContent).toContain('AniList')
    expect(card.textContent).toContain('banou')
    expect(named(card, 'Score, 6 out of 10'), 'its own score, where the row shows the summary 8').toBeTruthy()
    expect(q<HTMLInputElement>(card, 'input[type="number"]').value).toBe('13')
    expect([...card.querySelectorAll('select option')].map(option => option.textContent)).toContain('Remove from list')
    expect(named(chip(host, 'anilist'), 'AniList entry').getAttribute('aria-expanded')).toBe('true')
  })

  test('a change on a card goes to that tracker alone, checked or not', async () => {
    const { host, onSaveFields, onRemove } = render()
    await tick(q(host, 'input[name="compact-target-stub"]'), false)
    const stubCard = await hover(host, 'stub')
    await pickStatus(stubCard, 'PLANNING')
    expect(onSaveFields.mock.calls).toEqual([[['stub'], { status: 'PLANNING', progress: 0 }]])

    onSaveFields.mockClear()
    const anilistCard = await hover(host, 'anilist')
    await pickStatus(anilistCard, 'REMOVE')
    expect(onRemove.mock.calls).toEqual([[['anilist']]])
    expect(onSaveFields).not.toHaveBeenCalled()
  })

  test('the card of a tracker that lists nothing offers Add to list, no Remove from list, and a star that waits for a status', async () => {
    const { host } = render()
    const card = await hover(host, 'stub')
    const options = [...card.querySelectorAll('select option')].map(option => option.textContent)
    expect(options).toContain('Add to list')
    expect(options).not.toContain('Remove from list')
    expect(q<HTMLButtonElement>(card, '.star').disabled).toBe(true)
  })

  test("a card's star is on its own tracker's scale, not the row's", async () => {
    const stubListed: CompactAnswer = { ...stub, state: 'LISTED', entry: { status: 'WATCHING', progress: 2, score: 80, episodeCount: 14 } }
    const { host } = render({ tracking: { ...tracking, answers: [anilist, mal, stubListed] } })
    expect(named(q(host, '.row > .edit'), 'Score, 8 out of 10'), 'the row is on AniList\'s ten points').toBeTruthy()
    expect(named(await hover(host, 'stub'), 'Score, 80 out of 100')).toBeTruthy()
  })

  test("a card keeps the viewer's pick until its own tracker answers with it, whatever the row shows", async () => {
    const { host, onSaveFields, setTracking } = render()
    onSaveFields.mockImplementation(() => new Promise(() => {}))
    await pickStatus(await hover(host, 'stub'), 'WATCHING')
    await setTracking({ ...tracking })
    expect(q(cardOf(host, 'stub')!, 'select').textContent, 'the row reads Watching, and stub has not answered').not.toContain('Add to list')
  })

  test("once its tracker answers with the viewer's value, a card shows what the tracker holds next", async () => {
    const { host, setTracking } = render()
    await click(q(await hover(host, 'anilist'), '.more'))
    const input = () => q<HTMLInputElement>(cardOf(host, 'anilist')!, 'input[type="number"]')
    expect(input().value).toBe('14')
    await setTracking({ ...tracking, answers: [{ ...anilist, entry: { ...anilist.entry!, progress: 14 } }, mal, stub] })
    await setTracking({ ...tracking, answers: [{ ...anilist, entry: { ...anilist.entry!, progress: 9 } }, mal, stub] })
    expect(input().value, 'set elsewhere since').toBe('9')
  })

  test('+ clicks on a card show at once and save once, after a second of quiet, to that tracker', async () => {
    vi.useFakeTimers()
    const long: CompactTracking = {
      ...tracking,
      summary: { ...tracking.summary!, episodeCount: 28 },
      answers: [{ ...anilist, entry: { ...anilist.entry!, episodeCount: 28 } }, mal, stub],
    }
    const { host, onSaveFields } = render({ tracking: long })
    const card = await hover(host, 'anilist')
    await click(q(card, '.more'))
    await click(q(card, '.more'))
    expect(q<HTMLInputElement>(card, 'input[type="number"]').value).toBe('15')
    expect(q<HTMLInputElement>(host, '#compact-progress').value, 'the row keeps the summary').toBe('13')
    expect(onSaveFields).not.toHaveBeenCalled()
    await settle(1000)
    expect(onSaveFields.mock.calls).toEqual([[['anilist'], { progress: 15 }]])
  })

  test('Escape and a press outside close it, and Escape inside it hands focus back to the logo', async () => {
    const { host } = render()
    await hover(host, 'anilist')
    // linkedom bubbles nothing up to the document, so the press lands there directly
    await fire(document, 'pointerdown', { pointerType: 'mouse', button: 0 })
    expect(cardOf(host, 'anilist'), 'closed by a press outside').toBeNull()

    const logo = named(chip(host, 'anilist'), 'AniList entry')
    const focus = vi.spyOn(logo, 'focus')
    await hover(host, 'anilist')
    await fire(document, 'keydown', { key: 'Escape' })
    expect(cardOf(host, 'anilist'), 'closed by Escape').toBeNull()
    expect(focus, 'focus was not in the card').not.toHaveBeenCalled()

    const card = await hover(host, 'anilist')
    focusOn(q(card, '.more'))
    await fire(document, 'keydown', { key: 'Escape' })
    expect(cardOf(host, 'anilist')).toBeNull()
    expect(focus).toHaveBeenCalledTimes(1)
  })

  test('stays open while focus is inside it, wherever the pointer goes', async () => {
    const { host } = render()
    await hover(host, 'stub')
    await fire(document.documentElement, 'mouseleave')
    expect(cardOf(host, 'stub'), 'the control: a pointer leaving closes it').toBeNull()

    const card = await hover(host, 'stub')
    focusOn(q(card, 'input[type="number"]'))
    await fire(document.documentElement, 'mouseleave')
    expect(cardOf(host, 'stub')).toBeTruthy()
  })

  test("a paused or failing tracker's card says why in its own words, and nothing in it can be changed", async () => {
    const paused: CompactAnswer = { ...anilist, state: 'PAUSED', entry: null }
    const failing: CompactAnswer = { ...stub, state: 'ERROR', error: 'Stub is down' }
    const { host } = render({ tracking: { ...tracking, answers: [paused, mal, failing] } })
    for (const [id, why] of [['anilist', 'Paused for a while'], ['stub', 'Stub is down']] as const) {
      const card = await hover(host, id)
      expect(card.textContent).toContain(why)
      for (const selector of ['.star', 'select', 'input[type="number"]', '.more']) {
        expect(q<HTMLButtonElement>(card, selector).disabled, `${id} ${selector}`).toBe(true)
      }
    }
  })

  // the owner saw "MyAnimeList cannot track this media: Is read only" for a read that had failed
  test('a paused or failing tracker that has not read the account yet shows its badge and its reason, and keeps a change for Retry', async () => {
    const paused: CompactAnswer = { ...mal, state: 'PAUSED', tracker: { ...mal.tracker, canWrite: false } }
    const failing: CompactAnswer = { ...anilist, state: 'ERROR', entry: null, error: 'AniList answered 502', tracker: { ...anilist.tracker, canWrite: false, account: null } }
    const { host, onSaveFields } = render({ tracking: { ...tracking, answers: [failing, paused, stub] } })

    expect(host.querySelector('[data-chip="anilist"] [data-badge="red"]')).toBeTruthy()
    expect(host.querySelector('[data-chip="mal"] [data-badge="amber"]')).toBeTruthy()
    expect(host.innerHTML).not.toContain('read only')
    expect((await hover(host, 'anilist')).textContent).toContain('AniList answered 502')

    await pickStatus(host, 'COMPLETED')
    expect(q(host, '[data-note="mal"]').textContent).toContain('MyAnimeList did not save')
    expect(q(host, '[data-note="anilist"]').textContent).toContain('AniList answered 502')
    expect(onSaveFields.mock.calls.flatMap(([targets]) => targets)).toEqual(['stub'])
  })

  test('Retry sends a change kept while its tracker could not answer as that tracker takes a change once it answers', async () => {
    const failing: CompactAnswer = { ...mal, state: 'ERROR', error: 'boom', tracker: { ...mal.tracker, canWrite: false } }
    const listed: CompactAnswer = { ...stub, state: 'LISTED', entry: { status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 } }
    const twelve: CompactTracking = { summary: { status: 'WATCHING', progress: 3, score: 80, episodeCount: 12 }, disagreements: [], answers: [failing, listed] }
    const added = render({ tracking: twelve })
    await click(named(added.host, 'One episode more'))
    expect(q(added.host, '[data-note="mal"]').textContent).toContain('MyAnimeList did not save episode 4: boom')
    await added.setTracking({ ...twelve, answers: [{ ...mal, state: 'NOT_LISTED' }, listed] })
    await click(button(q(added.host, '[data-note="mal"]'), 'Retry')!)
    expect(added.onSaveFields.mock.calls.filter(([targets]) => targets[0] === 'mal'), 'the whole row to one listing nothing')
      .toEqual([[['mal'], { status: 'WATCHING', progress: 4, score: 80 }]])

    const long: CompactTracking = { ...twelve, summary: { ...twelve.summary, episodeCount: 24 }, answers: [failing, { ...listed, entry: { ...listed.entry, progress: 13, episodeCount: 24 } }] }
    const counted = render({ tracking: long })
    await click(named(counted.host, 'One episode more'))
    await counted.setTracking({ ...long, answers: [{ ...mal, state: 'LISTED', entry: { status: 'WATCHING', progress: 3, episodeCount: 12 } }, long.answers[1]!] })
    await click(button(q(counted.host, '[data-note="mal"]'), 'Retry')!)
    expect(counted.onSaveFields.mock.calls.filter(([targets]) => targets[0] === 'mal'), 'no progress to one counting other episodes').toEqual([])
  })

  test('opening a card closes the one open before it, but a hover never takes over a card holding focus', async () => {
    const { host } = render()
    await hover(host, 'stub')
    await hover(host, 'mal')
    expect(cardOf(host, 'stub'), 'one card at a time').toBeNull()

    focusOn(q(await hover(host, 'stub'), 'input[type="number"]'))
    await hover(host, 'mal')
    expect(cardOf(host, 'stub'), 'still being typed in').toBeTruthy()
    expect(cardOf(host, 'mal')).toBeNull()
    await click(named(chip(host, 'mal'), 'MyAnimeList entry'))
    expect(cardOf(host, 'mal'), 'a press on its logo moves to it').toBeTruthy()
    expect(cardOf(host, 'stub')).toBeNull()
  })

  test('opens on keyboard focus inside the chip', async () => {
    const { host } = render()
    await fire(chip(host, 'stub'), 'focusin')
    expect(cardOf(host, 'stub')).toBeTruthy()
  })

  test('on a touch screen a touch is no hover, and a tap on the logo opens it without checking or unchecking', async () => {
    const { host, store } = render()
    expect(await hover(host, 'anilist', 'touch'), 'a touch is not a hover').toBeNull()
    const logo = named(chip(host, 'anilist'), 'AniList entry')
    await fire(logo, 'pointerdown', { pointerType: 'touch' })
    await click(logo)
    expect(cardOf(host, 'anilist')).toBeTruthy()
    expect(store.read().targets, 'the logo is not the check').toEqual({})
  })

  test('a signed out tracker offers its sign in, and one that cannot track says why', async () => {
    const signIn = vi.fn(() => new Promise<WindowSignIn>(() => {}))
    const ambiguous: CompactAnswer = { ...stub, state: 'AMBIGUOUS', candidates: ['stub:1', 'stub:2'], tracker: { ...stub.tracker, id: 'kitsu', name: 'Kitsu' } }
    const { host } = render({ signIns: { mal: signIn }, tracking: { ...tracking, answers: [anilist, mal, ambiguous] } })
    const malCard = await hover(host, 'mal')
    expect(malCard.textContent).toContain('Signed out')
    button(malCard, 'Log in')!.click()
    expect(signIn).toHaveBeenCalledTimes(1)
    const kitsuCard = await hover(host, 'kitsu')
    expect(kitsuCard.textContent).toContain('Kitsu cannot track this media: Names stub:1 and stub:2, cannot tell which')
    expect(kitsuCard.querySelector('select')).toBeNull()
  })
})
