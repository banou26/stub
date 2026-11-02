import type { JSX } from 'preact'
import type { SearchCardFragment } from '../../generated/graphql'
import type { MessageDescriptor } from 'react-intl'
import type { SceneAnswer, SceneError, SceneMatch } from '../../scene/search'

import { LucidePlay } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { defineMessages, useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { gql } from '../../generated'
import { MediaType } from '../../generated/graphql'
import { searchScene } from '../../worker'
import { momentTime } from '../../scene/search'
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
      }
    }
  }
`)

/** What the page says of each refusal, in place of the matches. */
export const SCENE_ERRORS: Readonly<Record<SceneError, MessageDescriptor>> = defineMessages({
  limit: { id: "trace.moe's daily limit is reached. Try again tomorrow.", defaultMessage: "trace.moe's daily limit is reached. Try again tomorrow." },
  busy: { id: 'trace.moe is busy. Try again in a moment.', defaultMessage: 'trace.moe is busy. Try again in a moment.' },
  failed: { id: 'trace.moe could not search this picture.', defaultMessage: 'trace.moe could not search this picture.' },
})

/** trace.moe's answer for a color code, asked once each time the page opens it, and nothing while it is out. */
export const useScene = (code: string | undefined): SceneAnswer | undefined => {
  const [answered, setAnswered] = useState<{ code: string, answer: SceneAnswer }>()
  useEffect(() => {
    if (!code) return
    let current = true
    void searchScene(code)
      .catch((): SceneAnswer => ({ error: 'busy' }))
      .then(answer => { if (current) setAnswered({ code, answer }) })
    return () => { current = false }
  }, [code])
  return answered && answered.code === code ? answered.answer : undefined
}

/**
 * One show a scene search found, drawn by the page's own `item`, with a link per episode it matched in that opens
 * the episode at the scene. A film plays from the time alone; a moment with no episode, a special, opens only the show.
 */
export const SceneItem = ({ match, item }: { match: SceneMatch, item: (media: SearchCardFragment) => JSX.Element }) => {
  const intl = useIntl()
  const [{ data }] = useSubscription({
    query: SCENE_MEDIA,
    variables: { input: { uri: `anilist:${match.anilist}` }, shortDescriptionInput: { count: 1 } },
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
            : intl.formatMessage({ id: 'Episode {number}, {time}', defaultMessage: 'Episode {number}, {time}' }, { number: moment.episode, time })
          const episode = media.episodes.find(entry => entry.episodeNumber === moment.episode) ?? (film ? media.episodes[0] : undefined)
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
