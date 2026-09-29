// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { render as draw } from 'preact'
import { act } from 'preact/test-utils'

import type { PanelAnswer, PanelTracking } from '../../../src/components/tracking-panel'
import type { SyncWrite } from '../../../src/tracking/sync'

// the same CommonJS icon build the panel's own test mocks, for the same reason
vi.mock('lucide-react', () => Object.fromEntries(['Frown', 'Meh', 'Minus', 'Plus', 'Smile'].map(name => [name, () => null])))

const { default: TrackingPanel } = await import('../../../src/components/tracking-panel')

// The panel over fake providers: stub's own tracker, AniList on a ten point decimal scale, a third that
// lists nothing, and two that could not answer. linkedom has no `checked` or `disabled` property on an
// input, so both are read the way preact writes them there, as attributes, until a test sets them.

const NOTICE = 'Saving to AniList can post list activity that your followers see.'

const stub: PanelAnswer = {
  _id: 'answer:stub',
  state: 'LISTED',
  candidates: [],
  pending: 0,
  tracker: { id: 'stub', name: 'Stub', canWrite: true, scoreScale: 'POINT_100' },
  entry: { _id: 'stub:e1', status: 'WATCHING', progress: 5, score: 80, startedAt: { year: 2026, month: 9, day: 1 }, episodeCount: 12 },
}
const anilist: PanelAnswer = {
  _id: 'answer:anilist',
  state: 'LISTED',
  candidates: [],
  pending: 0,
  tracker: { id: 'anilist', name: 'AniList', canWrite: true, scoreScale: 'POINT_10_DECIMAL', writeNotice: NOTICE },
  entry: {
    _id: 'anilist:1',
    status: 'COMPLETED',
    progress: 12,
    score: 90,
    scoreLabel: '9.0 / 10',
    startedAt: { year: 2026, month: 8, day: 30 },
    completedAt: { year: 2026, month: 9, day: 20 },
    rewatchCount: 1,
    episodeCount: 12,
  },
}
const other: PanelAnswer = {
  _id: 'answer:other',
  state: 'NOT_LISTED',
  candidates: [],
  pending: 0,
  tracker: { id: 'other', name: 'Other', canWrite: true, scoreScale: 'POINT_100' },
  entry: null,
}
const ambiguous: PanelAnswer = { ...other, _id: 'answer:kitsu', state: 'AMBIGUOUS', candidates: ['kitsu:1', 'kitsu:2'], tracker: { ...other.tracker, id: 'kitsu', name: 'Kitsu' } }
const signedOut: PanelAnswer = { ...other, _id: 'answer:mal', state: 'SIGNED_OUT', tracker: { id: 'mal', name: 'MyAnimeList', canWrite: false } }

// MyAnimeList as its tracker declares itself: ten points, three fields, a rewatch only through Completed
const malRewatching: PanelAnswer = {
  _id: 'answer:mal',
  state: 'LISTED',
  candidates: [],
  pending: 0,
  tracker: { id: 'mal', name: 'MyAnimeList', canWrite: true, scoreScale: 'POINT_10', keeps: ['STATUS', 'PROGRESS', 'SCORE'], rewatchThroughCompleted: true },
  entry: { _id: 'mal:viewer:1', status: 'REWATCHING', progress: 3, episodeCount: 12 },
}

const tracking = (answers: PanelAnswer[]): PanelTracking => ({ summary: null, disagreements: [], answers })

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const saved: SyncWrite = async tracker => [{ tracker, outcome: 'SAVED', error: null }]

const render = (answers: PanelAnswer[], write: SyncWrite = saved) => {
  const onSyncWrite = vi.fn(write)
  const host = mount(
    <TrackingPanel
      tracking={tracking(answers)}
      episodeCount={12}
      onSave={vi.fn(async () => [])}
      onDelete={vi.fn(async () => [])}
      onSyncWrite={onSyncWrite}
    />
  )
  hosts.push(host)
  return { host, onSyncWrite }
}

// typed as a plain Element, because the DOM types promise properties linkedom does not have
const flag = (input: HTMLInputElement, name: 'checked' | 'disabled') => {
  const element: Element = input
  return name in element ? Boolean((element as unknown as Record<string, unknown>)[name]) : element.hasAttribute(name)
}

const choose = async (input: HTMLInputElement, on = true) => {
  await act(async () => {
    Object.assign(input, { checked: on })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

const sourceInput = (host: HTMLElement, id: string) => host.querySelector<HTMLInputElement>(`[data-source="${id}"] input`)!
const targetInput = (host: HTMLElement, id: string) => host.querySelector<HTMLInputElement>(`input[name="sync-target-${id}"]`)!
const target = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-target="${id}"]`)!
const changes = (host: HTMLElement, id: string) => [...target(host, id).querySelectorAll('.changes li')].map(item => item.textContent)
const cells = (host: HTMLElement, field: string) =>
  [...host.querySelectorAll(`.differences tr[data-field="${field}"] td`)].map(cell => [cell.getAttribute('data-tracker'), cell.textContent])

const openSync = async (host: HTMLElement) => { await act(async () => { button(host, 'Sync')!.click() }) }
// a write settles over several promise hops past the click, so the act waits a whole task for them
const press = async (element: HTMLButtonElement) => {
  await act(async () => {
    element.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}
const apply = (host: HTMLElement) => press(button(host, 'Apply')!)

describe('where the trackers differ', () => {
  test('field by field, each tracker in its own terms, and only the trackers that answered', () => {
    const { host } = render([stub, anilist, other, ambiguous, signedOut])

    expect([...host.querySelectorAll('.differences thead th')].map(cell => cell.textContent)).toEqual(['', 'Stub', 'AniList', 'Other'])
    expect([...host.querySelectorAll('.differences tbody tr')].map(row => row.getAttribute('data-field')))
      .toEqual(['STATUS', 'PROGRESS', 'SCORE', 'STARTED_AT', 'COMPLETED_AT', 'REWATCH_COUNT'])
    expect(cells(host, 'SCORE')).toEqual([['stub', '80%'], ['anilist', '9.0 / 10'], ['other', 'None']])
    expect(cells(host, 'PROGRESS')).toEqual([['stub', '5 / 12'], ['anilist', '12 / 12'], ['other', 'None']])
  })

  test('a sync that settled the difference is gone, and the next one starts afresh', async () => {
    const onSyncWrite = vi.fn(saved)
    const panel = (answers: PanelAnswer[]) =>
      <TrackingPanel tracking={tracking(answers)} episodeCount={12} onSave={vi.fn(async () => [])} onDelete={vi.fn(async () => [])} onSyncWrite={onSyncWrite}/>
    const settled: PanelAnswer = { ...anilist, entry: { ...stub.entry!, _id: 'anilist:1' }, tracker: { ...anilist.tracker, scoreScale: 'POINT_100' } }
    const { host } = render([stub, anilist])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))

    await act(async () => { draw(panel([stub, settled]), host) })
    expect(host.querySelector('.sync')).toBeNull()

    await act(async () => { draw(panel([stub, anilist]), host) })
    expect(host.querySelector('.sheet'), 'closed, with no source left picked').toBeNull()
    expect(button(host, 'Sync')).toBeDefined()
  })

  test('nothing is shown, and no sync offered, while they agree', () => {
    const same: PanelAnswer = { ...anilist, entry: { ...stub.entry!, _id: 'anilist:1' }, tracker: { ...anilist.tracker, scoreScale: 'POINT_100' } }
    const { host } = render([stub, same])

    expect(host.querySelector('.sync')).toBeNull()
    expect(button(host, 'Sync')).toBeUndefined()
  })
})

describe('the sync the viewer runs', () => {
  test('copies from nothing until a source is picked, and never from one that cannot be copied from', async () => {
    const waiting: PanelAnswer = { ...anilist, pending: 1 }
    const { host } = render([stub, waiting, other, ambiguous, signedOut])
    await openSync(host)

    expect(host.querySelector('.sheet')!.textContent).toContain('Pick the tracker to copy from.')
    expect(flag(sourceInput(host, 'stub'), 'disabled')).toBe(false)
    expect(flag(sourceInput(host, 'stub'), 'checked'), 'no source is picked for the viewer').toBe(false)
    expect(flag(sourceInput(host, 'anilist'), 'disabled')).toBe(true)
    expect(host.querySelector('[data-source="anilist"]')!.textContent).toContain('AniList has 1 change still waiting to be sent')
    expect(flag(sourceInput(host, 'kitsu'), 'disabled')).toBe(true)
    expect(flag(sourceInput(host, 'mal'), 'disabled')).toBe(true)
    expect(host.querySelector('[data-source="mal"]')!.textContent).toContain('Sign in to MyAnimeList first')
    expect(flag(sourceInput(host, 'other'), 'disabled'), 'lists nothing, and deletes are not synced').toBe(true)
  })

  test('shows what will change on each target before anything is written, with nothing ticked', async () => {
    const { host, onSyncWrite } = render([stub, anilist, other, ambiguous, signedOut])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))

    expect(changes(host, 'stub')).toEqual([
      'Status: Watching → Completed',
      'Progress: 5 / 12 → 12 / 12',
      'Score: 80% → 90%',
      'Started: 2026-09-01 → 2026-08-30',
      'Completed: None → 2026-09-20',
      'Rewatches: None → 1',
    ])
    expect(changes(host, 'other')[0]).toBe('Status: None → Completed')
    expect(target(host, 'kitsu').textContent).toContain('Kitsu names two entries for this media')
    expect(flag(targetInput(host, 'kitsu'), 'disabled')).toBe(true)
    expect(flag(targetInput(host, 'mal'), 'disabled')).toBe(true)
    expect(host.querySelector('[data-target="anilist"]'), 'the source is not a target').toBeNull()
    expect(flag(targetInput(host, 'stub'), 'checked'), 'no target is ticked for the viewer').toBe(false)
    expect(button(host, 'Apply')!.disabled).toBe(true)
    expect(onSyncWrite).not.toHaveBeenCalled()
  })

  test('writes each ticked target alone, and no other', async () => {
    const { host, onSyncWrite } = render([stub, anilist, other])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))
    await choose(targetInput(host, 'stub'))
    await apply(host)

    expect(onSyncWrite).toHaveBeenCalledTimes(1)
    expect(onSyncWrite).toHaveBeenCalledWith('stub', {
      status: 'COMPLETED',
      progress: 12,
      score: 90,
      startedAt: { year: 2026, month: 8, day: 30 },
      completedAt: { year: 2026, month: 9, day: 20 },
      rewatchCount: 1,
    })
    expect(target(host, 'stub').querySelector('.outcome')!.textContent).toBe('Saved')
  })

  test('a target that fails says so with a retry, and the others still land', async () => {
    let down = true
    const { host, onSyncWrite } = render([stub, anilist, other], async tracker =>
      tracker === 'other' && down ? [{ tracker, outcome: 'FAILED', error: 'Too many requests' }] : [{ tracker, outcome: 'SAVED', error: null }])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))
    await choose(targetInput(host, 'stub'))
    await choose(targetInput(host, 'other'))
    await apply(host)

    expect(onSyncWrite.mock.calls.map(([tracker]) => tracker)).toEqual(['stub', 'other'])
    expect(target(host, 'stub').querySelector('.outcome')!.textContent).toBe('Saved')
    const failed = target(host, 'other').querySelector('.outcome.problem')!
    expect(failed.textContent).toContain('Too many requests')

    down = false
    await press(button(failed as HTMLElement, 'Retry')!)
    expect(onSyncWrite.mock.calls.map(([tracker]) => tracker), 'the retry is that target alone').toEqual(['stub', 'other', 'other'])
    expect(target(host, 'other').querySelector('.outcome')!.textContent).toBe('Saved')
  })

  test('a change that moves a target back is marked', async () => {
    const { host } = render([stub, anilist])
    await openSync(host)
    await choose(sourceInput(host, 'stub'))

    const back = [...target(host, 'anilist').querySelectorAll('.changes li.backwards')].map(item => item.textContent)
    expect(back).toEqual(['Status: Completed → Watching (goes back)', 'Progress: 12 / 12 → 5 / 12 (goes back)'])
    expect(changes(host, 'anilist')).toContain('Score: 9.0 / 10 → 8.0 / 10')
  })

  test('progress is held back where the two count the episodes differently, and says why', async () => {
    const longer: PanelAnswer = { ...anilist, entry: { ...anilist.entry!, episodeCount: 24 } }
    const { host, onSyncWrite } = render([stub, longer])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))

    expect(target(host, 'stub').querySelector('.held')!.textContent).toBe('AniList counts 24 episodes and Stub counts 12, so progress is not copied')
    await choose(targetInput(host, 'stub'))
    await apply(host)
    expect(onSyncWrite.mock.calls[0]![1]).not.toHaveProperty('progress')
  })

  test("progress onto stub's tracker is held against the page's count, which its write stores", async () => {
    const empty: PanelAnswer = { ...stub, state: 'NOT_LISTED', entry: null, tracker: { ...stub.tracker, keepsPageEpisodeCount: true } }
    const longer: PanelAnswer = { ...anilist, entry: { ...anilist.entry!, progress: 18, episodeCount: 24 } }
    const { host, onSyncWrite } = render([empty, longer])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))

    expect(target(host, 'stub').querySelector('.held')!.textContent).toBe('AniList counts 24 episodes and Stub counts 12, so progress is not copied')
    await choose(targetInput(host, 'stub'))
    await apply(host)
    expect(onSyncWrite.mock.calls[0]![1]).not.toHaveProperty('progress')
  })

  test('says a rewatch finished on MyAnimeList counts there, and refuses a rewatch it cannot start', async () => {
    const { host } = render([anilist, malRewatching])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))
    expect(changes(host, 'mal')).toEqual(['Status: Rewatching → Completed (counts one finished rewatch on MyAnimeList)', 'Progress: 3 / 12 → 12 / 12', 'Score: None → 9 / 10'])
    expect([...target(host, 'mal').querySelectorAll('.held')].map(held => held.textContent)).toContain('MyAnimeList does not take the start date from stub, so it is not copied')

    const watching: PanelAnswer = { ...malRewatching, entry: { ...malRewatching.entry!, status: 'WATCHING' } }
    const rewatched: PanelAnswer = { ...anilist, entry: { ...anilist.entry!, status: 'REWATCHING', progress: 4 } }
    const next = render([rewatched, watching])
    await openSync(next.host)
    await choose(sourceInput(next.host, 'anilist'))
    expect(target(next.host, 'mal').querySelector('.why')!.textContent).toBe('MyAnimeList starts a rewatch only on an entry it lists as Completed')
    expect(flag(targetInput(next.host, 'mal'), 'disabled')).toBe(true)
  })

  test("says what a score was rounded from, onto MyAnimeList's ten points", async () => {
    const decimal: PanelAnswer = { ...anilist, entry: { ...anilist.entry!, score: 87, scoreLabel: '8.7 / 10' } }
    const { host } = render([decimal, malRewatching])
    await openSync(host)
    await choose(sourceInput(host, 'anilist'))
    expect(changes(host, 'mal')).toContain("Score: None → 8 / 10 (rounded from AniList's 8.7 / 10)")
  })

  test("says what a write to AniList does beyond the list, once AniList is ticked", async () => {
    const { host } = render([stub, anilist])
    await openSync(host)
    await choose(sourceInput(host, 'stub'))

    expect(target(host, 'anilist').querySelector('.notice')).toBeNull()
    await choose(targetInput(host, 'anilist'))
    expect(target(host, 'anilist').querySelector('.notice')!.textContent).toBe(NOTICE)
  })
})
