// A link preview's share of the private source store (scripts/source-store.mjs): what one run's sources
// answered, as one gzip object under the bucket's `inbox/`, which the Offline history job folds into the store. Public
// show data and dates only: nothing here is read from the request the preview answers.
import type { AnswerRow } from '../worker/graph'

import { origin as offline } from '../sources/offline/extractor'

/** Who wrote a line: the preview Function, at stub's version and 8 characters of its commit, as the job's writer. */
export type Writer = { by: 'stub-preview', stub: string, commit: string }

/** The index line of one answer, every field of scripts/source-store.mjs's but `changedAt`, which the fold dates. */
export type IndexLine = {
  source: string
  id: string
  region: string | null
  class: 'full' | 'list'
  sha256: string
  fetchedAt: string
  partial: boolean
  role: 'member' | 'related' | null
  body: true
  writer: Writer
}

/** The answer itself, as the source made it (`AnswerRow.raw`). */
export type BodyLine = {
  source: string
  id: string
  form: 'answer'
  sha256: string
  run: string
  operation: string
  selection: string[]
  body: string
}

/** One line of an inbox object. */
export type InboxLine = { index: IndexLine, body: BodyLine }

export type Run = {
  /** The run's address: the card's, settled or last. */
  run: string
  /** The card's handles, which say whose answer is the show's own (`SAME_AS`) and whose is a related one. */
  handles: { relation: string, node: { uri: string } }[]
  /** Whether the run settled; a run cut at `settleBy` marks every line `partial`. */
  settled: boolean
  /** When the run settled or was cut: an answer row has no HTTP date of its own. */
  fetchedAt: string
  writer: Writer
  /** The country `origin`'s answers are read in (`ExtractorDefinition.region`), or null. */
  regionOf: (origin: string) => string | null
}

/**
 * The inbox lines of a run's answer log (`exportAnswers`, in `seq` order): one per (source, id, region, class), the
 * newest. Media answers only, and none of the offline source, whose bundled dump the store already dates.
 */
export const inboxLines = (rows: readonly AnswerRow[], { run, handles, settled, fetchedAt, writer, regionOf }: Run): InboxLine[] => {
  const roles = new Map<string, 'member' | 'related'>()
  for (const { relation, node } of handles) {
    if (relation === 'SAME_AS') roles.set(node.uri, 'member')
    else if (!roles.has(node.uri)) roles.set(node.uri, 'related')
  }
  const lines = new Map<string, InboxLine>()
  for (const row of rows) {
    if (row.kind !== 'media' || row.origin === offline) continue
    const source = row.origin
    const id = row.uri.slice(row.uri.indexOf(':') + 1)
    const region = regionOf(source)
    const kind = row.operation === 'MEDIA' ? 'full' : 'list'
    lines.set([source, id, region, kind].join('\t'), {
      index: { source, id, region, class: kind, sha256: row.key, fetchedAt, partial: !settled, role: roles.get(row.uri) ?? null, body: true, writer },
      body: { source, id, form: 'answer', sha256: row.key, run, operation: row.operation, selection: row.selection, body: row.raw },
    })
  }
  return [...lines.values()]
}

/** An object for the bucket: its key under `inbox/`, named by the run's day and a random id, and its gzip bytes. */
export type InboxObject = { key: string, body: ArrayBuffer }

/** The object holding `lines`, or undefined when there are none. */
export const inboxObject = async (lines: readonly InboxLine[], fetchedAt: string): Promise<InboxObject | undefined> => {
  if (!lines.length) return undefined
  const text = lines.map(line => `${JSON.stringify(line)}\n`).join('')
  const body = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  return { key: `inbox/${fetchedAt.slice(0, 10)}/${crypto.randomUUID()}.jsonl.gz`, body }
}
