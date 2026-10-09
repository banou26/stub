import { render } from 'preact'
import { useState } from 'preact/hooks'

import type { CompactPrefs } from '../src/tracking/compact-prefs'
import type { CompactAnswer, CompactTracking, Fields } from '../src/tracking/compact'

import ModalBackdrop from '../src/components/modal-backdrop'
import TrackingCompact from '../src/components/tracking-compact'

// The page tests/tracking-card.spec.ts drives: the tracking row over a listed tracker, a signed out one
// and one that lists nothing, `?top=` pixels down the page, and with `?clip=` in a box that many pixels
// tall that clips what overflows it, as the modal does. With `?modal` it sits in the media modal's
// backdrop instead. Every write is kept on `window.writes`, and a close of the modal sets
// `window.dismissed`.
const query = new URLSearchParams(location.search)
const writes: [string[], Fields | 'remove'][] = []
Object.assign(window, { writes, dismissed: false })

const tracker = (id: string, name: string, scoreScale: string) => ({ id, name, canWrite: true, scoreScale })
const answers: CompactAnswer[] = [
  {
    state: 'LISTED',
    candidates: [],
    tracker: { ...tracker('anilist', 'AniList', 'POINT_10'), writeNotice: 'Saving to AniList can post list activity that your followers see, as saving on anilist.co does.' },
    entry: { status: 'WATCHING', progress: 3, score: 70, episodeCount: 24 },
  },
  { state: 'SIGNED_OUT', candidates: [], tracker: tracker('mal', 'MyAnimeList', 'POINT_10'), entry: null },
  { state: 'NOT_LISTED', candidates: [], tracker: tracker('stub', 'Stub', 'POINT_100'), entry: null },
]
const tracking: CompactTracking = { summary: answers[0]!.entry, disagreements: [], answers }

const Page = () => {
  const [prefs, setPrefs] = useState<CompactPrefs>({ targets: {} })
  return (
    <TrackingCompact
      tracking={tracking}
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

const clip = query.get('clip')
render(
  query.has('modal')
    ? <ModalBackdrop onClose={() => Object.assign(window, { dismissed: true })}><Page/></ModalBackdrop>
    : (
      <div style={{ position: 'absolute', top: Number(query.get('top') ?? 100), left: 16, right: 16, ...clip ? { height: Number(clip), overflow: 'hidden' } : {} }}>
        <Page/>
      </div>
    ),
  document.body,
)
