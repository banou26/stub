import { gql } from '../generated'

/** One media's tracking. Its own module, so media-details.tsx reads it without loading the tracking panel. */
export const MEDIA_TRACKING = gql(`
  subscription MediaTracking($input: TrackingInput!) {
    tracking(input: $input) {
      _id
      disagreements
      summary {
        _id
        status
        progress
        score
        episodeCount
      }
      answers {
        _id
        state
        candidates
        error
        episodeCount
        tracker {
          id
          name
          icon
          color
          canWrite
          account
          scoreScale
        }
        entry {
          _id
          status
          progress
          score
          episodeCount
        }
      }
    }
  }
`)
