import type { JSX } from 'preact'
import type { SearchCardFragment } from '../../generated/graphql'
import type { SceneAnswer, SceneMatch } from '../../scene/search'

import { ImageIcon, LucidePlay } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { gql } from '../../generated'
import { MediaType } from '../../generated/graphql'
import { searchScene } from '../../worker'
import { momentLabel, SCENE_ERRORS } from '../../scene/search'
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

/** trace.moe's answer for a color code, asked once each time the page opens it, and nothing while it is out. */
export const useScene = (code: string | undefined): SceneAnswer | undefined => {
  const [answered, setAnswered] = useState<{ code: string, answer: SceneAnswer }>()
  useEffect(() => {
    if (!code) return
    let current = true
    void searchScene(code)
      .catch((): SceneAnswer => ({ error: SCENE_ERRORS.busy }))
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
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="picture" aria-label="Search by picture" title="Search by picture" onClick={() => input.current?.click()}>
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
          const label = momentLabel(film ? { ...moment, episode: null } : moment)
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
