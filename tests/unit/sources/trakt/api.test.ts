// Trakt's public API as the media source and the tracker's placing ask it.
import { expect, test } from 'vite-plus/test'

import { traktApi } from '../../../../src/sources/trakt/api'

const answering = (response: () => Response) => ({ fetch: async () => response() })

test('a public read is its JSON on a 2xx, and undefined on anything else, a JSON error included, so it is asked again', async () => {
  expect(await traktApi('/shows/frieren-beyond-journey-s-end', answering(() => Response.json({ ids: { trakt: 198225 } })))).toEqual({ ids: { trakt: 198225 } })
  expect(await traktApi('/shows/frieren-beyond-journey-s-end', answering(() => Response.json({ error: 'server error' }, { status: 503 })))).toBeUndefined()
  expect(await traktApi('/shows/frieren-beyond-journey-s-end', answering(() => new Response('<html>not here</html>')))).toBeUndefined()
  expect(await traktApi('/shows/frieren-beyond-journey-s-end', answering(() => { throw new TypeError('Failed to fetch') }))).toBeUndefined()
})
