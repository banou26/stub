import { render } from 'preact'
import { useState } from 'preact/hooks'
import { RawIntlProvider } from 'react-intl'

import type { CompactPrefs } from '../src/tracking/compact-prefs'
import type { CompactAnswer, CompactTracking, Fields, SaveQueue } from '../src/tracking/compact'

import ModalBackdrop from '../src/components/modal-backdrop'
import SaveProblems from '../src/components/save-problems'
import StubListNotice from '../src/components/stub-list-notice'
import TrackingCompact from '../src/components/tracking-compact'
import { startLanguage } from '../src/i18n'

// The page tests/tracking-card.spec.ts drives: the tracking row over a listed tracker, a signed out one
// and one that lists nothing, `?top=` pixels down the page, and with `?clip=` in a box that many pixels
// tall that clips what overflows it, as the modal does. With `?modal` it sits in the media modal's
// backdrop instead, with `?cr` Crunchyroll is one episode ahead of AniList and holds 4 stars, with
// `?long` AniList counts twice the row's episodes, and with `?waiting` none of the trackers has answered yet. The trackers start expanded into their chips,
// and with `?tiles` folded into tiles as the app starts them. Every write is kept on `window.writes`, and
// a close of the modal sets `window.dismissed`. `?words` draws every state the area has words for, one row under the
// other, in the language setting's language, which tests/tracking-card.spec.ts's build offers.
const query = new URLSearchParams(location.search)
const writes: [string[], Fields | 'remove'][] = []
Object.assign(window, { writes, dismissed: false })

const tracker = (id: string, name: string, scoreScale: string) => ({ id, name, canWrite: true, scoreScale })
const answers: CompactAnswer[] = [
  {
    state: 'LISTED',
    candidates: [],
    tracker: tracker('anilist', 'AniList', 'POINT_10'),
    entry: { status: 'WATCHING', progress: 3, score: 70, episodeCount: query.has('long') ? 48 : 24 },
  },
  { state: 'SIGNED_OUT', candidates: [], tracker: tracker('mal', 'MyAnimeList', 'POINT_10'), entry: null },
  { state: 'NOT_LISTED', candidates: [], tracker: tracker('stub', 'Stub', 'POINT_100'), entry: null },
  ...query.has('cr')
    ? [{ state: 'LISTED', candidates: [], tracker: { ...tracker('cr', 'Crunchyroll', 'POINT_5'), statuses: ['PLANNING'], canClearScore: false }, entry: { progress: 4, score: 80 } }]
    : [],
]
const summary = { ...answers[0]!.entry, episodeCount: 24 }
const tracking: CompactTracking = query.has('cr')
  ? { summary: { ...summary, progress: 4 }, disagreements: ['PROGRESS'], answers }
  : { summary, disagreements: [], answers }

const Page = () => {
  const [prefs, setPrefs] = useState<CompactPrefs>({ targets: {}, expanded: !query.has('tiles') })
  return (
    <TrackingCompact
      tracking={query.has('waiting') ? undefined : tracking}
      episodeCount={24}
      onSaveFields={async (targets, fields) => {
        writes.push([targets, fields])
        return targets.map(id => ({ tracker: id, outcome: 'SAVED' }))
      }}
      onRemove={async targets => {
        writes.push([targets, 'remove'])
        return targets.map(id => ({ tracker: id, outcome: 'SAVED' }))
      }}
      signIns={{ mal: () => new Promise(() => {}) }}
      prefs={prefs}
      onPrefs={setPrefs}
    />
  )
}

// a tracker of each state the row draws, apart on every field, and what the worker writes as they would come
const every: CompactAnswer[] = [
  { ...answers[0]!, tracker: { ...answers[0]!.tracker, account: 'banou' } },
  { state: 'LISTED', candidates: [], tracker: tracker('kitsu', 'Kitsu', 'POINT_10_DECIMAL'), entry: { status: 'PAUSED', progress: 2, score: 75, episodeCount: 24 } },
  answers[1]!,
  { ...answers[2]!, tracker: { ...answers[2]!.tracker, account: { message: 'This device' } } },
  { state: 'AMBIGUOUS', candidates: ['shiki:1', 'shiki:2'], tracker: tracker('shiki', 'Shikimori', 'POINT_10'), entry: null },
  { state: 'LOADING', candidates: [], tracker: tracker('simkl', 'Simkl', 'POINT_10'), entry: null },
  { state: 'PAUSED', candidates: [], error: { message: 'AniList asked stub to wait a minute' }, tracker: tracker('trakt', 'Trakt', 'POINT_10'), entry: null },
  { state: 'ERROR', candidates: [], error: { message: 'Could not reach {name}, retrying', values: { name: 'Annict' } }, tracker: tracker('annict', 'Annict', 'POINT_10'), entry: null },
]
const queue = { retry: () => {}, dismiss: () => {} } as unknown as SaveQueue
const Row = ({ tracking, expanded = true, movie = false, episodeCount = 24 }: { tracking: CompactTracking, expanded?: boolean, movie?: boolean, episodeCount?: number }) => {
  const [prefs, setPrefs] = useState<CompactPrefs>({ targets: {}, expanded })
  return (
    <TrackingCompact
      tracking={tracking}
      episodeCount={episodeCount}
      movie={movie}
      onSaveFields={async targets => targets.map(id => ({ tracker: id, outcome: 'SAVED' }))}
      onRemove={async targets => targets.map(id => ({ tracker: id, outcome: 'SAVED' }))}
      signIns={{ mal: () => new Promise(() => {}) }}
      prefs={prefs}
      onPrefs={setPrefs}
    />
  )
}
const Words = () => {
  const apart = { summary, disagreements: ['SCORE', 'STATUS', 'PROGRESS'], answers: every }
  const one = (summary: CompactTracking['summary'], entry: CompactAnswer['entry'] = summary) =>
    ({ summary, disagreements: [], answers: [{ ...answers[0]!, entry }] })
  const unreachable = { message: 'Could not reach {name}, retrying', values: { name: 'AniList' } }
  return (
    <div data-words>
      <Row tracking={apart}/>
      <Row tracking={apart} expanded={false}/>
      <Row tracking={one({ status: 'WATCHING', progress: 24, score: 70, episodeCount: 24 })}/>
      <Row tracking={one({ status: 'COMPLETED', progress: 12, score: 70, episodeCount: 24 })}/>
      <Row tracking={one({ status: 'PLANNING', progress: 0, score: null, episodeCount: 1 })} movie episodeCount={1}/>
      <Row tracking={one({ status: 'WATCHING', progress: 3, score: 70, episodeCount: 24 }, { status: 'WATCHING', progress: 3, score: 70, episodeCount: 48 })} expanded={false}/>
      <SaveProblems answer={answers[0]!} state={{ busy: false, failed: { fields: { status: 'WATCHING', progress: 5, score: 70 }, error: unreachable } }} queue={queue}/>
      <SaveProblems answer={answers[0]!} state={{ busy: false, refused: { message: 'Sign in to AniList to save to it' } }} queue={queue}/>
      <StubListNotice storage={{ location: 'ACCOUNT', signedIn: true, locked: true, waiting: false, held: 0 }} onUnlock={async () => {}} onAdd={async () => {}}/>
      <StubListNotice storage={{ location: 'ACCOUNT', signedIn: true, locked: false, waiting: true, held: 3, error: { message: 'FKN storage did not answer' } }} onUnlock={async () => {}} onAdd={async () => {}}/>
    </div>
  )
}

const clip = query.get('clip')
void startLanguage().then(intl => render(
  <RawIntlProvider value={intl}>
    {query.has('words')
      ? <div style={{ position: 'absolute', top: 16, left: 16, right: 16 }}><Words/></div>
      : query.has('modal')
        ? <ModalBackdrop onClose={() => Object.assign(window, { dismissed: true })}><Page/></ModalBackdrop>
        : (
          <div style={{ position: 'absolute', top: Number(query.get('top') ?? 100), left: 16, right: 16, ...clip ? { height: Number(clip), overflow: 'hidden' } : {} }}>
            <Page/>
          </div>
        )}
  </RawIntlProvider>,
  document.body,
))
