/**
 * A season page reached in one tab after other pages, for the tests that compare it with a fresh load.
 *
 * Each page's answers go through the log and the ingest as a page's do, so a re-fetch is deduplicated exactly as in
 * the app, and the graph settles before the next page. The caller enables the graph.
 */
import type { MediaPageFilters } from '../../../../src/worker/store/filter'
import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'
import type { Media } from '../../../../src/generated/schema/types.generated'

import { flushAnswers, recordAnswers } from '../../../../src/worker/graph/answers'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { createPageReader } from '../../../../src/worker/graph/read'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import { passSettled, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { pageRows } from '../../../../src/worker/store/filter'

const PAGE_PATH = { prev: { prev: undefined, key: 'mediaPage', typename: 'Subscription' }, key: 'nodes', typename: 'MediaPage' }

/** The cards the last of `pages` lists, on an empty graph that took every page's answers in turn. */
export const pageAfter = async (pages: Record<string, unknown>[][], input: MediaPageFilters): Promise<(Media & ClusterCard)[]> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ audit: false })
  try {
    for (const answers of pages) {
      await recordAnswers({ path: PAGE_PATH, variableValues: {} }, 'Media', answers)
      await flushAnswers()
      await passSettled()
    }
    const uris = pages.at(-1)!.map(answer => String(answer.uri))
    const cards = await createPageReader().read(uris)
    return pageRows(cards as unknown as (Media & ClusterCard)[], input, uris, 'anime')
  } finally {
    stopScheduler()
  }
}
