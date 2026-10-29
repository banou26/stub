// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount, withIntl } from './dom'

import type { ComponentChild } from 'preact'

import { act } from 'preact/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vite-plus/test'

import type { WindowSignIn } from '../../../src/sources/login-window'
import type { CompactAnswer, CompactTracking, QueueState, SaveQueue } from '../../../src/tracking/compact'

// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Smile', 'Star'].map(name => [name, () => null])))

const { default: TrackingCompact } = await import('../../../src/components/tracking-compact')
const { default: SaveProblems } = await import('../../../src/components/save-problems')
const { default: ScorePicker } = await import('../../../src/components/score-picker')
const { default: StubListNotice } = await import('../../../src/components/stub-list-notice')
const { startLanguage, wordsOf } = await import('../../../src/i18n')
const { failedReadAnswer } = await import('../../../src/tracking/collect')
const { mismatchOf } = await import('../../../src/sources/mal/list-api')

// HOR-1026 (stub in the viewer's language): every word the tracking row, its cards, its score menu, its notes and the
// lines about stub's own list show, and every name they give a screen reader, in English

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const shown = (node: ComponentChild) => {
  const host = mount(withIntl(node))
  hosts.push(host)
  return host
}

/** Each element's own text, its text nodes joined, and each name it gives, in document order. */
const words = (host: Element) => [...host.querySelectorAll('*')].flatMap(element => [
  [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim(),
  ...['aria-label', 'title'].map(name => element.getAttribute(name) ?? ''),
]).filter(Boolean)

const tracker = (id: string, name: string, scoreScale = 'POINT_100') => ({ id, name, canWrite: true, scoreScale })
const anilist: CompactAnswer = { state: 'LISTED', candidates: [], tracker: { ...tracker('anilist', 'AniList', 'POINT_10'), account: 'banou' }, entry: { status: 'PAUSED', progress: 13, score: 60, episodeCount: 14 } }
const kitsu: CompactAnswer = { state: 'LISTED', candidates: [], tracker: tracker('kitsu', 'Kitsu', 'POINT_10_DECIMAL'), entry: { status: 'WATCHING', progress: 12, score: 75, episodeCount: 14 } }
const mal: CompactAnswer = { state: 'SIGNED_OUT', candidates: [], tracker: tracker('mal', 'MyAnimeList', 'POINT_10'), entry: null }
const stub: CompactAnswer = { state: 'NOT_LISTED', candidates: [], tracker: { ...tracker('stub', 'Stub'), account: 'This device' }, entry: null }
const shiki: CompactAnswer = { state: 'AMBIGUOUS', candidates: ['shiki:1', 'shiki:2'], tracker: tracker('shiki', 'Shikimori'), entry: null }
const simkl: CompactAnswer = { state: 'LOADING', candidates: [], tracker: tracker('simkl', 'Simkl'), entry: null }
const trakt: CompactAnswer = { state: 'PAUSED', candidates: [], tracker: tracker('trakt', 'Trakt'), entry: null }
const annict: CompactAnswer = { state: 'ERROR', candidates: [], tracker: tracker('annict', 'Annict'), entry: null }
const tracking: CompactTracking = {
  summary: { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14 },
  disagreements: ['SCORE', 'STATUS', 'PROGRESS'],
  answers: [anilist, kitsu, mal, stub, shiki, simkl, trakt, annict],
}

const row = (props: Partial<Parameters<typeof TrackingCompact>[0]> = {}) => shown(
  <TrackingCompact
    tracking={tracking}
    episodeCount={14}
    onSaveFields={async targets => targets.map(id => ({ tracker: id, outcome: 'SAVED' }))}
    onRemove={async targets => targets.map(id => ({ tracker: id, outcome: 'SAVED' }))}
    prefs={{ targets: {}, expanded: true }}
    onPrefs={() => {}}
    {...props}
  />,
)

const fire = async (target: EventTarget, type: string, extra: Record<string, unknown> = {}) => {
  await act(async () => { target.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), extra)) })
}
const cardOf = async (host: HTMLElement, id: string) => {
  const chip = host.querySelector(`[data-chip="${id}"]`)!
  await fire(chip, 'pointerenter', { pointerType: 'mouse' })
  await fire(chip, 'mouseenter')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 150)) })
  return host.querySelector<HTMLElement>(`[data-card="${id}"]`)!
}

describe('the tracking row', () => {
  test('its chips, its controls and the values the trackers hold apart', () => {
    expect(words(row())).toEqual([
      'Quick tracking', 'Trackers', 'Collapse trackers', 'AniList entry', 'A', 'Save to AniList', 'Kitsu entry', 'K',
      'Save to Kitsu', 'MyAnimeList entry', 'M', 'Log in', 'Log in to MyAnimeList', 'Stub entry', 'S', 'Save to Stub',
      'Shikimori entry', 'S', 'Shikimori cannot track this media: Names shiki:1 and shiki:2, cannot tell which',
      'Simkl entry', 'S', 'Simkl loading', 'Trakt entry', 'T', 'Save to Trakt', 'Paused for a while', 'Annict entry',
      'A', 'Save to Annict', 'Could not answer', 'Score, 8 out of 10', '8', 'AniList 6 / 10, Kitsu 7.5 / 10',
      'Status', 'Watching', 'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Remove from list',
      'AniList Paused, Kitsu Watching', 'Episodes', '/ 14', 'AniList 13, Kitsu 12', 'One episode more',
    ])
  })

  test('its tiles, folded', () => {
    expect(words(row({ prefs: { targets: { stub: false }, expanded: false } }))).toEqual([
      'Quick tracking', 'AniList: connected', 'AniList: connected', 'A', 'Kitsu: connected', 'Kitsu: connected', 'K',
      'MyAnimeList: signed out', 'MyAnimeList: signed out', 'M', 'Stub: off', 'Stub: off', 'S',
      'Shikimori: cannot track this media', 'Shikimori: cannot track this media', 'S', 'Simkl: loading',
      'Simkl: loading', 'S', 'Trakt: paused', 'Trakt: paused', 'T', 'Annict: error', 'Annict: error', 'A',
      'Score, 8 out of 10', '8', 'AniList 6 / 10, Kitsu 7.5 / 10', 'Status', 'Watching', 'Rewatching',
      'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Remove from list', 'AniList Paused, Kitsu Watching',
      'Episodes', '/ 14', 'AniList 13, Kitsu 12', 'One episode more',
    ])
  })

  test('before the trackers answer, folded and expanded', () => {
    expect([...words(row({ tracking: undefined, prefs: { targets: {}, expanded: false } })), ...words(row({ tracking: undefined }))]).toEqual([
      'Quick tracking', 'Trackers loading', 'Trackers loading', 'Score, none', 'Status', 'Add to list', 'Watching',
      'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Episodes', '/ 14', 'One episode more',
      'Quick tracking', 'Trackers', 'Collapse trackers', 'Trackers loading', 'Score, none', 'Status', 'Add to list',
      'Watching', 'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Episodes', '/ 14',
      'One episode more',
    ])
  })

  test('a card of each kind', async () => {
    const host = row()
    const cards: string[][] = []
    for (const id of ['anilist', 'kitsu', 'mal', 'stub', 'shiki', 'simkl', 'trakt', 'annict']) cards.push(words(await cardOf(host, id)))
    expect(cards).toEqual([
      [
        'AniList', 'A', 'banou', 'Score, 6 out of 10', '6', 'Status', 'Watching', 'Rewatching', 'Plan to watch',
        'Completed', 'Paused', 'Dropped', 'Remove from list', 'Episodes', '/ 14', 'One episode more',
      ],
      [
        'Kitsu', 'K', 'Score, 75 out of 100', '75', 'Status', 'Watching', 'Rewatching', 'Plan to watch', 'Completed',
        'Paused', 'Dropped', 'Remove from list', 'Episodes', '/ 14', 'One episode more',
      ],
      ['MyAnimeList', 'M', 'Signed out', 'Log in', 'Log in to MyAnimeList'],
      [
        'Stub', 'S', 'This device', 'Score, none', 'Status', 'Add to list', 'Watching', 'Rewatching', 'Plan to watch',
        'Completed', 'Paused', 'Dropped', 'Episodes', '/ 14', 'One episode more',
      ],
      [
        'Shikimori', 'S', 'Shikimori cannot track this media: Names shiki:1 and shiki:2, cannot tell which',
      ],
      ['Simkl', 'S'],
      [
        'Trakt', 'T', 'Score, none', 'Status', 'Add to list', 'Watching', 'Rewatching', 'Plan to watch', 'Completed',
        'Paused', 'Dropped', 'Episodes', '/ 14', 'One episode more', 'Paused for a while',
      ],
      [
        'Annict', 'A', 'Score, none', 'Status', 'Add to list', 'Watching', 'Rewatching', 'Plan to watch', 'Completed',
        'Paused', 'Dropped', 'Episodes', '/ 14', 'One episode more', 'Could not answer',
      ],
    ])
  })

  test('Mark completed at the total, Set 14 / 14 under it once completed, and a film\'s Watched', () => {
    const at = (summary: CompactTracking['summary']) => ({ ...tracking, summary, disagreements: [], answers: [anilist] })
    expect([
      ...words(row({ tracking: at({ status: 'WATCHING', progress: 14, episodeCount: 14 }) })),
      ...words(row({ tracking: at({ status: 'COMPLETED', progress: 13, episodeCount: 14 }) })),
      ...words(row({ tracking: at({ status: 'COMPLETED', progress: 1, episodeCount: 1 }), movie: true, episodeCount: 1 })),
    ]).toEqual([
      'Quick tracking', 'Trackers', 'Collapse trackers', 'AniList entry', 'A', 'Save to AniList', 'Score, none',
      'Status', 'Watching', 'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Remove from list',
      'Episodes', '/ 14', 'One episode more', 'Mark completed', 'Quick tracking', 'Trackers', 'Collapse trackers',
      'AniList entry', 'A', 'Save to AniList', 'Score, none', 'Status', 'Watching', 'Rewatching', 'Plan to watch',
      'Completed', 'Paused', 'Dropped', 'Remove from list', 'Episodes', '/ 14', 'One episode more', 'Set 14 / 14',
      'Quick tracking', 'Trackers', 'Collapse trackers', 'AniList entry', 'A', 'Save to AniList', 'Score, none',
      'Status', 'Watching', 'Rewatching', 'Plan to watch', 'Completed', 'Paused', 'Dropped', 'Remove from list',
      'Watched', 'AniList: set progress on its card',
    ])
  })

  test('the note of a tracker counting other episodes, folded', () => {
    const long: CompactAnswer = { ...anilist, entry: { ...anilist.entry!, episodeCount: 28 } }
    expect(words(row({ tracking: { ...tracking, disagreements: [], answers: [long] }, prefs: { targets: {}, expanded: false } }).querySelector('.notes')!)).toEqual(['AniList: set progress on its card', 'Open'])
  })

  test('a sign in while it runs, and what it says when the window was blocked or the site wants this browser', async () => {
    const outcomes: WindowSignIn[] = ['blocked', 'unsupported']
    const said: string[] = []
    for (const outcome of outcomes) {
      let finish: (outcome: WindowSignIn) => void = () => {}
      const host = row({ tracking: { ...tracking, disagreements: [], answers: [mal] }, signIns: { mal: () => new Promise(resolve => { finish = resolve }) } })
      await act(async () => { button(host, 'Log in')!.click() })
      said.push(...words(host.querySelector('[data-chip="mal"]')!))
      await act(async () => {
        finish(outcome)
        await new Promise(resolve => setTimeout(resolve, 0))
      })
      said.push(...words(host.querySelector('.notes')!))
    }
    expect(said).toEqual([
      'MyAnimeList entry', 'M', 'Logging in', 'Log in to MyAnimeList',
      'The browser blocked the sign-in window: allow pop-ups, then press Log in again.', 'MyAnimeList entry', 'M',
      'Logging in', 'Log in to MyAnimeList', 'Sign in to MyAnimeList in this browser, then press Log in again.',
    ])
  })

  test('what a screen reader hears once a save settles', async () => {
    const heard: string[] = []
    const outcomes = [
      { outcome: 'SAVED' }, { outcome: 'FAILED' }, { outcome: 'REFUSED' }, { outcome: 'FAILED', error: 'AniList answered 502' },
    ]
    for (const settled of outcomes) {
      const host = row({ tracking: { ...tracking, disagreements: [], answers: [anilist] }, onSaveFields: async targets => targets.map(id => ({ tracker: id, ...settled })) })
      const select = host.querySelector<HTMLSelectElement>('select')!
      Object.defineProperty(select, 'value', { value: 'DROPPED', configurable: true })
      await fire(select, 'change')
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      heard.push(host.querySelector('[role="status"]')!.textContent!)
    }
    const host = row({ tracking: { ...tracking, disagreements: [], answers: [anilist] } })
    const select = host.querySelector<HTMLSelectElement>('select')!
    Object.defineProperty(select, 'value', { value: 'REMOVE', configurable: true })
    await fire(select, 'change')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    heard.push(host.querySelector('[role="status"]')!.textContent!)
    expect(heard).toEqual([
      'Saved to AniList', 'AniList did not save: failed', 'AniList did not save: refused',
      'AniList did not save: AniList answered 502', 'Removed from AniList',
    ])
  })
})

describe('the score menu', () => {
  test('on each scale, mixed, with the score it holds', async () => {
    const menus: string[][] = []
    for (const [scale, score] of [['POINT_3', 50], ['POINT_5', 80], ['POINT_10', 70], ['POINT_10_DECIMAL', 75], ['POINT_100', 64]] as const) {
      const host = shown(<ScorePicker score={score} scale={scale} mixed disabled={false} onPick={() => {}}/>)
      await act(async () => { host.querySelector<HTMLButtonElement>('.star')!.click() })
      menus.push(words(host))
    }
    expect(menus).toEqual([
      [
        'Score, 2 out of 3 (neutral)', 'Score', '1 out of 3 (bad)', '2 out of 3 (neutral)', '3 out of 3 (good)',
        'Out of 3', 'No score',
      ],
      [
        'Score, 4 out of 5', '4', 'Score', '1', '1 out of 5', '2', '2 out of 5', '3', '3 out of 5', '4', '4 out of 5',
        '5', '5 out of 5', 'Out of 5', 'No score',
      ],
      [
        'Score, 7 out of 10', '7', 'Score', '1', '1 out of 10', '2', '2 out of 10', '3', '3 out of 10', '4',
        '4 out of 10', '5', '5 out of 10', '6', '6 out of 10', '7', '7 out of 10', '8', '8 out of 10', '9',
        '9 out of 10', '10', '10 out of 10', 'Out of 10', 'No score',
      ],
      [
        'Score, 7.5 out of 10', '7.5', 'Score', '1', '1 out of 10', '2', '2 out of 10', '3', '3 out of 10', '4',
        '4 out of 10', '5', '5 out of 10', '6', '6 out of 10', '7', '7 out of 10', '8', '8 out of 10', '9',
        '9 out of 10', '10', '10 out of 10', 'Exact', 'Out of 10', 'No score',
      ],
      [
        'Score, 64 out of 100', '64', 'Score', '1', '10 out of 100', '2', '20 out of 100', '3', '30 out of 100', '4',
        '40 out of 100', '5', '50 out of 100', '6', '60 out of 100', '7', '70 out of 100', '8', '80 out of 100', '9',
        '90 out of 100', '10', '100 out of 100', 'Exact', 'Out of 100', 'No score',
      ],
    ])
  })

  test('with no score', () => {
    expect(words(shown(<ScorePicker score={null} scale="POINT_10" mixed={false} disabled onPick={() => {}}/>))).toEqual(['Score, none'])
  })
})

describe('a save that did not land', () => {
  const queue = { retry: () => {}, dismiss: () => {} } as unknown as SaveQueue
  const problems = (state: Partial<QueueState>) => words(shown(<SaveProblems answer={anilist} state={{ busy: false, ...state }} queue={queue}/>))

  test('names what did not save, and why', () => {
    const error = 'AniList answered 502'
    expect([
      { remove: true as const },
      { status: 'WATCHING' },
      { progress: 5 },
      { score: 70 },
      { status: 'WATCHING', progress: 5 },
      { status: 'WATCHING', score: 70 },
      { progress: 5, score: null },
      { status: 'WATCHING', progress: 5, score: 70 },
    ].flatMap(fields => problems({ failed: { fields, error } }))).toEqual([
      'AniList did not save the removal: AniList answered 502', 'Retry',
      'AniList did not save the status: AniList answered 502', 'Retry',
      'AniList did not save episode 5: AniList answered 502', 'Retry',
      'AniList did not save the score: AniList answered 502', 'Retry',
      'AniList did not save the status and episode 5: AniList answered 502', 'Retry',
      'AniList did not save the status and the score: AniList answered 502', 'Retry',
      'AniList did not save episode 5 and the score: AniList answered 502', 'Retry',
      'AniList did not save the status and episode 5 and the score: AniList answered 502', 'Retry',
    ])
  })

  test('a refusal says why, with Dismiss', () => {
    expect(problems({ refused: 'Crunchyroll cannot unmark an episode' })).toEqual(['AniList did not save: Crunchyroll cannot unmark an episode', 'Dismiss'])
  })
})

describe('stub\'s own list', () => {
  test('locked, kept before signing in, waiting, and failing', () => {
    const storage = { location: 'ACCOUNT' as const, signedIn: true, locked: false, waiting: false, held: 0 }
    expect([
      { ...storage, locked: true },
      { ...storage, held: 1 },
      { ...storage, held: 3, waiting: true },
      { ...storage, error: 'FKN storage did not answer' },
    ].flatMap(each => words(shown(<StubListNotice storage={each} onUnlock={async () => {}} onAdd={async () => {}}/>)))).toEqual([
      "Stub: your FKN account's list is locked on this device", 'Unlock',
      'Stub: 1 entry saved on this device before you signed in', 'Add to my FKN account',
      'Stub: 3 entries saved on this device before you signed in', 'Add to my FKN account',
      'Stub: some changes have not reached your FKN account yet.', 'Stub: FKN storage did not answer',
    ])
  })
})

describe('in German', () => {
  beforeAll(() => startLanguage({ language: 'de', languages: ['de-DE'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('the row, a card, the score menu and a save that did not land read German', async () => {
    // stub's tracker names its list as the worker hands it, a message
    const own = { ...stub, tracker: { ...stub.tracker, account: { message: 'This device' } } }
    const host = row({ tracking: { ...tracking, answers: tracking.answers.map(answer => answer === stub ? own : answer) } })
    expect(words(host)).toEqual(expect.arrayContaining([
      'Schnelles Tracking', 'Tracker einklappen', 'Eintrag bei AniList', 'In AniList speichern', 'Bei MyAnimeList anmelden',
      'Shikimori kann diesen Titel nicht tracken: Nennt shiki:1 und shiki:2, nicht eindeutig', 'Simkl wird geladen',
      'Eine Weile pausiert', 'Keine Antwort', 'Bewertung, 8 von 10', 'AniList 6 / 10 und Kitsu 7,5 / 10', 'Am Schauen', 'Geplant',
      'Von der Liste entfernen', 'AniList Pausiert und Kitsu Am Schauen', 'Folgen', 'Eine Folge mehr',
    ]))
    expect(words(await cardOf(host, 'stub'))).toEqual(expect.arrayContaining(['Dieses Gerät', 'Zur Liste hinzufügen']))
    const queue = { retry: () => {}, dismiss: () => {} } as unknown as SaveQueue
    const unreachable = failedReadAnswer('ag:(anilist:1)', anilist.tracker as never, new TypeError('Failed to fetch')).error
    const failed = { busy: false, failed: { fields: { status: 'WATCHING', progress: 5 }, error: unreachable } }
    expect(words(shown(<SaveProblems answer={anilist} state={failed} queue={queue}/>)))
      .toEqual(['AniList hat den Status und Folge 5 nicht gespeichert: AniList nicht erreichbar, neuer Versuch läuft', 'Erneut versuchen'])
  })

  test('what MyAnimeList shows apart from a save, and a site\'s own words, as they came', () => {
    const before = { animeId: 1, status: 2, rewatching: false, score: 8, progress: 3, episodes: 12, title: null, url: '', cover: null, updatedAt: null }
    expect(wordsOf(mismatchOf({ status: 'WATCHING', progress: 3, score: 8 }, { ...before, status: 3, progress: 2, score: 7 }, before)!))
      .toBe('MyAnimeList zeigt den Status Pausiert, 2 Folgen und eine Bewertung von 7 / 10')
    expect(wordsOf('invalid request')).toBe('invalid request')
  })
})

describe('in Russian', () => {
  beforeAll(() => startLanguage({ language: 'ru', languages: ['ru-RU'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('the entries kept before signing in take each of the plural forms', () => {
    const storage = { location: 'ACCOUNT' as const, signedIn: true, locked: false, waiting: false }
    expect([1, 3, 5, 21].map(held => words(shown(<StubListNotice storage={{ ...storage, held }} onUnlock={async () => {}} onAdd={async () => {}}/>))[0])).toEqual([
      'Stub: на этом устройстве до входа сохранена 1 запись',
      'Stub: на этом устройстве до входа сохранены 3 записи',
      'Stub: на этом устройстве до входа сохранено 5 записей',
      'Stub: на этом устройстве до входа сохранена 21 запись',
    ])
  })
})

describe('what MyAnimeList shows apart from a save', () => {
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))
  const before = { animeId: 1, status: 1, rewatching: false, score: 8, progress: 3, episodes: 24, title: null, url: '', cover: null, updatedAt: null }
  const shows = (after: Partial<typeof before>) => wordsOf(mismatchOf({ status: 'WATCHING', progress: 3, score: 8 }, { ...before, ...after }, before)!)

  // each item is a message of its own: after the verb alone Russian would decline the count, and French and Italian
  // would negate the verb before `no score`
  test.each([
    ['ru', ['MyAnimeList показывает: 1 серия, оценка 7 / 10', 'MyAnimeList показывает: 21 серия, оценка 7 / 10', 'MyAnimeList показывает: без оценки']],
    ['fr', ['MyAnimeList affiche\u00a0: 1 épisode, une note de 7 / 10', 'MyAnimeList affiche\u00a0: 21 épisodes, une note de 7 / 10', 'MyAnimeList affiche\u00a0: aucune note']],
    ['it', ['MyAnimeList mostra: 1 episodio e un voto di 7 / 10', 'MyAnimeList mostra: 21 episodi e un voto di 7 / 10', 'MyAnimeList mostra: nessun voto']],
    ['es-419', ['MyAnimeList muestra: 1 episodio y una puntuación de 7 / 10', 'MyAnimeList muestra: 21 episodios y una puntuación de 7 / 10', 'MyAnimeList muestra: sin puntuación']],
    ['pt-BR', ['O MyAnimeList mostra: 1 episódio, uma nota de 7 / 10', 'O MyAnimeList mostra: 21 episódios, uma nota de 7 / 10', 'O MyAnimeList mostra: sem nota']],
    ['pl', ['MyAnimeList pokazuje 1 odcinek i ocenę 7 / 10', 'MyAnimeList pokazuje 21 odcinków i ocenę 7 / 10', 'MyAnimeList pokazuje brak oceny']],
  ])('in %s, each item as the words before it let it read', async (language, expected) => {
    await startLanguage({ language, languages: [language] })
    expect([shows({ progress: 1, score: 7 }), shows({ progress: 21, score: 7 }), shows({ score: 0 })]).toEqual(expected)
  })
})
