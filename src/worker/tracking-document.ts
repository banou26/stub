// The documents the app sends each tracker, in their own module so a test can validate them against
// the schema and drive a tracker server with them: worker/extractor.ts reaches urql and cannot load
// under vitest.
//
// FIXED DOCUMENTS, not the page's own. The media fan-out re-sends whatever the page selected, which
// works there because a source's answer reaches the store through its own server. A tracker's answer
// reaches only the aggregate, and the aggregate reads fields the page may never select (`updatedAt`
// breaks a tie, `episodeCount` decides which answers are comparable), so every tracker is asked for
// the whole answer and the page's selection is applied to the aggregate afterwards.

const ENTRY = `
  _id
  tracker
  mediaUri
  status
  progress
  score
  scoreLabel
  startedAt { year month day }
  completedAt { year month day }
  rewatchCount
  updatedAt
  url
  title
  cover
  episodeCount
`

const TRACKER = `
  id
  name
  icon
  color
  signedIn
  account
  canWrite
  scoreScale
`

export const TRACKING_DOCUMENT = `
  subscription TrackerTracking($input: TrackingInput!) {
    tracking(input: $input) {
      _id
      answers {
        _id
        state
        candidates
        error
        pending
        tracker { ${TRACKER} }
        entry { ${ENTRY} }
      }
    }
  }
`

export const SAVE_LIST_ENTRY_DOCUMENT = `
  mutation TrackerSaveListEntry($input: SaveListEntryInput!) {
    saveListEntry(input: $input) {
      tracker
      outcome
      error
      entry { ${ENTRY} }
    }
  }
`

export const DELETE_LIST_ENTRY_DOCUMENT = `
  mutation TrackerDeleteListEntry($input: DeleteListEntryInput!) {
    deleteListEntry(input: $input) {
      tracker
      outcome
      error
      entry { ${ENTRY} }
    }
  }
`
