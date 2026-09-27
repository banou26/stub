// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'preact/test-utils'

import type { PanelAnswer, PanelTracking, SignInOutcome } from '../../../src/components/tracking-panel'

// lucide-react is a CommonJS build whose `require('react')` runs under node, where no alias reaches
// it (the same reason seek-preview.test.tsx mocks react-feather). The icons carry no behaviour here.
vi.mock('lucide-react', () => Object.fromEntries(['Frown', 'Meh', 'Minus', 'Plus', 'Smile'].map(name => [name, () => null])))

const { default: TrackingPanel } = await import('../../../src/components/tracking-panel')

// The panel over two providers, each answering alone. linkedom has no `checked` property on an input,
// so a checkbox is read the way preact writes it there (the attribute) until a test sets the property.

const stub: PanelAnswer = {
  _id: 'answer:stub',
  state: 'LISTED',
  candidates: [],
  tracker: { id: 'stub', name: 'Stub', canWrite: true, account: 'This device' },
  entry: { _id: 'stub:e1', status: 'WATCHING', progress: 5, score: 80, episodeCount: 12 },
}
const other: PanelAnswer = {
  _id: 'answer:other',
  state: 'NOT_LISTED',
  candidates: [],
  tracker: { id: 'other', name: 'Other', canWrite: true, account: 'someone' },
  entry: null,
}
const tracking: PanelTracking = {
  summary: { _id: 'summary:x', status: 'WATCHING', progress: 5, score: 80, episodeCount: 12 },
  disagreements: [],
  answers: [stub, other],
}

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const render = (props: Partial<Parameters<typeof TrackingPanel>[0]> = {}) => {
  const onSave = vi.fn(async (targets: string[]) => targets.map(tracker => ({ tracker, outcome: 'SAVED' })))
  const onDelete = vi.fn(async (targets: string[]) => targets.map(tracker => ({ tracker, outcome: 'SAVED' })))
  const onSyncWrite = vi.fn(async (tracker: string) => [{ tracker, outcome: 'SAVED' }])
  const host = mount(<TrackingPanel tracking={tracking} episodeCount={12} onSave={onSave} onDelete={onDelete} onSyncWrite={onSyncWrite} {...props}/>)
  hosts.push(host)
  return { host, onSave, onDelete }
}

const row = (host: HTMLElement, tracker: string) => host.querySelector<HTMLElement>(`[data-tracker="${tracker}"]`)!
const target = (host: HTMLElement, tracker: string) => host.querySelector<HTMLInputElement>(`input[name="target-${tracker}"]`)!
const ticked = (input: HTMLInputElement) => {
  // typed as a plain Element, because the DOM types promise a `checked` linkedom does not have
  const element: Element = input
  return 'checked' in element ? Boolean(element.checked) : element.hasAttribute('checked')
}

const tick = async (input: HTMLInputElement, on: boolean) => {
  await act(async () => {
    Object.assign(input, { checked: on })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('the tracking panel', () => {
  test('shows the summary and one row per provider, each with its own answer', () => {
    const { host } = render()

    expect(host.querySelector('.summary')!.textContent).toContain('Watching')
    expect(host.querySelector('.summary')!.textContent).toContain('5 / 12')
    expect(host.querySelector('.summary')!.textContent).toContain('80%')
    expect(row(host, 'stub').textContent).toContain('Watching · 5 / 12 · 80%')
    expect(row(host, 'other').textContent).toContain('Not listed')
  })

  test('the editor ticks the provider being edited and no other, and saves to that one alone', async () => {
    const { host, onSave } = render()
    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })

    expect(ticked(target(host, 'stub'))).toBe(true)
    expect(ticked(target(host, 'other')), 'a connected provider is never ticked for the viewer').toBe(false)

    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="One episode more"]')!.click() })
    await act(async () => { button(host, 'Save')!.click() })

    expect(onSave).toHaveBeenCalledWith(['stub'], { status: 'WATCHING', progress: 6, score: 80 })
    expect(host.querySelector('.editor'), 'closed once every write landed').toBeNull()
  })

  test('a provider the viewer ticks is written to as well', async () => {
    const { host, onSave } = render()
    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })
    await tick(target(host, 'other'), true)
    await act(async () => { button(host, 'Save')!.click() })

    expect(onSave).toHaveBeenCalledWith(['stub', 'other'], { status: 'WATCHING', progress: 5, score: 80 })
  })

  test('editing a provider that lists nothing starts from nothing, not from the other provider', async () => {
    const { host, onSave } = render()
    await act(async () => { button(row(host, 'other'), 'Edit')!.click() })

    expect(ticked(target(host, 'other'))).toBe(true)
    expect(ticked(target(host, 'stub'))).toBe(false)
    await act(async () => { button(host, 'Save')!.click() })
    expect(onSave).toHaveBeenCalledWith(['other'], { status: 'WATCHING', progress: 0, score: null })
  })

  test('a refused write keeps the editor open and says why', async () => {
    const onSave = vi.fn(async () => [{ tracker: 'stub', outcome: 'REFUSED', error: 'no id for this media' }])
    const { host } = render({ onSave })
    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })
    await act(async () => { button(host, 'Save')!.click() })

    expect(host.querySelector('.editor')).not.toBeNull()
    expect(host.querySelector('.outcome')!.textContent).toBe('Stub: no id for this media')
  })

  test('remove goes to the ticked providers', async () => {
    const { host, onDelete } = render()
    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })
    await act(async () => { button(host, 'Remove')!.click() })

    expect(onDelete).toHaveBeenCalledWith(['stub'])
  })

  test('an ambiguous provider says which ids it saw and offers no editor', () => {
    const ambiguous: PanelAnswer = { ...other, state: 'AMBIGUOUS', candidates: ['anilist:1', 'anilist:2'] }
    const { host } = render({ tracking: { ...tracking, answers: [stub, ambiguous] } })

    expect(row(host, 'other').textContent).toContain('anilist:1 and anilist:2')
    expect(button(row(host, 'other'), 'Edit')).toBeUndefined()
    expect(button(row(host, 'stub'), 'Edit'), 'the control').toBeDefined()
  })

  test('nothing listed anywhere reads as such', () => {
    const { host } = render({ tracking: { summary: null, disagreements: [], answers: [{ ...stub, state: 'NOT_LISTED', entry: null }, other] } })
    expect(host.querySelector('.summary')!.textContent).toContain('Not on any list')
  })
})

const NOTICE = 'Saving to AniList can post list activity that your followers see.'

const anilist = (answer: Partial<PanelAnswer> = {}): PanelAnswer => ({
  _id: 'answer:anilist',
  state: 'SIGNED_OUT',
  candidates: [],
  tracker: { id: 'anilist', name: 'AniList', canWrite: false, account: null, scoreScale: 'POINT_100', writeNotice: NOTICE },
  entry: null,
  ...answer,
})

/** A sign in the test ends by hand, as the window would. */
const pendingSignIn = () => {
  let end!: (outcome: SignInOutcome) => void
  const signIn = vi.fn(() => new Promise<SignInOutcome>(resolve => { end = resolve }))
  return { signIn, end: async (outcome: SignInOutcome) => { await act(async () => { end(outcome) }) } }
}

describe('signing in from the panel', () => {
  test('a signed-out tracker with a sign in offers it, and the click starts it at once', async () => {
    const { signIn, end } = pendingSignIn()
    const { host } = render({ tracking: { ...tracking, answers: [stub, anilist()] }, signIns: { anilist: signIn } })

    expect(row(host, 'anilist').textContent).toContain('Signed out')
    await act(async () => { button(row(host, 'anilist'), 'Sign in')!.click() })
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(button(row(host, 'anilist'), 'Signing in')!.disabled, 'no second window while one is open').toBe(true)

    await end('authed')
    expect(button(row(host, 'anilist'), 'Sign in')).toBeDefined()
    expect(host.querySelector('[data-note="anilist"]')).toBeNull()
  })

  test('a window the browser blocked says so under the row', async () => {
    const { signIn, end } = pendingSignIn()
    const { host } = render({ tracking: { ...tracking, answers: [stub, anilist()] }, signIns: { anilist: signIn } })

    await act(async () => { button(row(host, 'anilist'), 'Sign in')!.click() })
    await end('blocked')
    expect(host.querySelector('[data-note="anilist"]')!.textContent).toContain('blocked the sign-in window')
  })

  test('no sign in is offered without one, nor on a tracker that is signed in', () => {
    const signIn = vi.fn()
    const { host } = render({ tracking: { ...tracking, answers: [stub, anilist()] } })
    expect(button(row(host, 'anilist'), 'Sign in')).toBeUndefined()

    const signedIn = render({ tracking: { ...tracking, answers: [stub, anilist({ state: 'NOT_LISTED', tracker: { ...anilist().tracker, canWrite: true } })] }, signIns: { anilist: signIn } })
    expect(button(row(signedIn.host, 'anilist'), 'Sign in')).toBeUndefined()
  })
})

describe("a tracker's own side of a write", () => {
  test('the editor says what a save to AniList does beyond the list, while AniList is ticked', async () => {
    const listed = anilist({ state: 'NOT_LISTED', tracker: { ...anilist().tracker, canWrite: true } })
    const { host } = render({ tracking: { ...tracking, answers: [stub, listed] } })

    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })
    expect(host.querySelector('.editor')!.textContent, 'not ticked').not.toContain(NOTICE)

    await tick(target(host, 'anilist'), true)
    expect(host.querySelector('.editor .notice')!.textContent).toBe(NOTICE)

    await tick(target(host, 'anilist'), false)
    expect(host.querySelector('.editor .notice')).toBeNull()
  })

  test('a paused tracker says until when, in its own words', () => {
    const paused = anilist({ state: 'PAUSED', error: 'AniList asked stub to wait until 12:34' })
    const { host } = render({ tracking: { ...tracking, answers: [stub, paused] } })
    expect(row(host, 'anilist').textContent).toContain('AniList asked stub to wait until 12:34')
  })

  test("a score shows in the scale the viewer keeps on that tracker", () => {
    const decimal = anilist({
      state: 'LISTED',
      tracker: { ...anilist().tracker, canWrite: true, scoreScale: 'POINT_10_DECIMAL' },
      entry: { _id: 'anilist:1', status: 'WATCHING', progress: 3, score: 85, scoreLabel: '8.5 / 10', episodeCount: 28 },
    })
    const { host } = render({ tracking: { ...tracking, answers: [stub, decimal] } })
    expect(row(host, 'anilist').textContent).toContain('8.5 / 10')
    expect(row(host, 'stub').textContent, 'the control: a 100 point scale').toContain('80%')
  })
})

// MyAnimeList's answers as its tracker draws them (sources/mal/list-api.ts), with the notice imported
// rather than copied so the panel is checked against the words the tracker sends
const { MAL_WRITE_NOTICE } = await import('../../../src/sources/mal/list-api')

const mal = (answer: Partial<PanelAnswer> = {}): PanelAnswer => ({
  _id: 'answer:mal',
  state: 'SIGNED_OUT',
  candidates: [],
  tracker: { id: 'mal', name: 'MyAnimeList', canWrite: false, account: null, scoreScale: 'POINT_10', writeNotice: MAL_WRITE_NOTICE },
  entry: null,
  ...answer,
})

describe('MyAnimeList beside AniList', () => {
  test("each signed-out tracker's Sign in starts its own sign in and no other", async () => {
    const anilistSignIn = pendingSignIn()
    const malSignIn = pendingSignIn()
    const { host } = render({ tracking: { ...tracking, answers: [stub, anilist(), mal()] }, signIns: { anilist: anilistSignIn.signIn, mal: malSignIn.signIn } })

    await act(async () => { button(row(host, 'mal'), 'Sign in')!.click() })
    expect(malSignIn.signIn).toHaveBeenCalledTimes(1)
    expect(anilistSignIn.signIn).not.toHaveBeenCalled()
    expect(button(row(host, 'anilist'), 'Sign in')!.disabled, "AniList's own button is untouched").toBe(false)
  })

  test("the editor says what a save to MyAnimeList does, while it is ticked, and a listed entry reads on ten points", async () => {
    const listed = mal({
      state: 'LISTED',
      tracker: { ...mal().tracker, canWrite: true, account: 'viewer' },
      entry: { _id: 'mal:viewer:48', status: 'COMPLETED', progress: 26, score: 70, scoreLabel: '7 / 10', episodeCount: 26 },
    })
    const { host } = render({ tracking: { ...tracking, answers: [stub, listed] } })
    expect(row(host, 'mal').textContent).toContain('7 / 10')
    expect(row(host, 'mal').textContent).toContain('viewer')

    await act(async () => { button(row(host, 'stub'), 'Edit')!.click() })
    expect(host.querySelector('.editor .notice'), 'not ticked').toBeNull()
    await tick(target(host, 'mal'), true)
    expect(host.querySelector('.editor .notice')!.textContent).toBe(MAL_WRITE_NOTICE)
  })
})
