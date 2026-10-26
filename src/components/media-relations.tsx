import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { useIntl } from 'react-intl'
import { Link, useSearch } from 'wouter'

import Paged from './paged'
import Placeholder from './placeholder'
import { getRoutePath, Route } from '../router/path'
import { carriedSearch } from '../router/debug/trace'
import { asAggregatedUri } from '../utils/uri'
import { sortRelations, watchableRelations, type RelationEdge } from '../utils/relations'
import { relationLabel, workFormatLabel } from '../utils/relation-labels'
import { statusLabel } from '../router/search/params'
import { useCoverUrl } from '../utils/use-cover-url'

const ROW = 3

const style = css`
  & > h2 {
    display: flex;
    align-items: center;
    /* the graph button sits beside the word, not across the modal, so the two read as one control */
    gap: 1.5rem;
    margin: 0 0 1.5rem;
    font-size: 1.8rem;
  }

  & .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.2rem;

    @media (min-width: 768px) {
      grid-template-columns: repeat(${ROW}, minmax(0, 1fr));
    }
  }

  /* every card at least as tall as one with a two-line title, so the page held for them is as tall as theirs whatever
     their titles */
  & .relation-card, & > .grid > .pending {
    min-height: 9.7rem;
  }

  /* as tall as the heading's series graph button */
  & > h2 > .pending {
    width: 16rem;
    height: 2.8rem;
  }

  & > .grid > .pending {
    border-radius: 0.6rem;
  }

  /* the page buttons under a phone's page of three; a wider screen's page is a row, which most titles fill without a
     second page */
  & > .pages {
    width: 24rem;
    height: 4rem;
    margin-top: 1.2rem;
    border-radius: 0.6rem;

    @media (min-width: 768px) {
      display: none;
    }
  }
`

const cardStyle = css`
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

const RelationCard = ({ edge, search, route }: { edge: RelationEdge, search: string, route: Route.MEDIA | Route.TITLE }) => {
  const cover = useCoverUrl(edge.node.covers, edge.node)
  const title = edge.node.titles?.at(0)?.title
  // `format` rides on the EDGE rather than the node because `MediaType` is anime formats only and a
  // franchise's relations are mostly not anime. See the schema's own note on the field.
  const meta = [workFormatLabel(edge.format), statusLabel(edge.node.status)].filter(Boolean).join(' · ')

  return (
    <Link className="relation-card" css={cardStyle} to={`${getRoutePath(route, { uri: asAggregatedUri(edge.node.uri) })}${search}`}>
      {cover ? <img className="cover" src={cover} alt=""/> : <div className="cover"/>}
      <div className="body">
        <div className="relation">{relationLabel(edge.relation)}</div>
        <div className="title">{title ?? edge.node.uri}</div>
        {meta ? <div className="meta">{meta}</div> : undefined}
      </div>
    </Link>
  )
}

/**
 * A work's relations, on the title page and in the preview alike: the related works this app can play, ranked by what
 * the relation is, three a row (one on a phone) a page at a time. `action` sits beside the heading, a card opens on
 * `route`, and `pending` holds a full page's place while a source that names relations has yet to answer.
 */
const MediaRelations = (
  { relations, action, route = Route.MEDIA, pending = false }:
  { relations: readonly RelationEdge[], action?: ComponentChildren, route?: Route.MEDIA | Route.TITLE, pending?: boolean }
) => {
  // THE SESSION'S ENGINE FLAGS RIDE ALONG. Read above the early return, because a hook is, and once
  // per list rather than once per card. A click here is a client-side navigation, so the worker and
  // its engine survive it either way; what the query buys is an ADDRESS that reproduces this page
  // when it is reloaded or pasted (`carriedSearch`).
  const search = carriedSearch(useSearch())
  const heading = useIntl().formatMessage({ id: 'Relations', defaultMessage: 'Relations' })
  // Nothing at all rather than an empty heading: only some sources name relations, so most media have
  // none and a "Relations" heading over blank space reads as a page that failed to load. The action
  // goes with it: whatever it opens is built from the same source that named these.
  const shown = sortRelations(watchableRelations(relations))
  if (!shown.length) {
    return pending
      ? (
        <section className="relations placeholder" css={style} aria-hidden="true">
          <h2><Placeholder className="pending"/></h2>
          <div className="grid">{Array.from({ length: ROW }, (_, index) => <Placeholder key={index} className="pending"/>)}</div>
          <Placeholder className="pages"/>
        </section>
      )
      : null
  }

  return (
    <section className="relations" css={style} data-relations>
      <h2>
        <span>{heading}</span>
        {action}
      </h2>
      <Paged items={shown} size={ROW} label={heading}>
        {page => (
          <div className="grid">
            {page.map(edge => <RelationCard key={`${edge.relation}:${edge.node.uri}`} edge={edge} search={search} route={route}/>)}
          </div>
        )}
      </Paged>
    </section>
  )
}

export default MediaRelations
