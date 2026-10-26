import { defineMessages } from 'react-intl'

const TITLES = defineMessages({
  sources: { id: 'Sources', defaultMessage: 'Sources' },
  playback: { id: 'Playback', defaultMessage: 'Playback' },
})

/** The settings page's categories, in the order its list shows them, each titled by its message. */
export const SETTINGS_SECTIONS = [
  { id: 'sources', title: TITLES.sources },
  { id: 'playback', title: TITLES.playback },
] as const

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

/**
 * The category a fragment picks, spelled as `location.hash` spells it (`#sources`). No fragment, or one
 * naming no category (`#accounts` from before the sign-ins joined their sources' cards), picks Sources.
 */
export const sectionFromHash = (hash: string): SettingsSectionId =>
  SETTINGS_SECTIONS.find(section => `#${section.id}` === hash)?.id ?? 'sources'
