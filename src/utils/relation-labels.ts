// How a narrative relation and a work's kind are written for a reader.
//
// Pure and separate from the component so the vocabulary can be tested against the schema's enum: a
// value added to `MediaRelation` and forgotten here would otherwise render as raw SCREAMING_SNAKE in
// the middle of the page, which is the sort of thing that ships.

import type { MessageDescriptor } from 'react-intl'

import { defineMessages } from 'react-intl'

import { intl } from '../i18n'

/**
 * What an edge says, in the direction the reader is looking.
 *
 * Read from the page you are ON: a SEQUEL edge points at the work that comes after this one, so it is
 * labelled "Sequel". The wording follows the two sites people already read these on, which agree on
 * every one of them except that AniList writes "Alternative" where MyAnimeList writes "Alternative
 * version"; the shorter one is used because it sits in a narrow card.
 */
const RELATIONS: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  ADAPTATION: { id: 'Adaptation', defaultMessage: 'Adaptation' },
  PREQUEL: { id: 'Prequel', defaultMessage: 'Prequel' },
  SEQUEL: { id: 'Sequel', defaultMessage: 'Sequel' },
  PARENT: { id: 'Parent story', defaultMessage: 'Parent story' },
  SIDE_STORY: { id: 'Side story', defaultMessage: 'Side story' },
  CHARACTER: { id: 'Character#shares characters', defaultMessage: 'Character', description: 'shares characters' },
  SUMMARY: { id: 'Summary', defaultMessage: 'Summary' },
  ALTERNATIVE: { id: 'Alternative', defaultMessage: 'Alternative' },
  SPIN_OFF: { id: 'Spin off', defaultMessage: 'Spin off' },
  SOURCE: { id: 'Source#adapted from', defaultMessage: 'Source', description: 'adapted from' },
  COMPILATION: { id: 'Compilation', defaultMessage: 'Compilation' },
  CONTAINS: { id: 'Contains', defaultMessage: 'Contains' },
  OTHER: { id: 'Related', defaultMessage: 'Related' },
})

/**
 * The order relations are shown in, which is by how much a reader cares rather than alphabetically.
 *
 * What the story IS comes first (source, prequel, sequel, parent), then things beside it, then the
 * long tail. An unlisted relation sorts last, so adding one to the enum degrades to the bottom of the
 * list instead of throwing.
 */
const ORDER = [
  'SOURCE', 'PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE',
  'ADAPTATION', 'SUMMARY', 'COMPILATION', 'CONTAINS', 'CHARACTER', 'OTHER',
]

/** Where a relation sorts. Unknown values go last rather than first, which `indexOf` would do. */
export const relationRank = (relation: string): number => {
  const at = ORDER.indexOf(relation)
  return at === -1 ? ORDER.length : at
}

/** A relation as a reader reads it. Unknown values fall back to the enum's own catch-all wording. */
export const relationLabel = (relation: string | null | undefined): string =>
  intl.formatMessage((relation && RELATIONS[relation]) || RELATIONS.OTHER!)

/**
 * What KIND of work the other end is, spelled for a reader.
 *
 * These come off the edge's `format`, which is the naming source's own word and is display only. The
 * one that matters is `NOVEL`: AniList uses it for light novels, which is what a viewer of an anime
 * page is being told the show was adapted from, so writing it as "Novel" would understate it.
 */
const FORMATS: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  TV: { id: 'TV', defaultMessage: 'TV' },
  TV_SHORT: { id: 'TV Short', defaultMessage: 'TV Short' },
  MOVIE: { id: 'Movie', defaultMessage: 'Movie' },
  SPECIAL: { id: 'Special', defaultMessage: 'Special' },
  OVA: { id: 'OVA', defaultMessage: 'OVA' },
  ONA: { id: 'ONA', defaultMessage: 'ONA' },
  MUSIC: { id: 'Music', defaultMessage: 'Music' },
  MANGA: { id: 'Manga', defaultMessage: 'Manga' },
  NOVEL: { id: 'Light Novel', defaultMessage: 'Light Novel' },
  ONE_SHOT: { id: 'One Shot', defaultMessage: 'One Shot' },
})

/**
 * A work's kind, or `undefined` when the source named none.
 *
 * An unrecognised value is TITLE CASED rather than dropped, because it is still the source's own
 * answer to "what is this": a format nobody here has seen reads better as "Web Novel" than as nothing
 * at all, and nothing branches on it.
 */
export const workFormatLabel = (format: string | null | undefined): string | undefined => {
  if (!format) return undefined
  const known = FORMATS[format]
  if (known) return intl.formatMessage(known)
  return format
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
