/** The settings page's categories, in the order its list shows them, with the line under each heading. */
export const SETTINGS_SECTIONS = [
  { id: 'accounts', title: 'Accounts', intro: 'The sites where stub uses your own account, what each one is for, and how to sign out.' },
  { id: 'sources', title: 'Sources', intro: 'Community-made sources, published on npm. FKN installs them for stub, and each one runs isolated from stub.' },
] as const

type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

/**
 * The category a fragment picks, spelled as `location.hash` spells it (`#sources`). No fragment, or one
 * naming no category (`#data` from before the Data section went), picks Accounts.
 */
export const sectionFromHash = (hash: string): SettingsSectionId =>
  SETTINGS_SECTIONS.find(section => `#${section.id}` === hash)?.id ?? 'accounts'
