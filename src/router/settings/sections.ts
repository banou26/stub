/** The settings page's categories, in the order its list shows them. */
export const SETTINGS_SECTIONS = [
  { id: 'accounts', title: 'Accounts' },
  { id: 'sources', title: 'Sources' },
] as const

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

/**
 * The category a fragment picks, spelled as `location.hash` spells it (`#sources`). No fragment, or one
 * naming no category (`#data` from before the Data section went), picks Accounts.
 */
export const sectionFromHash = (hash: string): SettingsSectionId =>
  SETTINGS_SECTIONS.find(section => `#${section.id}` === hash)?.id ?? 'accounts'
