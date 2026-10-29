// A fake R2 bucket behind R2's S3 API, for the source store's real client (scripts/source-store.mjs): it answers
// only requests signed with the test's access key, and records each one as `METHOD key`, a list as `LIST prefix`.
// A list answers at most `page` keys, as R2 may answer fewer than asked, and goes on from its continuation token.
import { r2 } from '../../../../scripts/source-store.mjs'

export const STORE_ENV = { STUB_SOURCES_ACCOUNT_ID: 'acct', STUB_SOURCES_ACCESS_KEY_ID: 'key-id', STUB_SOURCES_SECRET_ACCESS_KEY: 'secret' }
const BUCKET = 'https://acct.r2.cloudflarestorage.com/stub-sources'

export const fakeBucket = ({ fail = (_method: string, _key: string): boolean => false, page = Infinity } = {}) => {
  const objects = new Map<string, Buffer>()
  const log: string[] = []
  const send = async (request: Request) => {
    const url = new URL(request.url)
    const listing = url.pathname === '/stub-sources' && url.searchParams.get('list-type') === '2'
    if (!request.url.startsWith(`${BUCKET}/`) && !listing) throw new Error(`the fake bucket has no ${request.url}`)
    const key = listing ? url.searchParams.get('prefix')! : decodeURIComponent(request.url.slice(BUCKET.length + 1))
    const method = listing ? 'LIST' : request.method
    log.push(`${method} ${key}`)
    if (!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=key-id/')) return new Response('', { status: 403 })
    if (fail(method, key)) return new Response('', { status: 500 })
    if (listing) {
      const token = url.searchParams.get('continuation-token')
      const after = token === null ? '' : Buffer.from(token, 'base64').toString('utf8')
      const keys = [...objects.keys()].filter(name => name.startsWith(key) && name > after).sort()
      const max = Number(url.searchParams.get('max-keys') ?? 1000)
      const shown = keys.slice(0, Math.min(max, page))
      const contents = shown.map(name => `<Contents><Key>${name}</Key><Size>${objects.get(name)!.length}</Size></Contents>`).join('')
      const next = keys.length > shown.length ? `<NextContinuationToken>${Buffer.from(shown.at(-1)!).toString('base64')}</NextContinuationToken>` : ''
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>stub-sources</Name><Prefix>${key}</Prefix><KeyCount>${shown.length}</KeyCount><MaxKeys>${max}</MaxKeys><IsTruncated>${keys.length > shown.length}</IsTruncated>${contents}${next}</ListBucketResult>`)
    }
    if (request.method === 'GET') return objects.has(key) ? new Response(new Uint8Array(objects.get(key)!)) : new Response('', { status: 404 })
    if (request.method === 'PUT') objects.set(key, Buffer.from(await request.arrayBuffer()))
    if (request.method === 'DELETE') objects.delete(key)
    return new Response(null, { status: 200 })
  }
  return { objects, log, client: r2(STORE_ENV, send)! }
}
