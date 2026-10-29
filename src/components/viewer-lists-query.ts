import { gql } from '../generated'

/** Every tracker's whole list, joined one row per work: what the My list page and home's new episodes read. */
export const VIEWER_LISTS = gql(`
  subscription ViewerLists {
    viewerLists {
      _id
      lists {
        _id
        state
        tracker { id name }
      }
      rows {
        _id
        uri
        episodeCount
        mediaStatus
        type
        nextAiringEpisode { episodeNumber airingAt }
        disagreements
        summary { _id status progress score episodeCount updatedAt title cover }
        answers {
          _id
          state
          candidates
          episodeCount
          tracker { id name icon color canWrite statuses scoreScale canClearScore }
          entry { _id status progress score episodeCount updatedAt }
        }
      }
    }
  }
`)
