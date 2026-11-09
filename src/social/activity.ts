import type { Activity } from '../tracking/compact'
import type { Post, PublishingState } from './protocol'

import { getRoutePath, Route } from '../router/path'
import { entryMediaUri, identify, newEntryIdentity } from '../tracking/identity'
import { asAggregatedUri, isAggregatedUri } from '../utils/uri'

/** The kinds stub asks to post: a show started, an episode count raised, a show completed. */
export const POSTED_KINDS: Post['kind'][] = ['started', 'watched', 'completed']

// FKN Social's caps: code points after NFC for the text, characters for a link, printable ASCII for the subject
const MAX_TITLE = 150
const MAX_DETAIL = 40
const MAX_LINK = 300
const SUBJECT = /^[\x20-\x7e]{1,64}$/
const MAX_POSTS_AN_HOUR = 10
const HOUR = 3_600_000

/** The id stub's own tracker shows a media's entry as keyed on (AniList's first), which a cluster's growth keeps. */
const subjectOf = (uri: string) => {
  const identity = identify(uri)
  const id = identity.kind === 'catalogue' || identity.kind === 'keys' ? entryMediaUri(newEntryIdentity(identity)) : null
  return id && SUBJECT.test(id) ? id : undefined
}

const clip = (text: string, max: number) => [...text.normalize('NFC').trim()].slice(0, max).join('')

const httpsLink = (value: string) => {
  try {
    const { href, protocol } = new URL(value)
    return protocol === 'https:' && href.length <= MAX_LINK ? href : undefined
  } catch {
    return undefined
  }
}

/** A save of the row as the post it makes: the media's title, its page and its cover. */
export type Saved = { kind: Activity['kind'], detail?: string, title?: string | null, uri: string, cover?: string | null }

/**
 * The post a save makes from a page on `origin`, or none: with no title, no stable id for the media, or no https
 * link to its page there, since FKN Social refuses one.
 */
export const postOf = ({ kind, detail, title, uri, cover }: Saved, origin: string): Post | undefined => {
  const subject = subjectOf(uri)
  const page = subject && asAggregatedUri(subject)
  const link = page && isAggregatedUri(page) ? httpsLink(`${origin}${getRoutePath(Route.TITLE, { uri: page })}`) : undefined
  const named = title ? clip(title, MAX_TITLE) : ''
  if (!link || !named) return undefined
  const image = cover ? httpsLink(cover) : undefined
  const line = detail ? clip(detail, MAX_DETAIL) : ''
  return { kind, title: named, link, ...line ? { detail: line } : {}, ...image ? { image } : {}, subject }
}

/**
 * Posts a save while the viewer allowed it and its kind, at most 10 an hour from this page. Nothing is kept: a post
 * refused or over the cap is dropped. Never throws, so the tracking row never hears of it.
 */
export const createPoster = (
  calls: { publishing: () => Promise<PublishingState>, publish: (post: Post) => Promise<unknown> },
  origin: () => string,
  now = Date.now,
) => {
  const sent: number[] = []
  return async (saved: Saved): Promise<void> => {
    try {
      const post = postOf(saved, origin())
      if (!post) return
      const current = await calls.publishing()
      if (current.state !== 'allowed' || !current.kinds.includes(post.kind)) return
      const at = now()
      while (sent.length && sent[0]! <= at - HOUR) sent.shift()
      if (sent.length >= MAX_POSTS_AN_HOUR) return
      sent.push(at)
      await calls.publish(post)
    } catch {}
  }
}
