// What is happening at the TOP of the call, made available to every source at the bottom of it.
//
// A source is handed `media(input: { uri })` and cannot tell whether a person is looking at that one
// media or whether it is one row of a listing that will never be read. So it does the same work either
// way, and the expensive answer is right in one case and wasted in the other. justwatch's search is
// the live instance: `mediaPage` maps every result through `normalizeMedia`, which reaches
// `buildOffersAsHandles`, which calls into Crunchyroll once per film result to turn a /watch/ url into
// a series id (justwatch/extractor.ts:305). Nothing on a search results page needs that id.
//
// This module is the registry and the wire format. It deliberately imports NOTHING from the worker or
// the store, so it stays importable under vitest: `worker/extractor.ts` is not, because it imports
// `Client` from urql and through it react.
//
// WHY IT RIDES IN THE VARIABLES, which looks like the clumsiest of the three options and is the only
// one that works. Two channels were measured on this machine and both are unusable:
//
//   a REQUEST HEADER throws. Header values are ByteStrings, and the context has to identify the root,
//   which for a search means user text: `new Request(url, { headers: { x: '{"search":"進撃の巨人"}' } })`
//   raises `Cannot convert argument to a ByteString because the character at index 11 has a value of 3`.
//
//   urql's OPERATION CONTEXT does not vary the operation key. `createRequest` keys on document plus
//   variables only, so two concurrent roots with the same query and variables collapse onto one
//   operation and the first one's context is the one every subscriber gets. Measured: identical
//   variables give an identical key, one extra variable changes it.
//
// So the token below is load bearing twice over. It is the join key into this registry, AND it is a
// variable, which is what stops two roots sharing one context.

/** What the app was asked for, which is the fact no source can derive from anything it holds. */
export const rootOperationEnum = ['MEDIA', 'MEDIA_PAGE', 'SIMILAR_MEDIA'] as const
export type RootOperation = typeof rootOperationEnum[number]

/**
 * The context as it travels: plain scalars, because it crosses a MessagePort to plugin sources as
 * ordinary coerced GraphQL arguments.
 */
export type RequestContext = {
  /**
   * Minted here, per hop, and the ONLY field read back off the wire. Everything else is regenerated
   * from this registry at each source's boundary, so a plugin that rewrites the rest changes nothing.
   */
  token: string
  /** Stable for the whole call tree, so a source can memoize per root rather than per hop. */
  rootId: string
  operation: RootOperation
  /** The origins already on the stack, nearest last. A source seeing itself here is in a cycle. */
  chain: string[]
}

/** What a source is expected to do, derived here so the sources do not each re-derive it. */
export type RequestPolicy = {
  /**
   * Whether an answer is worth a cross-source request. False on a listing, where the expensive id is
   * not read by anything on screen, and true on a detail view, which is what the id is for.
   */
  crossSource: boolean
}

const POLICY: Record<RootOperation, RequestPolicy> = {
  MEDIA: { crossSource: true },
  MEDIA_PAGE: { crossSource: false },
  SIMILAR_MEDIA: { crossSource: true },
}

/**
 * The fallback for a hop that arrived with no context, which must be TODAY'S BEHAVIOUR.
 *
 * Failing open is the deliberate choice for the policy and it is why `misses` exists next to it. A
 * context that stopped arriving would otherwise be indistinguishable from one that is working, since
 * every source would simply keep fetching exactly as it does now, with the whole suite green. The
 * counter is the observable that tells those two apart, and `request-context.test.ts` asserts it moves.
 */
export const UNKNOWN_POLICY: RequestPolicy = { crossSource: true }

let misses = 0
export const contextMisses = () => misses
export const resetContextMisses = () => { misses = 0 }

const hops = new Map<string, RequestContext>()
let counter = 0

/**
 * Open a root and get the context for its first hop. The caller must `closeRoot` when the request
 * ends, or the registry grows for the life of the session.
 */
export const openRoot = (operation: RootOperation): RequestContext => {
  const rootId = `r${++counter}`
  return mint({ rootId, operation, chain: [] })
}

/** A hop made BY a source, carrying the chain forward so a cycle is visible. */
export const descend = (parent: RequestContext, callerOrigin: string): RequestContext =>
  mint({ rootId: parent.rootId, operation: parent.operation, chain: [...parent.chain, callerOrigin] })

const mint = ({ rootId, operation, chain }: Omit<RequestContext, 'token'>): RequestContext => {
  const context: RequestContext = { token: `t${++counter}`, rootId, operation, chain }
  hops.set(context.token, context)
  return context
}

/**
 * The authoritative context for a token, or undefined for one this worker never minted.
 *
 * Undefined is the answer for a forged token AND for a hop whose root has been closed, and the two are
 * deliberately the same: neither is a request this worker is still serving.
 */
export const contextOf = (token: unknown): RequestContext | undefined =>
  typeof token === 'string' ? hops.get(token) : undefined

/** Drop every hop of a root. Called when the app request ends. */
export const closeRoot = (rootId: string) => {
  for (const [token, context] of hops) if (context.rootId === rootId) hops.delete(token)
}

/**
 * Read the context off an incoming `input`, counting the ones that did not arrive.
 *
 * REGENERATED FROM THE REGISTRY, never trusted as sent. The only thing taken off the wire is the
 * token, so a source or a plugin that rewrites `operation` or `chain` is describing a hop this worker
 * already has its own record of.
 */
export const readContext = (input: unknown): RequestContext | undefined => {
  const token = (input as { context?: { token?: unknown } } | null | undefined)?.context?.token
  const context = contextOf(token)
  if (!context) misses++
  return context
}

/** What a source should do for this hop. An absent context means today's behaviour, and is counted. */
export const policyFor = (input: unknown): RequestPolicy => {
  const context = readContext(input)
  return context ? POLICY[context.operation] : UNKNOWN_POLICY
}

/** Put a freshly minted hop's context onto the variables of an outgoing source subscription. */
export const stamp = <T extends Record<string, unknown>>(variables: T, context: RequestContext): T => {
  const input = variables.input
  if (input == null || typeof input !== 'object') return variables
  return { ...variables, input: { ...input as object, context } }
}

export const registrySize = () => hops.size

/**
 * Empty the registry. TESTS ONLY, and for one reason: it is a module singleton, so a test asserting on
 * `registrySize` otherwise reads whatever the tests before it left behind and fails for reasons that
 * are not in it. Never called by the app, where dropping live hops would refuse every source in flight.
 */
export const resetRegistry = () => { hops.clear() }
