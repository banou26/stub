import type { SubtitleQueryContext } from '../src/plugin-api'
import type { NormalizedPluginSubtitle } from '../src/worker/plugin-sources'

import { STAGE_PLUGIN, PLUGIN_SOURCE_ORIGIN } from './watch-stage-media'

const PLUGIN_ORIGIN = 'spec-subs'

const FAKE_TRACKS: NormalizedPluginSubtitle[] = [
  {
    id: `plugin:${PLUGIN_ORIGIN}:en-hello`,
    language: 'en',
    label: 'Hello English (Spec Subtitles)',
    format: 'srt',
    source: 'plugin',
    sourceName: 'Spec Subtitles',
    pluginOrigin: PLUGIN_ORIGIN,
    remoteTrackId: 'en-hello',
    release: 'Show.S01E01.Hello.1080p.WEB',
    group: 'SubsGroup',
  },
  {
    id: `plugin:${PLUGIN_ORIGIN}:ja-hello`,
    language: 'ja',
    label: 'Hello Japanese (Spec Subtitles)',
    format: 'srt',
    source: 'plugin',
    sourceName: 'Spec Subtitles',
    pluginOrigin: PLUGIN_ORIGIN,
    remoteTrackId: 'ja-hello',
    release: 'Show.S01E01.Hello.JA',
    group: 'JPSubs',
  },
]

const enabled = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('stub-enabled-plugins') ?? '[]') as string[]
  } catch {
    return []
  }
}

const disabled = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('stub.sources.disabled') ?? '[]') as string[]
  } catch {
    return []
  }
}

export const registerRemoteSource = async () => ({ ok: { sources: [], rejected: [], settings: [] } })
export const unregisterRemoteSource = async () => {}
export const configureRemoteSource = async () => {}
export const remoteAccount = async () => undefined
export const remotePicker = async () => null
export const remotePlayer = async (origin: string) => origin === PLUGIN_SOURCE_ORIGIN ? { pluginUri: STAGE_PLUGIN } : null
export const trackerCheck = async () => {}
export const selectRemoteRelease = async () => null
export const fetchRemoteCatalogItems = async () => []
export const runRemoteCatalogAction = async () => null
export const remoteCheck = async () => null
export const searchAgain = async () => {}

export const findRemoteSubtitles = async (context: SubtitleQueryContext): Promise<NormalizedPluginSubtitle[]> => {
  if (!enabled().includes('npm:@spec/subtitles-only') || disabled().includes(PLUGIN_ORIGIN)) return []
  const query = context.query?.trim().toLowerCase()
  if (!query && localStorage.getItem('spec.subs.auto') === '0') return []
  if (!query) return FAKE_TRACKS
  return FAKE_TRACKS.filter(track =>
    `${track.release ?? ''} ${track.label} ${track.language}`.toLowerCase().includes(query),
  )
}

export const loadRemoteSubtitle = async (origin: string, remoteTrackId: string): Promise<string> => {
  if (origin === PLUGIN_ORIGIN && remoteTrackId === 'en-hello') {
    return '1\n00:00:00,000 --> 00:00:10,000\nPlugin subtitle line\n'
  }
  return '1\n00:00:00,000 --> 00:00:10,000\nOther subtitle line\n'
}

export const selectRemoteSubtitle = async () => []
