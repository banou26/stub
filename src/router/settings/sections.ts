/** The settings page's categories, in the order its list shows them. */
export const SETTINGS_SECTIONS = [
  { id: 'sources', title: 'Sources' },
  { id: 'playback', title: 'Playback' },
] as const

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

/**
 * The category a fragment picks, spelled as `location.hash` spells it (`#sources`). No fragment, or one
 * naming no category (`#accounts` from before the sign-ins joined their sources' cards), picks Sources.
 */
export const sectionFromHash = (hash: string): SettingsSectionId =>
  SETTINGS_SECTIONS.find(section => `#${section.id}` === hash)?.id ?? 'sources'
