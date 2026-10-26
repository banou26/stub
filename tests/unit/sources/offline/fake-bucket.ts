// A fake R2 bucket behind R2's S3 API, for the source store's real client (scripts/source-store.mjs): it answers
// only requests signed with the test's access key, and records each one as `METHOD key`.
import { r2 } from '../../../../scripts/source-store.mjs'

export const STORE_ENV = { STUB_SOURCES_ACCOUNT_ID: 'acct', STUB_SOURCES_ACCESS_KEY_ID: 'key-id', STUB_SOURCES_SECRET_ACCESS_KEY: 'secret' }
const BASE = 'https://acct.r2.cloudflarestorage.com/stub-sources/'

export const fakeBucket = ({ fail = (_method: string, _key: string): boolean => false } = {}) => {
  const objects = new Map<string, Buffer>()
  const log: string[] = []
  const send = async (request: Request) => {
    if (!request.url.startsWith(BASE)) throw new Error(`the fake bucket has no ${request.url}`)
    const key = decodeURIComponent(request.url.slice(BASE.length))
    log.push(`${request.method} ${key}`)
    if (!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=key-id/')) return new Response('', { status: 403 })
    if (fail(request.method, key)) return new Response('', { status: 500 })
    if (request.method === 'GET') return objects.has(key) ? new Response(new Uint8Array(objects.get(key)!)) : new Response('', { status: 404 })
    if (request.method === 'PUT') objects.set(key, Buffer.from(await request.arrayBuffer()))
    if (request.method === 'DELETE') objects.delete(key)
    return new Response(null, { status: 200 })
  }
  return { objects, log, client: r2(STORE_ENV, send)! }
}
