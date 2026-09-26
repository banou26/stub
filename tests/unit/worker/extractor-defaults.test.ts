// A provider that implements nothing must still ANSWER: a subscription generator that ends without
// yielding makes yoga respond 204, and the caller then waits instead of reading a refusal.
import { expect, test } from 'vitest'

import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../src/worker/tracking-document'
import { payloads, providerServer, yogaClient } from './yoga-client'

const bare = providerServer('bare', {})

test('a provider with no tracking resolver yields a null tracking rather than ending', async () => {
  const { status, results } = await payloads(bare, TRACKING_DOCUMENT, { input: { uri: 'ag:(anilist:1)' } }, 1)

  expect(status, 'a 204 is the answer a caller waits out').toBe(200)
  expect(results).toEqual([{ data: { tracking: null } }])
})

test('the media defaults still yield their refusals', async () => {
  const { results } = await payloads(bare, 'subscription ($input: MediaInput!) { media(input: $input) { uri } }', { input: { uri: 'x:1' } }, 1)

  expect(results).toEqual([{ data: { media: null } }])
})

test('a provider with no write resolvers answers an empty list, which the app reads as "takes no writes"', async () => {
  const client = yogaClient(bare)
  const saved = await client.mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri: 'ag:(anilist:1)', trackers: ['bare'], entry: { progress: 1 } } }).toPromise()
  const deleted = await client.mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri: 'ag:(anilist:1)', trackers: ['bare'] } }).toPromise()

  expect(saved).toEqual({ data: { saveListEntry: [] } })
  expect(deleted).toEqual({ data: { deleteListEntry: [] } })
})
