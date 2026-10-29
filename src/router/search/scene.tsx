import type { JSX } from 'preact'
import type { SearchCardFragment } from '../../generated/graphql'
import type { MessageDescriptor } from 'react-intl'
import type { SceneAnswer, SceneError, SceneMatch } from '../../scene/search'

import { ImageIcon, LucidePlay } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
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
 * Calls `onPicture` with a file pasted or dropped anywhere on the page while `enabled`. A paste that carries text is
 * left to the field, even with a file beside it: Word and Excel copy a picture of the selection next to its text.
 */
export const usePictureInput = (onPicture: (file: File) => void, enabled: boolean) => {
  const latest = useRef(onPicture)
  latest.current = onPicture
  useEffect(() => {
    if (!enabled) return
    const paste = (event: ClipboardEvent) => {
      const file = event.clipboardData?.files[0]
      if (!file || event.clipboardData!.types.includes('text/plain')) return
      event.preventDefault()
      latest.current(file)
    }
    // a page that refuses the drag lets the browser open the file in its place
    const dragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      const file = event.dataTransfer?.files[0]
      if (!file) return
      event.preventDefault()
      latest.current(file)
    }
    document.addEventListener('paste', paste)
    document.addEventListener('dragover', dragOver)
    document.addEventListener('drop', drop)
    return () => {
      document.removeEventListener('paste', paste)
      document.removeEventListener('dragover', dragOver)
      document.removeEventListener('drop', drop)
    }
  }, [enabled])
}

/** The search field's button that picks a picture to search by. */
export const PictureButton = ({ onPicture }: { onPicture: (file: File) => void }) => {
  const label = useIntl().formatMessage({ id: 'Search by picture', defaultMessage: 'Search by picture' })
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="picture" aria-label={label} title={label} onClick={() => input.current?.click()}>
        <ImageIcon size={17}/>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) onPicture(file)
        }}
      />
    </>
  )
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
