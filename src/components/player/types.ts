import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { Media } from '@videojs/media/dom'

export type PlayerChoice = {
  id: string
  label: string
  kind?: 'native' | 'external'
  description?: string
  disabled?: boolean
}

export type PlayerSelection = {
  label: string
  options: readonly PlayerChoice[]
  selectedId: string | null
  onSelect: (id: string | null) => void | Promise<void>
  offLabel?: string
}

export type PlayerCapabilities = {
  subtitles?: PlayerSelection
  audioTracks?: PlayerSelection
  qualityLevels?: PlayerSelection
}

export type PlayerMediaBinding = {
  media: Media
  dispose?: () => void
}

export type PlayerMediaAdapter = (
  remote: RemoteVideoElement,
  frame: Frame,
) => Media | PlayerMediaBinding | null
