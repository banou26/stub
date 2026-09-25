import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { pickTrackOption, pressTrackButton, readTrackMenuOptions, seekTimeline } from './cr-page'

const TRACK_BUTTON_SELECTOR = '[data-testid="track-selection-button"]'
const TRACK_MENU_SELECTOR = '[data-testid="audio-text-track-menu"]'
const TIMELINE_SELECTOR = '.timeline-slider'
const SECTION_SELECTOR = '[role="menu"]'
const OPTION_SELECTOR = '[role="menuitemradio"]'
const TRACK_MENU_TIMEOUT = 10_000
const TRACK_SELECT_TIMEOUT = 20_000
const PLAYBACK_STATE_TIMEOUT = 5_000
const POLL_INTERVAL = 100
const TRACK_MENU = { menu: TRACK_MENU_SELECTOR, section: SECTION_SELECTOR, option: OPTION_SELECTOR }
const OFF_LABEL = /^(off|none|disabled)$/i

export type CrunchyrollTrackOption = {
  id: string
  label: string
  disabled?: boolean
}

export type CrunchyrollTrackSelection = {
  options: readonly CrunchyrollTrackOption[]
  selectedId: string | null
  offLabel?: string
}

export type CrunchyrollTracks = {
  subtitles?: CrunchyrollTrackSelection
  audio?: CrunchyrollTrackSelection
}

export type CrunchyrollTrackKind = keyof CrunchyrollTracks

export type CrunchyrollRawTrackOption = {
  id: string
  label: string
  index: number
  selected: boolean
  disabled: boolean
}

export type CrunchyrollPlaybackSnapshot = {
  currentTime: number
  paused: boolean
  volume: number
  muted: boolean
  playbackRate: number
}

const sleep = (duration: number) => new Promise(resolve => setTimeout(resolve, duration))
const neverCancelled = () => false
const checkCancelled = (isCancelled: () => boolean) => {
  if (isCancelled()) throw new Error('Crunchyroll track operation cancelled')
}

const sectionIndex = (kind: CrunchyrollTrackKind) => kind === 'audio' ? 0 : 1

export const normalizeCrunchyrollLabel = (label: string) => label.replace(/\s+/g, ' ').trim()

export const normalizeCrunchyrollTrackSelection = (
  kind: CrunchyrollTrackKind,
  rawOptions: readonly CrunchyrollRawTrackOption[],
): CrunchyrollTrackSelection | undefined => {
  const unique = [...new Map(
    rawOptions
      .map(option => ({ ...option, label: normalizeCrunchyrollLabel(option.label) }))
      .filter(option => option.label)
      .map(option => [option.id, option]),
  ).values()]
  const selected = unique.find(option => option.selected)
  if (!selected) return undefined

  const off = kind === 'subtitles' ? unique.find(option => OFF_LABEL.test(option.label)) : undefined
  const options = unique
    .filter(option => option !== off)
    .map(option => ({
      id: option.id,
      label: option.label,
      disabled: option.disabled || undefined,
    }))

  if (options.length < 2 && !off) return undefined
  if (!options.length) return undefined

  return {
    options,
    selectedId: selected === off ? null : selected.id,
    ...(off ? { offLabel: off.label } : {}),
  }
}

const openTrackMenu = async (frame: Frame, isCancelled: () => boolean) => {
  checkCancelled(isCancelled)
  const menu = frame.locator(TRACK_MENU_SELECTOR)
  if (await menu.exists({ timeout: 1_000 })) {
    checkCancelled(isCancelled)
    return
  }

  checkCancelled(isCancelled)
  await frame.evaluate(pressTrackButton, { button: TRACK_BUTTON_SELECTOR, timeout: TRACK_MENU_TIMEOUT })

  const deadline = Date.now() + TRACK_MENU_TIMEOUT
  while (Date.now() < deadline) {
    checkCancelled(isCancelled)
    if (await menu.exists({ timeout: 1_000 })) return
    await sleep(POLL_INTERVAL)
  }
  throw new Error('Crunchyroll track menu did not open')
}

const readRawOptions = async (frame: Frame, kind: CrunchyrollTrackKind, isCancelled: () => boolean) => {
  checkCancelled(isCancelled)
  const read = await frame.evaluate(readTrackMenuOptions, { ...TRACK_MENU, sectionIndex: sectionIndex(kind) })
  checkCancelled(isCancelled)

  const rows = read.map((row, index) => ({ ...row, label: normalizeCrunchyrollLabel(row.label), index }))
  const frequencies = new Map<string, number>()
  for (const row of rows) frequencies.set(row.label, (frequencies.get(row.label) ?? 0) + 1)
  const occurrences = new Map<string, number>()

  return rows.map(row => {
    const occurrence = (occurrences.get(row.label) ?? 0) + 1
    occurrences.set(row.label, occurrence)
    return {
      ...row,
      id: frequencies.get(row.label) === 1 ? row.label : `${row.label}#${occurrence}`,
    }
  })
}

const readTracks = async (frame: Frame, isCancelled: () => boolean): Promise<CrunchyrollTracks> => {
  const [audio, subtitles] = await Promise.all([
    readRawOptions(frame, 'audio', isCancelled),
    readRawOptions(frame, 'subtitles', isCancelled),
  ])
  return {
    audio: normalizeCrunchyrollTrackSelection('audio', audio),
    subtitles: normalizeCrunchyrollTrackSelection('subtitles', subtitles),
  }
}

export const discoverCrunchyrollTracks = async (
  frame: Frame,
  isCancelled: () => boolean = neverCancelled,
) => {
  await openTrackMenu(frame, isCancelled)
  return readTracks(frame, isCancelled)
}

const findOptionIndex = async (
  frame: Frame,
  kind: CrunchyrollTrackKind,
  id: string | null,
  isCancelled: () => boolean,
) => {
  const options = await readRawOptions(frame, kind, isCancelled)
  return options.find(option => id === null ? OFF_LABEL.test(option.label) : option.id === id)?.index ?? -1
}

const waitForTrackSelection = async (
  frame: Frame,
  kind: CrunchyrollTrackKind,
  id: string | null,
  isCancelled: () => boolean,
) => {
  const deadline = Date.now() + TRACK_SELECT_TIMEOUT
  while (Date.now() < deadline) {
    checkCancelled(isCancelled)
    await openTrackMenu(frame, isCancelled)
    const selected = (await readRawOptions(frame, kind, isCancelled)).find(option => option.selected)
    if (selected && (id === null ? OFF_LABEL.test(selected.label) : selected.id === id)) return
    await sleep(POLL_INTERVAL)
  }
  throw new Error(`Crunchyroll did not apply the ${kind} option`)
}

export const clampCrunchyrollTime = (time: number, duration: number) => {
  const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0
  if (!Number.isFinite(duration) || duration <= 0) return safeTime
  return Math.min(safeTime, Math.max(0, duration - 0.1))
}

export const captureCrunchyrollPlayback = (remote: RemoteVideoElement): CrunchyrollPlaybackSnapshot => ({
  currentTime: remote.currentTime,
  paused: remote.paused,
  volume: remote.volume,
  muted: remote.muted,
  playbackRate: remote.playbackRate,
})

export const seekCrunchyrollTimeline = (frame: Frame, time: number) =>
  frame.evaluate(seekTimeline, { timeline: TIMELINE_SELECTOR, time, timeout: TRACK_SELECT_TIMEOUT })

const waitForPlayback = async (
  remote: RemoteVideoElement,
  previousSource: string,
  isCancelled: () => boolean,
) => {
  const transitionDeadline = Date.now() + 5_000
  while (Date.now() < transitionDeadline) {
    checkCancelled(isCancelled)
    if (remote.currentSrc !== previousSource || remote.readyState < 2) break
    await sleep(POLL_INTERVAL)
  }
  if (remote.currentSrc === previousSource && remote.readyState >= 2) return false

  const deadline = Date.now() + TRACK_SELECT_TIMEOUT
  while (Date.now() < deadline) {
    checkCancelled(isCancelled)
    if (remote.readyState >= 2) return true
    await sleep(POLL_INTERVAL)
  }
  throw new Error('Crunchyroll playback did not become ready after changing tracks')
}

const restoreCrunchyrollPlayback = async (
  frame: Frame,
  remote: RemoteVideoElement,
  snapshot: CrunchyrollPlaybackSnapshot,
  isCancelled: () => boolean,
) => {
  checkCancelled(isCancelled)
  remote.volume = snapshot.volume
  remote.muted = snapshot.muted
  remote.playbackRate = snapshot.playbackRate

  const target = clampCrunchyrollTime(snapshot.currentTime, remote.duration)
  if (Math.abs(remote.currentTime - target) > 2) await seekCrunchyrollTimeline(frame, target)

  const seekDeadline = Date.now() + TRACK_SELECT_TIMEOUT
  while (
    Date.now() < seekDeadline
    && (Math.abs(remote.currentTime - target) > 2 || remote.seeking || remote.readyState < 2)
  ) {
    checkCancelled(isCancelled)
    await sleep(POLL_INTERVAL)
  }
  if (Math.abs(remote.currentTime - target) > 2 || remote.seeking || remote.readyState < 2) {
    throw new Error('Crunchyroll playback position was not restored after changing tracks')
  }

  checkCancelled(isCancelled)
  if (snapshot.paused) remote.pause()
  else await remote.play()

  const playbackDeadline = Date.now() + PLAYBACK_STATE_TIMEOUT
  while (Date.now() < playbackDeadline && remote.paused !== snapshot.paused) {
    checkCancelled(isCancelled)
    await sleep(POLL_INTERVAL)
  }
  if (remote.paused !== snapshot.paused) {
    throw new Error('Crunchyroll playback state was not restored after changing tracks')
  }
}

export const selectCrunchyrollTrack = async (
  frame: Frame,
  remote: RemoteVideoElement,
  kind: CrunchyrollTrackKind,
  id: string | null,
  isCancelled: () => boolean = neverCancelled,
) => {
  await openTrackMenu(frame, isCancelled)
  const index = await findOptionIndex(frame, kind, id, isCancelled)
  if (index < 0) throw new Error(`Crunchyroll ${kind} option is no longer available`)

  checkCancelled(isCancelled)
  const previousSource = remote.currentSrc
  const playback = captureCrunchyrollPlayback(remote)
  await frame.evaluate(pickTrackOption, { ...TRACK_MENU, sectionIndex: sectionIndex(kind), optionIndex: index })

  await waitForTrackSelection(frame, kind, id, isCancelled)
  const transitioned = await waitForPlayback(remote, previousSource, isCancelled)
  if (transitioned) await restoreCrunchyrollPlayback(frame, remote, playback, isCancelled)
  return discoverCrunchyrollTracks(frame, isCancelled)
}
