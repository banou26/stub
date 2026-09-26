// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'preact/test-utils'

import type { PanelAnswer, PanelTracking } from '../../../src/components/tracking-panel'

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
  const host = mount(<TrackingPanel tracking={tracking} episodeCount={12} onSave={onSave} onDelete={onDelete} {...props}/>)
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
