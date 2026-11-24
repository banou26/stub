import type { ExternalSubtitleSelection } from '@banou/media-player'
import type { SubtitleQueryContext } from '../../plugin-api'

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { readDisabledSources, watchDisabledSources } from '../../sources/disabled-sources'
import {
  capPluginSubtitles,
  extractAniId,
  extractImdbId,
  extractReleaseName,
  extractSeasonNumber,
  fetchBuiltInExternalSubtitles,
  loadSubtitleCandidate,
  resolveImdbIdForMedia,
  searchExternalSubtitles,
  toRemoteExternalTracks,
  type EpisodeHandleLike,
  type EpisodeLike,
  type ExternalSubtitleBundle,
  type MediaLike,
  type SubtitleCandidate,
} from '../../subtitles'
import { languagePreferenceIndex, normalizeSubtitleLanguage } from '../../subtitles/languages'
import { fetchOpenSubtitles } from '../../subtitles/opensubtitles'
import { fetch as relayFetch } from '../../utils/fetch'
import { usePluginStatuses } from '../../utils/use-plugin-statuses'
import { useSetting } from '../../utils/use-setting'
import { viewerLanguages } from '../../viewer-languages'
import { findRemoteSubtitles, loadRemoteSubtitle } from '../../worker'
import { browserFetch } from '../../worker/browser-fetch'
import { withDirectFetch } from '../../worker/direct-fetch'

// OpenSubtitles sits in DIRECT_FETCH_ORIGINS (asked from browser); Xunlei goes through the FKN relay.
const viewerFetch = withDirectFetch(relayFetch, browserFetch)

export type WatchExternalSubtitles = {
  bundle: ExternalSubtitleBundle | undefined
  context: SubtitleQueryContext
  selectRequest: ExternalSubtitleSelection | undefined
  pickSubtitle: (candidate: SubtitleCandidate) => void
  pickSubtitles: (candidates: readonly SubtitleCandidate[]) => void
  search: (query: string, signal?: AbortSignal) => Promise<SubtitleCandidate[]>
}

export function useExternalSubtitles(options: {
  enabled: boolean
  mediaUri?: string
  episodeUri?: string
  media?: MediaLike | null
  episode?: EpisodeLike | null
  selected?: EpisodeHandleLike | null
  film: boolean
  locale: string
}): WatchExternalSubtitles {
  const { enabled, mediaUri = '', episodeUri = '', media, episode, selected, film, locale } = options
  const [builtinCandidates, setBuiltinCandidates] = useState<SubtitleCandidate[]>([])
  const [resolvedImdbId, setResolvedImdbId] = useState<string>()
  const [pluginCandidates, setPluginCandidates] = useState<SubtitleCandidate[]>([])
  const [picked, setPicked] = useState<SubtitleCandidate[]>([])
  const [selectRequest, setSelectRequest] = useState<ExternalSubtitleSelection>()
  const seqRef = useRef(0)

  const plugins = usePluginStatuses()
  const disabled = useSetting(readDisabledSources, watchDisabledSources)
  const searchablePluginOriginsKey = plugins
    .flatMap(plugin => plugin.state === 'connected' ? plugin.sources ?? [] : [])
    .filter(source => source.hasSubtitles && !disabled.includes(source.origin))
    .map(source => source.origin)
    .sort()
    .join(',')

  const imdbId = extractImdbId(media)
  const effectiveImdbId = imdbId ?? resolvedImdbId
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

  const context = useMemo<SubtitleQueryContext>(() => ({
    mediaUri,
    episodeUri,
    ...(effectiveImdbId ? { imdbId: effectiveImdbId } : {}),
    ...(aniProvider && aniId ? { aniId: { providerId: aniProvider, id: aniId } } : {}),
    isAnime,
    film,
    ...(season !== undefined ? { season } : {}),
    ...(episodeNumber !== undefined ? { episode: episodeNumber } : {}),
    ...(title ? { title } : {}),
    ...(releaseName ? { releaseName } : {}),
    preferredLanguages: preferredKey ? preferredKey.split(',') : [],
    locale,
  }), [
    mediaUri,
    episodeUri,
    effectiveImdbId,
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

  const loadCacheRef = useRef(new Map<string, Promise<string>>())
  const openSearchCacheRef = useRef<{ key: string, promise: Promise<SubtitleCandidate[]> } | null>(null)

  useEffect(() => {
    setPicked(prev => prev.length ? [] : prev)
    setSelectRequest(prev => prev ? undefined : prev)
    setResolvedImdbId(undefined)
    loadCacheRef.current.clear()
    openSearchCacheRef.current = null
  }, [episodeUri])

  useEffect(() => {
    setBuiltinCandidates([])
    if (!enabled) return
    if (!imdbId && !aniId && !title && !releaseName) return

    const controller = new AbortController()
    let active = true

    void fetchBuiltInExternalSubtitles({
      fetch: viewerFetch,
      mediaUri,
      episodeUri,
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
      setResolvedImdbId(next.imdbId)
      setBuiltinCandidates(next.candidates)
    }).catch(() => {
      if (!active || controller.signal.aborted) return
      setBuiltinCandidates([])
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

  useEffect(() => {
    if (!enabled || !searchablePluginOriginsKey) {
      setPluginCandidates(prev => prev.length ? [] : prev)
      return
    }
    let active = true
    const normalizedPreferred = (preferredKey ? preferredKey.split(',') : [])
      .map(lang => normalizeSubtitleLanguage(lang))
      .filter(lang => lang !== 'und')

    void findRemoteSubtitles(context)
      .then(tracks => {
        if (!active) return
        setPluginCandidates(capPluginSubtitles(tracks, normalizedPreferred))
      })
      .catch(() => {
        if (!active) return
        setPluginCandidates([])
      })

    return () => { active = false }
  }, [
    enabled,
    searchablePluginOriginsKey,
    context,
    preferredKey,
  ])

  const bundle = useMemo<ExternalSubtitleBundle | undefined>(() => {
    const merged = new Map<string, SubtitleCandidate>()
    for (const candidate of builtinCandidates) merged.set(candidate.id, candidate)
    for (const candidate of pluginCandidates) merged.set(candidate.id, candidate)
    for (const candidate of picked) merged.set(candidate.id, candidate)
    if (merged.size === 0) return undefined

    const normalizedPreferred = (preferredKey ? preferredKey.split(',') : [])
      .map(lang => normalizeSubtitleLanguage(lang))
      .filter(lang => lang !== 'und')

    const allCandidates = [...merged.values()].sort(
      (a, b) => languagePreferenceIndex(a.language, normalizedPreferred) - languagePreferenceIndex(b.language, normalizedPreferred),
    )
    const byId = new Map(allCandidates.map(candidate => [candidate.id, candidate]))

    return {
      tracks: toRemoteExternalTracks(allCandidates),
      candidates: allCandidates,
      load: (trackId: string) => {
        const existing = loadCacheRef.current.get(trackId)
        if (existing) return existing
        const candidate = byId.get(trackId)
        if (!candidate) return Promise.reject(new Error(`Unknown external subtitle track: ${trackId}`))
        const pending = loadSubtitleCandidate(candidate, {
          fetch: viewerFetch,
          loadPluginSubtitle: (origin, remoteTrackId) => loadRemoteSubtitle(origin, remoteTrackId),
        }).catch(err => {
          loadCacheRef.current.delete(trackId)
          throw err
        })
        loadCacheRef.current.set(trackId, pending)
        return pending
      },
    }
  }, [builtinCandidates, pluginCandidates, picked, preferredKey])

  const pickSubtitles = useCallback((candidates: readonly SubtitleCandidate[]) => {
    if (!candidates.length) return
    setPicked(prev => {
      const nextMap = new Map(prev.map(entry => [entry.id, entry]))
      for (const candidate of candidates) nextMap.set(candidate.id, candidate)
      return [...nextMap.values()]
    })
    setSelectRequest({ id: candidates[0]!.id, seq: ++seqRef.current })
  }, [])

  const pickSubtitle = useCallback((candidate: SubtitleCandidate) => {
    pickSubtitles([candidate])
  }, [pickSubtitles])

  const search = useCallback(async (query: string, signal?: AbortSignal): Promise<SubtitleCandidate[]> => {
    const normalizedPreferred = (preferredKey ? preferredKey.split(',') : [])
      .map(lang => normalizeSubtitleLanguage(lang))
      .filter(lang => lang !== 'und')
    const openKey = [
      episodeUri,
      effectiveImdbId ?? '',
      aniProvider ?? '',
      aniId ?? '',
      film ? '1' : '0',
      season,
      episodeNumber ?? '',
      releaseName ?? '',
      preferredKey,
      locale,
    ].join('\0')

    const fetchOpenCandidates = () => {
      if (openSearchCacheRef.current?.key === openKey) {
        return openSearchCacheRef.current.promise
      }
      const pending = (async () => {
        const resolvedId = effectiveImdbId ?? await resolveImdbIdForMedia({
          fetch: viewerFetch,
          imdbId: effectiveImdbId,
          aniId: aniProvider && aniId ? { providerId: aniProvider, id: aniId } : undefined,
          isAnime,
        })
        if (resolvedId) setResolvedImdbId(prev => prev ?? resolvedId)
        if (!resolvedId) return []
        const openTarget = film
          ? { kind: 'movie' as const, imdbId: resolvedId }
          : episodeNumber !== undefined && Number.isInteger(episodeNumber) && episodeNumber >= 0
            ? { kind: 'series' as const, imdbId: resolvedId, season, episode: episodeNumber }
            : undefined
        if (!openTarget) return []
        return fetchOpenSubtitles(openTarget, {
          fetch: viewerFetch,
          preferredLanguages: normalizedPreferred,
          releaseName,
          locale,
          perLanguageLimit: 50,
          totalLimit: 200,
        })
      })().catch(() => {
        if (openSearchCacheRef.current?.promise === pending) openSearchCacheRef.current = null
        return []
      })
      openSearchCacheRef.current = { key: openKey, promise: pending }
      return pending
    }

    const { candidates } = await searchExternalSubtitles({
      fetch: viewerFetch,
      mediaUri,
      episodeUri,
      imdbId: effectiveImdbId,
      aniId: aniProvider && aniId ? { providerId: aniProvider, id: aniId } : undefined,
      isAnime,
      film,
      season,
      episode: episodeNumber,
      title,
      releaseName,
      query,
      preferredLanguages: preferredKey ? preferredKey.split(',') : [],
      locale,
      signal,
      fetchOpenCandidates,
      findPluginSubtitles: ctx => findRemoteSubtitles(ctx),
      loadPluginSubtitle: (origin, trackId) => loadRemoteSubtitle(origin, trackId),
    })
    return candidates
  }, [
    mediaUri,
    episodeUri,
    effectiveImdbId,
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

  return {
    bundle,
    context,
    selectRequest,
    pickSubtitle,
    pickSubtitles,
    search,
  }
}
