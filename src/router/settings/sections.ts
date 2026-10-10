/** The settings page's sections, in the order the page and its index show them. */
export const SETTINGS_SECTIONS = [
  { id: 'accounts', title: 'Accounts' },
  { id: 'sources', title: 'Sources' },
  { id: 'tracking', title: 'Tracking' },
  { id: 'playback', title: 'Playback' },
] as const

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

/** The section a fragment names, spelled as `location.hash` spells it (`#data`). */
export const sectionFromHash = (hash: string): SettingsSectionId | undefined =>
  SETTINGS_SECTIONS.find(section => `#${section.id}` === hash)?.id
