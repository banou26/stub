// The two documents the `similarMedia` funnel subscribes with, in their own module so a test can parse
// and validate them: worker/extractor.ts reaches urql and cannot load under vitest.
//
// They share one selection because they select the same thing about the same kind of answer: what
// differs between a run and the season holding it is what the CALLER may claim about it, never what
// the row carries. The one field only the container's document asks for says why it is the exception.

/**
 * What an ask selects off an answer. The caller needs enough to build a handle, the scope the answer
 * is checked against, and the titles for the consumer's which-show check.
 *
 * THE ROW is inserted whatever is asked for: `useOnResolve` in the extractor fires on the RESOLVER'S
 * RETURN VALUE rather than on the selection set, so the whole Media lands even where a field is not
 * selected. THE EPISODES ARE NOT, and this document said otherwise until 2026-09-10.
 *
 * `useOnResolve` is per RESOLVED FIELD and keys on that field's named type (extractor.ts:473-486):
 * `Media` reaches `mediaInserter`, `Episode` reaches `episodeInserter`, and `mediaInserter` writes
 * rows and handle pairs only, dropping `media.episodes` on the floor (extractor.ts:106-133). So an
 * unselected `episodes` is a resolver that never runs, an Episode type that is never resolved, and an
 * `episodeInserter` that never fires. Netflix is how this surfaced: since unogs' own search died it
 * arrives ONLY as a `similarMedia` claim, its season media attached and its episodes never existed, so
 * the media header carried the Netflix icon while every episode row showed none. Measured on the same
 * cluster from two pages: the one whose own subscription owned the fan-out stored 10 nf episode rows,
 * the one that gained the same nf run through this document stored 0.
 *
 * The episode selection is therefore load bearing, and every array in it is selected WHOLE for the
 * same reason the titles are (below): a row is written back with what was asked for, so a partial
 * selection is a truncation of everyone else's copy.
 *
 * The titles are selected WHOLE. A caller that attaches the answer as a handle writes the node back to
 * the store as a row, where an array of equal length replaces the one it finds, so titles selected as
 * `{ title }` alone cost crunchyroll's rows their language and score (2026-09-05). Every field of
 * `MediaTitle` is here so that row is complete whoever writes it.
 */
const ANSWER_SELECTION = `
      uri
      origin
      id
      url
      scope
      titles { language title score }
      episodes {
        uri
        origin
        id
        url
        embedUrl
        mediaUri
        score
        titles { language title score }
        descriptions { language description score }
        shortDescriptions { language shortDescription score }
        thumbnails { url width height language color score }
        releaseDate
        seasonNumber
        episodeNumber
        absoluteEpisodeNumber
        runtime
        videoQualities
        audioQualities
        audioLanguages
        subtitleLanguages
      }`

export const SIMILAR_MEDIA_DOCUMENT = `
  subscription SimilarMedia($input: SimilarMediaInput!) {
    similarMedia(input: $input) {${ANSWER_SELECTION}
    }
  }
`

/**
 * What the funnel selects off a `containing` answer: the selection above, plus the container's own
 * episode count.
 *
 * THE COUNT IS THE DIFFERENCE, and it is here and not in the shared selection on purpose. A container
 * is claimed `PART_OF` and never `SAME_AS` (4.4), so its row never joins the run's cluster and its
 * count never reaches the run's length vote; the season a `similarMedia` answer names DOES join, so
 * adding a count to that selection would put a new number into a vote that decides what every page
 * prints. The placement needs it: a run being laid over a container has to know how many rows it is
 * choosing among, and reading it back off `episodes` would count what one region published rather
 * than what the season holds.
 */
export const CONTAINING_MEDIA_DOCUMENT = `
  subscription ContainingMedia($input: SimilarMediaInput!) {
    containingMedia(input: $input) {${ANSWER_SELECTION}
      episodeCount
    }
  }
`
