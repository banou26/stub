// What a source states about its stream before it plays, as the Episode fields `videoQualities`,
// `audioQualities`, `audioLanguages` and `subtitleLanguages` carry it.

const unique = (values: readonly (string | undefined)[]): string[] | undefined => {
  const kept = [...new Set(values.filter((value): value is string => Boolean(value)))]
  return kept.length ? kept : undefined
}

/** A source's language codes as unique BCP 47 tags (`pt_BR` is `pt-BR`), or undefined when it named none. */
export const languageTags = (codes: readonly (string | null | undefined)[] | null | undefined): string[] | undefined =>
  unique((codes ?? []).map(code => code?.trim().replace(/_/g, '-')))

/**
 * The labels `table` gives a source's own values, once each and in the table's order, since a source can
 * list one stream's formats in any order (Apple TV, 2026-10-25); a value it has no label for is dropped.
 */
export const qualityLabels = (values: readonly (string | null | undefined)[] | null | undefined, table: Record<string, string>): string[] | undefined =>
  unique(Object.keys(table).filter(value => values?.includes(value)).map(value => table[value]))
