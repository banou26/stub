import { useEffect, useState } from 'preact/hooks'

import {
  extractAniId,
  extractImdbId,
  extractReleaseName,
  extractSeasonNumber,
  fetchExternalSubtitles,
  type EpisodeHandleLike,
  type EpisodeLike,
  type ExternalSubtitleBundle,
  type MediaLike,
} from '../../subtitles'
import { fetch as relayFetch } from '../../utils/fetch'
import { viewerLanguages } from '../../viewer-languages'
import { browserFetch } from '../../worker/browser-fetch'
import { withDirectFetch } from '../../worker/direct-fetch'

// OpenSubtitles sits in DIRECT_FETCH_ORIGINS (asked from browser); Xunlei goes through the FKN relay.
const viewerFetch = withDirectFetch(relayFetch, browserFetch)

export function useExternalSubtitles(options: {
  enabled: boolean
  media?: MediaLike | null
  episode?: EpisodeLike | null
  selected?: EpisodeHandleLike | null
  film: boolean
  locale: string
}): ExternalSubtitleBundle | undefined {
  const { enabled, media, episode, selected, film, locale } = options
  const [bundle, setBundle] = useState<ExternalSubtitleBundle>()

  const imdbId = extractImdbId(media)
  const ani = extractAniId(media)
  const aniProvider = ani?.providerId
  const aniId = ani?.id
  const isAnime = Boolean(media?.categories?.some(category => category === 'ANIME') || aniId)
  const season = extractSeasonNumber(media)
  const episodeNumber = episode?.episodeNumber ?? undefined
  const title = media?.titles?.find(entry => entry?.title?.trim())?.title?.trim() || undefined
  const releaseName = extractReleaseName(selected, episode)

  const viewer = viewerLanguages()
  const preferred = [viewer.subtitles, viewer.language, viewer.audio].filter((lang): lang is string => Boolean(lang))
  const preferredKey = preferred.join(',')

  useEffect(() => {
    setBundle(undefined)
    if (!enabled) return
    if (!imdbId && !aniId && !title && !releaseName) return

    const controller = new AbortController()
    let active = true

    void fetchExternalSubtitles({
      fetch: viewerFetch,
      imdbId,
      aniId: aniProvider && aniId ? { providerId: aniProvider, id: aniId } : undefined,
      isAnime,
      film,
      season,
      episode: episodeNumber,
      title,
      releaseName,
      preferredLanguages: preferredKey ? preferredKey.split(',') : [],
      locale,
      signal: controller.signal,
    }).then(next => {
      if (!active || controller.signal.aborted) return
      setBundle(next.tracks.length ? next : undefined)
    }).catch(() => {
      if (!active || controller.signal.aborted) return
      setBundle(undefined)
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [
    enabled,
    imdbId,
    aniProvider,
    aniId,
    isAnime,
    film,
    season,
    episodeNumber,
    title,
    releaseName,
    preferredKey,
    locale,
  ])

  return bundle
}
