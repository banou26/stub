// Stub's code inside a real saucenao.com document, built into a standalone function
// via `?page-script` and installed by ./saucenao.ts inside an attached hidden frame.
// Same-origin POST to `/search.php` uses the browser's real SauceNAO page session with no API key.

import type { ServeArg } from '../tracking/session-frames'

import { installSessionServer } from '../tracking/page-install'

export type SauceNaoSearchRequest = {
  bytes: Uint8Array
  mimeType: string
  dbs: number[]
}

export type SauceNaoPageResult = {
  status: number
  html: string
}

export type SauceNaoPageApi = {
  search: (request: SauceNaoSearchRequest) => Promise<SauceNaoPageResult>
}

export const createSauceNaoPage = (
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>,
): SauceNaoPageApi => ({
  search: async ({ bytes, mimeType, dbs }) => {
    const form = new FormData()
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    form.append('file', new Blob([copy.buffer], { type: mimeType || 'image/jpeg' }), 'scene.jpg')
    for (const db of dbs) form.append('dbs[]', String(db))
    const response = await fetchFn('/search.php', {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    })
    return { status: response.status, html: await response.text() }
  },
})

export const run = (arg: ServeArg): 'installed' | 'reinstalled' => {
  const page = globalThis as typeof globalThis & Record<symbol, unknown>
  const api = createSauceNaoPage((input, init) => page.fetch(input, init))
  return installSessionServer(arg, page, api)
}
