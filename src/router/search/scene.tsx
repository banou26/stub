import type { JSX } from 'preact'
import type { SearchCardFragment } from '../../generated/graphql'
import type { MessageDescriptor } from 'react-intl'
import type { SceneAnswer, SceneEngine, SceneError, SceneMatch } from '../../scene/search'

import { LucidePlay } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { defineMessages, useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { gql } from '../../generated'
import { MediaType } from '../../generated/graphql'
import { searchScene } from '../../worker'
import { readPicture } from '../../scene/picture-store'
import { searchSauceNao } from '../../scene/saucenao'
import { mergeSceneMatches, momentTime, sceneMatchUri } from '../../scene/search'
import { site } from '../../site'
import Placeholder from '../../components/placeholder'
import { getRoutePath, Route } from '../path'
import { watchFrom } from '../watch/resume'

const SCENE_MEDIA = gql(`
  subscription SceneMedia($input: MediaInput!, $shortDescriptionInput: MediaShortDescriptionInput!) {
    media(input: $input) {
      ...SearchCard
      episodes {
        _id
        uri
        episodeNumber
        seasonNumber
      }
    }
  }
`)

/** What the page says of each trace.moe refusal, in place of the matches. */
export const SCENE_ERRORS: Readonly<Record<SceneError, MessageDescriptor>> = defineMessages({
  limit: { id: "trace.moe's daily limit is reached. Try again tomorrow.", defaultMessage: "trace.moe's daily limit is reached. Try again tomorrow." },
  busy: { id: 'trace.moe is busy. Try again in a moment.', defaultMessage: 'trace.moe is busy. Try again in a moment.' },
  failed: { id: 'trace.moe could not search this picture.', defaultMessage: 'trace.moe could not search this picture.' },
  reupload: { id: 'Select or paste the picture again to search SauceNAO.', defaultMessage: 'Select or paste the picture again to search SauceNAO.' },
})

/** What the page says of each SauceNAO refusal when SauceNAO alone ran. */
export const SAUCENAO_ERRORS: Readonly<Record<SceneError, MessageDescriptor>> = defineMessages({
  limit: { id: "SauceNAO's daily limit is reached. Try again tomorrow.", defaultMessage: "SauceNAO's daily limit is reached. Try again tomorrow." },
  busy: { id: 'SauceNAO is busy. Try again in a moment.', defaultMessage: 'SauceNAO is busy. Try again in a moment.' },
  failed: { id: 'SauceNAO could not search this picture.', defaultMessage: 'SauceNAO could not search this picture.' },
  reupload: { id: 'Select or paste the picture again to search SauceNAO.', defaultMessage: 'Select or paste the picture again to search SauceNAO.' },
})

export const sceneErrorDescriptor = (error: SceneError, engines?: readonly SceneEngine[]): MessageDescriptor =>
  engines?.length === 1 && engines[0] === 'saucenao' ? SAUCENAO_ERRORS[error] : SCENE_ERRORS[error]

/**
 * Scene search answer for `code` on the active site.
 *
 * `movie` and `series` query SauceNAO directly via its attached frame using the in-memory picture;
 * `anime` and `stub` run `trace.moe` and SauceNAO in parallel, merging results as they land.
 */
export const useScene = (code: string | undefined): SceneAnswer | undefined => {
  const [answered, setAnswered] = useState<{ code: string, answer: SceneAnswer }>()
  const currentSite = site
  const liveAction = currentSite === 'movie' || currentSite === 'series'
  useEffect(() => {
    if (!code) return
    let current = true
    if (liveAction) {
      const file = readPicture(code)
      if (!file) {
        setAnswered({ code, answer: { error: 'reupload', engines: ['saucenao'] } })
        return
      }
      void searchSauceNao(file, currentSite)
        .catch((): SceneAnswer => ({ error: 'busy' }))
        .then(answer => {
          if (current) setAnswered({ code, answer: { ...answer, engines: ['saucenao'] } })
        })
      return () => { current = false }
    }

    const file = readPicture(code)
    const tracePromise = searchScene(code).catch((): SceneAnswer => ({ error: 'busy' }))
    if (!file) {
      void tracePromise.then(answer => {
        if (current) setAnswered({ code, answer: { ...answer, engines: ['trace.moe'] } })
      })
      return () => { current = false }
    }

    const saucePromise = searchSauceNao(file, currentSite).catch((): SceneAnswer => ({ error: 'busy' }))
    let traceDone: SceneAnswer | undefined
    let sauceDone: SceneAnswer | undefined

    const publish = () => {
      if (!current || !traceDone) return
      const traceMatches = 'matches' in traceDone ? traceDone.matches : []
      if (!sauceDone) {
        if (traceMatches.length) setAnswered({ code, answer: { matches: traceMatches, engines: ['trace.moe'] } })
        return
      }
      const sauceMatches = 'matches' in sauceDone ? sauceDone.matches : []
      const engines: SceneEngine[] = [
        ...'matches' in traceDone && (traceMatches.length > 0 || !sauceMatches.length) ? ['trace.moe' as const] : [],
        ...'matches' in sauceDone && (sauceMatches.length > 0 || !traceMatches.length) ? ['saucenao' as const] : [],
      ]
      if (traceMatches.length || sauceMatches.length) {
        setAnswered({
          code,
          answer: {
            matches: mergeSceneMatches(traceMatches, sauceMatches),
            engines: engines.length ? engines : ['trace.moe'],
          },
        })
        return
      }
      if ('matches' in traceDone || 'matches' in sauceDone) {
        setAnswered({ code, answer: { matches: [], engines: engines.length ? engines : ['trace.moe'] } })
        return
      }
      setAnswered({ code, answer: { error: traceDone.error, engines: ['trace.moe'] } })
    }

    void tracePromise.then(answer => { traceDone = answer; publish() })
    void saucePromise.then(answer => { sauceDone = answer; publish() })
    return () => { current = false }
  }, [code, currentSite, liveAction])
  return answered && answered.code === code ? answered.answer : undefined
}

/**
 * One title a scene search found, drawn by the page's own `item`, with a link per episode it matched in that opens
 * the episode at the scene. A film plays from the time alone; a moment with no episode, a special, opens only the show.
 */
export const SceneItem = ({ match, item }: { match: SceneMatch, item: (media: SearchCardFragment) => JSX.Element }) => {
  const intl = useIntl()
  const [{ data }] = useSubscription({
    query: SCENE_MEDIA,
    variables: { input: { uri: sceneMatchUri(match) }, shortDescriptionInput: { count: 1 } },
  })
  const media = data?.media
  if (!media) return <Placeholder className="pending"/>
  const film = media.type === MediaType.Movie
  return (
    <div className="scene">
      {item(media)}
      <div className="moments">
        {match.moments.map(moment => {
          if (moment.episode == null && !film) return undefined
          const time = momentTime(moment.from)
          const label = film || moment.episode == null
            ? time
            : moment.season != null
              ? intl.formatMessage(
                  { id: 'Season {season}, Episode {number}, {time}', defaultMessage: 'Season {season}, Episode {number}, {time}' },
                  { season: moment.season, number: moment.episode, time },
                )
              : intl.formatMessage({ id: 'Episode {number}, {time}', defaultMessage: 'Episode {number}, {time}' }, { number: moment.episode, time })
          const episode = moment.episode == null
            ? (film ? media.episodes[0] : undefined)
            : media.episodes.find(entry =>
                entry.episodeNumber === moment.episode
                && (moment.season == null || entry.seasonNumber == null || entry.seasonNumber === moment.season),
              )
          return episode
            ? (
              <Link key={label} className="moment" href={watchFrom(getRoutePath(Route.WATCH, { mediaUri: media.uri, episodeUri: episode.uri }), moment.from)}>
                <LucidePlay size={14} fill="currentColor" aria-hidden="true"/>{label}
              </Link>
            )
            : <span key={label} className="moment">{label}</span>
        })}
      </div>
    </div>
  )
}
