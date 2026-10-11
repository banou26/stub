import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { Link, useSearch } from 'wouter'

import { getRoutePath, Route } from '../router/path'
import { carriedSearch } from '../router/debug/trace'
import { asAggregatedUri } from '../utils/uri'
import { relationLanes, watchableRelations, type RelationEdge } from '../utils/relation-lanes'
import { relationLabel, workFormatLabel } from '../utils/relation-labels'
import { statusLabel } from '../router/search/params'
import { useCoverUrl } from '../utils/use-cover-url'

/**
 * The works a media is related to as a story, as a row of cards.
 *
 * A GRID rather than the home page's carousel. A relation set is small (a handful of entries, not a
 * season's worth), so there is nothing to virtualize, and the carousel drags in `Draggable`, which
 * binds mousedown, mousemove and mouseup on `globalThis` and calls `preventDefault`. Inside a modal
 * that already locks the body and hosts a watch party's scroll box, that is a real cost for a row
 * that fits on screen anyway.
 */

const style = css`
  margin-top: 4rem;

  & > .heading {
    display: flex;
    align-items: center;
    /* the graph button sits beside the word, not across the modal, so the two read as one control */
    gap: 1.5rem;
    font-size: 1.8rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    margin-bottom: 1.5rem;
  }

  & > .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
    align-items: stretch;
  }

  /* The two outer lanes take an EQUAL share of the free space, which is what centres the middle one
     on the modal rather than on whatever is left over beside a sequel. An empty lane still takes its
     share, so a row with no prequel keeps its side story centred instead of sliding left. */
  & > .grid > .lane {
    display: flex;
    flex-wrap: wrap;
    gap: 1.2rem;
  }

  & > .grid > .before { flex: 1 1 0; justify-content: flex-start; }
  & > .grid > .middle { flex: 0 1 auto; justify-content: center; }
  & > .grid > .after { flex: 1 1 0; justify-content: flex-end; }

  /* Below this the lanes cannot sit side by side, so they wrap onto their own lines and the timeline
     stops being readable as one: a lone sequel pushed to the right edge of its own line is just a
     card in a strange place. Measured at a 500px viewport, where the row is 458px and three 28rem
     cards cannot share it. Stack them and let them read top to bottom instead. */
  @media (max-width: 768px) {
    & > .grid > .lane { flex: 1 1 100%; justify-content: flex-start; }
  }
`

const cardStyle = css`
  /* A card sized itself off the grid track until the lanes replaced it, so it needs its own basis
     now. 28rem is the track's old minimum, and shrinking is left on so a narrow modal wraps rather
     than overflows. */
  flex: 0 1 28rem;
  display: flex;
  align-items: stretch;
  gap: 1.2rem;
  padding: 0;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  & > .cover {
    flex-shrink: 0;
    width: 6rem;
    /* the aspect every cover in this app is, so a missing image leaves a hole the right shape */
    aspect-ratio: 2 / 3;
    object-fit: cover;
    background-color: rgb(35, 35, 35);
    pointer-events: none;
  }

  & > .body {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.4rem;
    padding: 1rem 1.2rem 1rem 0;
    min-width: 0;
  }

  & .relation {
    font-size: 1.3rem;
    font-weight: 700;
    /* the one accented thing on the card: it is what the reader is scanning for */
    color: rgb(61, 180, 242);
  }

  & .title {
    font-size: 1.5rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.95);
    /* two lines then ellipsis: a light novel title runs long and a ragged card height is worse */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  & .meta {
    font-size: 1.25rem;
    color: rgba(255, 255, 255, 0.55);
  }
`

/** One related work as a card that opens it; `search` is the session's flags, from `carriedSearch`. */
export const RelationCard = ({ edge, search }: { edge: RelationEdge, search: string }) => {
  const cover = useCoverUrl(edge.node.covers)
  const title = edge.node.titles?.at(0)?.title
  // `format` rides on the EDGE rather than the node because `MediaType` is anime formats only and a
  // franchise's relations are mostly not anime. See the schema's own note on the field.
  const meta = [workFormatLabel(edge.format), statusLabel(edge.node.status)].filter(Boolean).join(' · ')

  return (
    <Link className="relation-card" css={cardStyle} to={`${getRoutePath(Route.MEDIA, { uri: asAggregatedUri(edge.node.uri) })}${search}`}>
      {cover ? <img className="cover" src={cover} alt=""/> : <div className="cover"/>}
      <div className="body">
        <div className="relation">{relationLabel(edge.relation)}</div>
        <div className="title">{title ?? edge.node.uri}</div>
        {meta ? <div className="meta">{meta}</div> : undefined}
      </div>
    </Link>
  )
}

const MediaRelations = (
  { relations, action }:
  { relations: readonly RelationEdge[], action?: ComponentChildren }
) => {
  // THE SESSION'S ENGINE FLAGS RIDE ALONG. Read above the early return, because a hook is, and once
  // per row rather than once per card. A click here is a client-side navigation, so the worker and
  // its engine survive it either way; what the query buys is an ADDRESS that reproduces this page
  // when it is reloaded or pasted (`carriedSearch`).
  const search = carriedSearch(useSearch())
  // Nothing at all rather than an empty heading: only some sources name relations, so most media have
  // none and a "Relations" heading over blank space reads as a page that failed to load. The action
  // goes with it: whatever it opens is built from the same source that named these.
  const watchable = watchableRelations(relations)
  if (!watchable.length) return null
  const lanes = relationLanes(watchable)

  return (
    <div css={style} data-relations>
      <div className="heading">
        <span>Relations</span>
        {action}
      </div>
      <div className="grid">
        {/* rendered even when empty: an empty lane is what holds the middle in the centre */}
        {(['before', 'middle', 'after'] as const).map(lane => (
          <div className={`lane ${lane}`} key={lane}>
            {lanes[lane].map(edge => <RelationCard key={`${edge.relation}:${edge.node.uri}`} edge={edge} search={search}/>)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MediaRelations
