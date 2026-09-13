// FIRST, and it has to stay first: ../components/dom installs the document @emotion/react reads at
// module scope. See that file for what happens when it does not.
import { button, mount, unmount } from '../components/dom'

import type { TraceBundle } from '../../../src/router/debug/trace'
import type { WarmProgress } from '../../../src/router/debug/warm'

import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import Debug from '../../../src/router/debug'
import { TraceEdge } from '../../../src/router/debug/graph'
import { traceFlowGraph } from '../../../src/router/debug/flow'

/**
 * `TraceEdge` handed the props xyflow would hand it, which is the only way to render ONE edge here:
 * a whole graph draws none, because linkedom has no box model to measure (see xyflow-env.test.tsx).
 * The geometry is a straight 100px to the right, so the only thing that varies between calls is what
 * the case is actually about.
 */
const edgeProps = (data: Record<string, unknown>) => ({
  id: 'e', source: 'a', target: 'b', sourceX: 0, sourceY: 0, targetX: 100, targetY: 0, data,
} as unknown as Parameters<typeof TraceEdge>[0])
import TraceLink from '../../../src/router/debug/link'
import { carriedSearch, traceUriFromSearch } from '../../../src/router/debug/trace'

// Driven against a HAND BUILT bundle, never a live worker. The page's whole job is to render what the
// graph says without softening it, and the cases worth pinning are exactly the ones a real graph will
// not produce on demand: a refused link beside an active one between the same pair, a placeholder
// member, a null confidence, an evidence blob that is not JSON, and each of the four reasons a uri
// reaches no cluster.
//
// The rig's control is the last describe: a load that rejects has to reach the page as an error. A rig
// that cannot see that could report every assertion below while rendering nothing at all.

/** A bundle that exercises every part of the page. Fresh per test, so no test can affect another. */
const bundle = (): TraceBundle => ({
  asked: 'ag:(mal:39535,anilist:101280)',
  resolved: {
    clusterId: 'cl:7f3a', aggUri: 'ag:(mal:39535,anilist:101280)', scope: 'anime', kind: null,
    otherClusters: [],
  },
  members: [
    {
      uri: 'mal:39535', origin: 'mal', owned: true, scope: 'anime', title: 'Mob Psycho 100 II',
      episodeCount: 13, countKind: 'episodes', startDate: '2019-01-07', via: 'member',
    },
    {
      uri: 'anilist:101280', origin: 'anilist', owned: true, scope: 'anime', title: null,
      episodeCount: null, countKind: null, startDate: null, via: 'member',
    },
    {
      uri: 'tmdb:2000', origin: 'tmdb', owned: false, scope: 'anime', title: 'Mob Psycho 100',
      episodeCount: 12, countKind: 'episodes', startDate: '2019-01-07', via: 'placeholder',
    },
    // A MEMBER NO SOURCE HAS DESCRIBED, which is the row the fourth node kind was invented for:
    // `plugin:aggregate` clusters an unowned row whenever one origin fails to answer while others
    // claim it, so `owned: false` and `via: 'member'` is an ordinary state and not a corner.
    {
      uri: 'anidb:14758', origin: 'anidb', owned: false, scope: null, title: null,
      episodeCount: null, countKind: null, startDate: null, via: 'member',
    },
  ],
  claims: [
    { fromUri: 'mal:39535', toUri: 'anilist:101280', kind: 'same-as', claimer: 'mal', provenance: 'answer', answerSeq: 7, targetScope: 'anime', key: 'C1' },
    { fromUri: 'anilist:101280', toUri: 'mal:39535', kind: 'same-as', claimer: 'anilist', provenance: 'answer', answerSeq: 8, targetScope: null, key: 'C2' },
    { fromUri: 'netflix:81000', toUri: 'mal:39535', kind: 'same-as', claimer: 'netflix', provenance: 'answer', answerSeq: 9, targetScope: null, key: 'C3' },
  ],
  links: [
    {
      fromUri: 'mal:39535', toUri: 'anilist:101280', kind: 'same-as', status: 'active', by: 'rule-1',
      reason: 'title-and-year', confidence: 0.92, version: 2,
      evidence: '{"titleScore":0.97,"yearDelta":0}', supports: ['C1', 'C2'],
      gates: '{"minScore":0.9}', key: 'L1',
    },
    {
      fromUri: 'mal:39535', toUri: 'netflix:81000', kind: 'same-as', status: 'refused', by: 'rule-3',
      reason: 'episode-count-mismatch', confidence: 0.41, version: null,
      evidence: '{"expected":13,"seen":12}',
      // one key the bundle does not carry, and one string that could never be a key: two different
      // findings, one about the bundle and one about whatever wrote the column
      supports: ['C3', '0'.repeat(64), 'mob psycho 100'], gates: null, key: 'L2',
    },
    {
      fromUri: 'mal:39535', toUri: 'anilist:101280', kind: 'same-as', status: 'refused', by: 'rule-2',
      reason: 'sequence-gap', confidence: null, version: null, evidence: 'not json at all',
      supports: [], gates: null, key: 'L3',
    },
  ],
  attachments: [
    {
      runUri: 'mal:39535', containerUri: 'ag:(mal:39535,anilist:101280)', via: 'season', by: 'rule-5',
      evidence: null, supports: ['L1'],
    },
  ],
  episodes: [
    {
      slotId: 's1', number: 1, title: 'Mob Psycho 100 II, episode 1',
      fills: [
        { episodeUri: 'mal:39535/1', origin: 'mal', via: 'member', by: 'rule-0', number: 1, supports: ['HE1'] },
        { episodeUri: 'anilist:101280/1', origin: 'anilist', via: 'aligned', by: 'rule-4', number: 1, supports: ['EL1'] },
      ],
    },
    { slotId: 's2', number: null, title: null, fills: [] },
  ],
  episodeLinks: [
    {
      fromUri: 'mal:39535/1', toUri: 'anilist:101280/1', kind: 'same-episode', status: 'active',
      by: 'rule-4', reason: 'sequence-pair', fromNumber: 1, toNumber: 1,
      evidence: '{"pairedBy":"sequence"}', supports: ['EC1'], key: 'EL1',
    },
    {
      fromUri: 'mal:39535/2', toUri: 'netflix:81000/2', kind: 'same-episode', status: 'refused',
      by: 'rule-4', reason: 'specials-list-closed', fromNumber: 2, toNumber: null,
      evidence: null, supports: [], key: 'EL2',
    },
  ],
  episodeClaims: [
    { fromUri: 'mal:39535/1', toUri: 'anilist:101280/1', kind: 'same-episode', claimer: 'mal', provenance: 'answer', answerSeq: 11, key: 'EC1' },
  ],
  // the source's own episode list, which is what a `via: member` fill descends to
  episodeSources: [
    { fromUri: 'mal:39535', toUri: 'mal:39535/1', claimer: 'mal', answerSeq: 11, key: 'HE1' },
  ],
  runLength: { value: 13, from: 'mal:39535', tier: 'witnessed', witnesses: 2 },
  anomalies: [{ rule: 'count-disagreement', detail: 'mal says 13, tmdb says 12' }],
  asks: [
    { seq: 3, origin: 'netflix', outcome: 'declined', reason: 'no key configured', at: null },
    { seq: 4, origin: 'mal', outcome: 'answered', reason: null, at: null },
    // `Ask.reason` legitimately carries the TOKEN "null" (a source's own refusal reason), which is
    // not the same fact as an unwritten column and must not read the same
    { seq: 5, origin: 'tmdb', outcome: 'refused', reason: 'null', at: null },
  ],
  answers: [
    { seq: 7, uri: 'mal:39535', origin: 'mal', operation: 'getMedia', bytes: 4_210 },
    { seq: 8, uri: 'anilist:101280', origin: 'anilist', operation: 'getMedia', bytes: 9_004 },
    { seq: 9, uri: 'netflix:81000', origin: 'netflix', operation: 'getMedia', bytes: 120 },
    { seq: 11, uri: 'mal:39535', origin: 'mal', operation: 'getEpisodes', bytes: 800 },
  ],
  counts: { media: 4, claims: 3, links: 3 },
  cost: { statements: 14, ms: 62 },
})

/**
 * Flush until a condition holds, or give up.
 *
 * The warm is a CHAIN of deferred work: the warm settles in a microtask, its `.then` queues a
 * re-render, that render's effect starts a second trace, and that trace settles in a microtask of its
 * own. A fixed number of `act` flushes is a guess at how preact schedules each step, and a guess that
 * is one short reports "no second trace" for a page that does trace again.
 *
 * THE DELAY IS LOAD BEARING and 0 does not work, which cost a while to find: a state update that
 * lands after an `act` has returned queues its effects through preact's own post-paint path, and
 * outside a browser that path is a `setTimeout(..., 100)`. Twenty flushes of zero milliseconds never
 * reach it, so the page re-rendered with the new nonce and no effect ever ran.
 */
const settled = async (until: () => boolean, attempts = 40) => {
  for (let attempt = 0; attempt < attempts && !until(); attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
  }
}

/** The default: no warm at all, so every case above measures one load and nothing else. */
const noWarm = async () => ({ payloads: 0, uri: null, handles: 0, episodes: 0 })

const hosts: HTMLElement[] = []

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

/**
 * Renders the page for one uri and waits for its load to settle.
 *
 * `traced` may be a LIST, in which case each load answers the next entry and the last one repeats:
 * that is how the warm is driven, since the whole point of it is that the second trace of one uri
 * says something the first could not.
 */
const page = async (
  traced: TraceBundle | Error | (TraceBundle | Error)[],
  { uri = 'ag:(mal:39535,anilist:101280)', loadAnswerBytes = async () => '', warm }: {
    uri?: string
    loadAnswerBytes?: (seq: number) => Promise<unknown>
    warm?: (uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => Promise<WarmProgress>
  } = {},
) => {
  const queue = Array.isArray(traced) ? [...traced] : [traced]
  const load = vi.fn(async (_uri: string) => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    if (next instanceof Error) throw next
    return next
  })
  const { hook, searchHook } = memoryLocation({
    path: '/debug/trace',
    searchPath: uri ? `uri=${encodeURIComponent(uri)}` : '',
  })
  let host!: HTMLElement
  await act(async () => {
    host = mount(
      <Router hook={hook} searchHook={searchHook}>
        <Debug load={load} loadAnswerBytes={loadAnswerBytes} warm={warm ?? noWarm}/>
      </Router>,
    )
  })
  // TWICE, and the second one is not superstition: a REJECTED load settles one microtask later than a
  // resolved one, because the rejection has to pass the `.then` before it reaches the `.catch`. With a
  // single flush the failure case rendered nothing and the control below passed by asserting on an
  // empty page.
  await act(async () => {})
  hosts.push(host)
  return { host, load }
}

const text = (host: HTMLElement, selector: string) => host.querySelector(selector)?.textContent ?? ''

describe('the uri it traces', () => {
  test('comes from the query string, so a link can be pasted into a bug report', async () => {
    const { host, load } = await page(bundle(), { uri: 'ag:(mal:39535,anilist:101280)' })

    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]![0], 'the uri is read back undecoded from ?uri=').toBe('ag:(mal:39535,anilist:101280)')
    expect(host.querySelector('input')?.getAttribute('value')).toBe('ag:(mal:39535,anilist:101280)')
  })

  test('is not asked for at all when the url names none', async () => {
    const { host, load } = await page(bundle(), { uri: '' })

    expect(load).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Give it a uri')
  })

  test('is echoed with the cluster it resolved to', async () => {
    const { host } = await page(bundle())

    expect(text(host, '[data-resolved]')).toContain('cl:7f3a')
    expect(text(host, '[data-resolved]')).toContain('anime')
    // the cluster's kind is null in this bundle, and null is what it has to say
    expect(text(host, '[data-resolved]')).toContain('null')
  })
})

describe('a link the graph refused', () => {
  // ASKED OF `traceFlowGraph` AND OF THE EDGE COMPONENT, not of the rendered graph, and that is a
  // property of the harness rather than a softening: `@xyflow/react` derives every edge from measured
  // handle boxes and linkedom has no box model, so a whole graph renders its nodes and NO edges here.
  // Measured both ways 2026-09-13, and pinned in tests/unit/components/xyflow-env.test.tsx. One edge
  // handed its props renders fine, which is what the second half below uses.
  // MUTATED: make `traceFlowGraph` read `isActive` the other way round and the first half fails; drop
  // the `cross-mark` block from `TraceEdge` and the second half does.
  test('is drawn, and drawn as refused rather than left out', async () => {
    const { edges } = traceFlowGraph(bundle())

    const refused = edges.find(edge => edge.id === 'L2')
    expect(refused, 'the refused link has an edge of its own').toBeTruthy()
    expect(refused!.data!.status).toBe('refused')
    expect(refused!.data!.active, 'and is not drawn as an active one').toBe(false)
    expect(edges.find(edge => edge.id === 'L1')!.data!.active).toBe(true)

    // the cross is the part that reads without any text at all
    const drawn = (active: boolean) => {
      const host = mount(
        <svg>
          <TraceEdge
            {...edgeProps({ spread: 0, active, status: active ? 'active' : 'refused', label: 'SAME_AS', tooltip: 't' })}
          />
        </svg>
      )
      const result = {
        edgeClass: host.querySelector('.edge')?.getAttribute('class') ?? '',
        cross: Boolean(host.querySelector('.cross-mark')),
      }
      unmount(host)
      return result
    }

    expect(drawn(false).edgeClass).toContain('refused')
    expect(drawn(false).edgeClass).not.toContain('active')
    expect(drawn(false).cross, 'a refused edge carries a cross').toBe(true)
    expect(drawn(true).edgeClass).toContain('active')
    expect(drawn(true).cross, 'an active edge carries none').toBe(false)
  })

  test('is in the links table as refused, with the rule that refused it', async () => {
    const { host } = await page(bundle())

    const row = host.querySelector('[data-link="L2"]')!
    expect(row.getAttribute('data-status')).toBe('refused')
    expect(row.querySelector('.status.refused')?.textContent).toBe('refused')
    expect(row.textContent).toContain('rule-3')
    expect(row.textContent).toContain('episode-count-mismatch')
  })

  test('drags the uri it names into the picture, so the refusal has something to point at', async () => {
    const { host } = await page(bundle())

    const stranger = host.querySelector('[data-node="netflix:81000"]')
    expect(stranger, 'netflix:81000 is in no member list and is still drawn').toBeTruthy()
    expect(stranger!.getAttribute('data-kind')).toBe('named')
  })

  // MUTATED: return a constant 0 from `edgeLanes`' lane index and the two spreads collapse to one
  // number, which is the bug this case exists for: two rows between one pair drawn on top of each
  // other, where a reader sees one link and cannot tell which of the two they are looking at.
  test('is not merged with the active link between the same pair', async () => {
    const { edges } = traceFlowGraph(bundle())

    // L1 active and L3 refused join the same two uris. Two rows, two edges, two lanes.
    const one = edges.find(edge => edge.id === 'L1')
    const three = edges.find(edge => edge.id === 'L3')
    expect([Boolean(one), Boolean(three)]).toEqual([true, true])
    expect(one!.source).toBe(three!.source)
    expect(one!.target).toBe(three!.target)
    expect(one!.data!.spread, 'the two bow apart rather than overlapping').not.toBe(three!.data!.spread)

    // and the spread really is what moves the curve, which is the half a lane number alone cannot say
    const path = (spread: number) => {
      const host = mount(
        <svg>
          <TraceEdge
            {...edgeProps({ spread, active: true, status: 'active', label: 'SAME_AS', tooltip: 't' })}
          />
        </svg>
      )
      const d = host.querySelector('.edge')?.getAttribute('d') ?? ''
      unmount(host)
      return d
    }
    expect(new Set([path(one!.data!.spread), path(three!.data!.spread)]).size, 'two curves').toBe(2)
  })
})

describe('a placeholder member', () => {
  test('is marked apart from an owned one', async () => {
    const { host } = await page(bundle())

    expect(host.querySelector('[data-node="tmdb:2000"]')?.getAttribute('data-kind')).toBe('placeholder')
    expect(host.querySelector('[data-node="mal:39535"]')?.getAttribute('data-kind')).toBe('owned')
    expect(host.querySelector('[data-node="anilist:101280"]')?.getAttribute('data-kind')).toBe('owned')
  })

  // Mutation: build `traceNodes`'s `seen` set after mapping the members straight through (the shape
  // it had until 2026-09-13). The uri comes back as TWO nodes at one position whose meta lines
  // overstrike, and the last one painted decides whether a reader sees a member or a non-member.
  test('that the cluster also holds is ONE box, the member', async () => {
    const twice = bundle()
    // what a worker that had not filtered its placeholder list sends, and what `plugin:aggregate`
    // produces whenever one origin fails to answer while others claim it (20.7% of clusters on a
    // recorded page, 2026-09-13)
    twice.members = [
      ...twice.members,
      {
        uri: 'mal:39535', origin: 'mal', owned: false, scope: null, title: null, episodeCount: null,
        countKind: null, startDate: null, via: 'placeholder',
      },
    ]
    const { host } = await page(twice)

    const boxes = host.querySelectorAll('[data-node="mal:39535"]')
    expect(boxes.length, 'one uri, one box').toBe(1)
    expect(boxes[0]!.getAttribute('data-kind'), 'and the membership is what survives').toBe('owned')
    expect(boxes[0]!.textContent).toContain('owned member')
    expect(boxes[0]!.textContent, 'the meta line is one line, not two overstruck').not.toContain('claimed')
  })

  // The app's own header is FIXED and this box is taller than any viewport, so it is always scrolled
  // and the top strip of it is always behind the chrome: at 1440x1000 the logo covered the legend's
  // first two lines permanently. Read off the source, because jsdom lays nothing out and a legend
  // that is merely present proves nothing about where it is. Mutation: put `top` back.
  test('keeps the legend out of the strip the fixed header covers', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/router/debug/graph.tsx', import.meta.url)),
      'utf-8',
    )
    const legend = source.slice(source.indexOf('.legend {'), source.indexOf('text {'))
    expect(legend, 'the legend sits on the bottom edge').toContain('bottom: 0.8rem')
    expect(legend, 'and not under the header').not.toContain('top: 0.8rem')
    expect(legend, 'the control: this is the legend rule and not another').toContain('position: absolute')
  })

  // Mutation: answer `'unowned'` from `memberKind` for an unowned member (the fourth kind this page
  // shipped with). A box style appears that the legend has no entry for, which is how it went
  // unnoticed: it renders, it looks deliberate, and it means nothing.
  test('every node kind on screen has a legend entry', async () => {
    const { host } = await page(bundle())

    const kinds = [...new Set(
      [...host.querySelectorAll('[data-node]')].map(node => node.getAttribute('data-kind') ?? ''),
    )]
    expect(kinds.sort(), 'the three the bundle can produce').toEqual(['named', 'owned', 'placeholder'])

    const legend = [...host.querySelectorAll('.legend div')].map(line => line.textContent ?? '')
    expect(legend.length, 'the control: the legend is rendered at all').toBeGreaterThan(2)
    for (const kind of kinds) {
      expect(legend.some(line => line.includes(kind)), `${kind} is in the legend: ${legend.join(' | ')}`)
        .toBe(true)
    }
  })
})

describe('a cold graph, which is what a pasted link always finds', () => {
  const empty = (): TraceBundle => ({
    ...bundle(), resolved: null, reason: 'graph-empty', members: [], links: [], claims: [],
  })

  // Mutation: delete the warm effect from index.tsx (or the `warm(asked, ...)` call in it). The page
  // reports `graph-empty` and stops there, which is every pasted trace link before 2026-09-13.
  test('is warmed by asking the sources, and traced again when they answer', async () => {
    const warm = vi.fn(async (_uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => {
      options.onProgress?.({ payloads: 2, uri: 'ag:(mal:39535,anilist:101280)', handles: 4, episodes: 13 })
      return { payloads: 2, uri: 'ag:(mal:39535,anilist:101280)', handles: 4, episodes: 13 }
    })
    const { host, load } = await page([empty(), bundle()], { warm })
    await settled(() => load.mock.calls.length > 1)

    expect(warm, 'the uri on screen is the uri asked about').toHaveBeenCalledWith(
      'ag:(mal:39535,anilist:101280)',
      expect.anything(),
    )
    expect(load.mock.calls.length, 'traced again once the sources answered').toBeGreaterThan(1)
    expect(host.querySelector('[data-resolved]'), 'and the second trace resolved').toBeTruthy()
    expect(text(host, '[data-resolved]')).toContain('cl:7f3a')
    expect(text(host, '[data-warming]'), 'with the fan-out reported while it ran')
      .toContain('4 handle(s)')
  })

  test('says so honestly while the sources are still answering', async () => {
    let report: ((progress: WarmProgress) => void) | undefined
    const warm = vi.fn(async (_uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => {
      report = options.onProgress
      // never settles inside this test: the page has to be honest about waiting, not only about done
      return new Promise<WarmProgress>(() => {})
    })
    const { host } = await page(empty(), { warm })
    await act(async () => { report?.({ payloads: 1, uri: null, handles: 0, episodes: 0 }) })

    expect(host.querySelector('[data-warming]')?.getAttribute('data-warming')).toBe('asking')
    expect(text(host, '[data-warming]')).toContain('asking the sources about ag:(mal:39535,anilist:101280)')
    expect(text(host, '[data-unresolved] .why'), 'and the reason is still shown, not replaced by hope')
      .toContain('A graph is built inside one tab')
  })

  // Mutation: answer one line for both settled cases (drop the `payloads === 0` branch). A fan-out
  // that nothing answered then reads as a finished one that "produced what is below", where below is
  // an empty panel: the reader is left to guess whether to keep waiting.
  test('stops waiting and says nothing answered, rather than asking forever', async () => {
    const warm = vi.fn(async () => ({ payloads: 0, uri: null, handles: 0, episodes: 0 }))
    const { host } = await page([{ ...bundle(), resolved: null, reason: 'no-row' }], { warm })
    await settled(() => host.querySelector('[data-warming]')?.getAttribute('data-warming') === 'done')

    const line = text(host, '[data-warming]')
    expect(host.querySelector('[data-warming]')?.getAttribute('data-answered')).toBe('0')
    expect(line, 'it says what happened').toContain('nothing answered about ag:(mal:39535,anilist:101280)')
    expect(line, 'and that the waiting is over').toContain('Nothing is still loading')
    expect(line, 'and it does not claim a result it never got').not.toContain('What is below is what that produced')

    // the control: the same page with answers says the other thing
    const answered = vi.fn(async () => ({ payloads: 3, uri: 'ag:(mal:39535)', handles: 2, episodes: 9 }))
    const { host: filled } = await page([{ ...bundle(), resolved: null, reason: 'no-row' }], { warm: answered })
    await settled(() => filled.querySelector('[data-warming]')?.getAttribute('data-warming') === 'done')
    expect(text(filled, '[data-warming]')).toContain('3 answer(s)')
    expect(text(filled, '[data-warming]')).not.toContain('nothing answered')
  })

  test('says how long a cold graph takes while it is waiting, not just that it is waiting', async () => {
    let report: ((progress: WarmProgress) => void) | undefined
    const warm = vi.fn(async (_uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => {
      report = options.onProgress
      return new Promise<WarmProgress>(() => {})
    })
    const { host } = await page(empty(), { warm })
    await act(async () => { report?.({ payloads: 0, uri: null, handles: 0, episodes: 0 }) })

    const line = text(host, '[data-warming]')
    expect(line, 'how many sources are being asked').toContain('24 sources')
    expect(line, 'and that it is tens of seconds, not milliseconds').toContain('tens of seconds')
    expect(line, 'and that it ends by itself').toContain('stops waiting on its own')
  })

  // Mutation: put `resolved` back in the warm effect's dependency list (and in its guard), the shape
  // it had first. The trace that resolves cancels the warm that produced it, so everything the
  // sources answer afterwards is missing from a panel that looks complete: the similar consumer's
  // asks arrive seconds after a run page settles, and a whole section of this page was empty.
  test('keeps re-tracing while the sources answer, so a row that arrives late is still drawn', async () => {
    let report: ((progress: WarmProgress) => void) | undefined
    const warm = vi.fn(async (_uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => {
      report = options.onProgress
      return new Promise<WarmProgress>(() => {})
    })
    const early = { ...bundle(), asks: [] }
    const { host, load } = await page([empty(), early, bundle()], { warm })

    // the first source answers: the debounced re-trace finds a cluster, with no ask logged yet
    await act(async () => { report?.({ payloads: 1, uri: null, handles: 1, episodes: 0 }) })
    await settled(() => Boolean(host.querySelector('[data-resolved]')))
    expect(host.querySelector('[data-resolved]'), 'the first trace resolved').toBeTruthy()
    expect(host.querySelector('[data-asks]'), 'and it carried no asks yet').toBeFalsy()

    // the sources keep answering, and the consumer records its ask AFTER the cluster exists
    await act(async () => { report?.({ payloads: 9, uri: 'ag:(mal:39535)', handles: 6, episodes: 13 }) })
    await settled(() => Boolean(host.querySelector('[data-ask="netflix"]')))

    expect(load.mock.calls.length, 'the panel traced again on its own').toBeGreaterThan(2)
    expect(text(host, '[data-ask="netflix"]'), 'so the late ask is on screen').toContain('declined')
  })

  // Mutation: drop the `<a data-reload-graph>` block. The message names a flag and the reader is left
  // to edit the url by hand, which is how the loop stayed invisible: the advice pointed at the state
  // it produced.
  test('is NOT warmed when the engine is off, and the advice is a link that can be followed', async () => {
    const warm = vi.fn(noWarm)
    const { host } = await page({ ...bundle(), resolved: null, reason: 'not-enabled' }, { warm })
    await act(async () => {})

    expect(warm, 'a warm cannot help: the flag is read once per worker').not.toHaveBeenCalled()
    const reload = host.querySelector('[data-reload-graph]')!
    expect(reload, 'so the page offers the reload instead of describing it').toBeTruthy()
    const href = reload.getAttribute('href') ?? ''
    expect(href, 'it turns the engine on').toContain('graph=1')
    expect(traceUriFromSearch(new URL(href, 'http://d/').search), 'and keeps the uri, so the reload lands back on this trace')
      .toBe('ag:(mal:39535,anilist:101280)')
    // SINCE THE 2026-09-13 FLIP the graph is the default, so the way back onto it is to DROP a flag
    // rather than add one. This asserted `store=graph` the day before, which now sets a value nothing
    // reads: only the exact `store=legacy` takes a page off the graph (`readsLegacyStore`).
    // MUTATED: have `graphStoreHref` set `store` to 'graph' instead of deleting it, the shape it had
    // before, and this goes red on a link that would silently change nothing.
    const back = host.querySelector('[data-reload-store]')?.getAttribute('href') ?? ''
    expect(back, 'the link back onto the graph carries no store flag at all').not.toContain('store=')
    expect(traceUriFromSearch(new URL(back, 'http://d/').search), 'and it keeps the uri too')
      .toBe('ag:(mal:39535,anilist:101280)')
  })
})

describe('the inspector', () => {
  test('parses an evidence JSON string into fields rather than dumping it', async () => {
    const { host } = await page(bundle())

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-link="L1"] button')!.click() })

    const evidence = host.querySelector('[data-inspector] [data-blob="evidence"]')!
    expect(evidence.querySelector('[data-field="titleScore"]')?.textContent).toContain('0.97')
    expect(evidence.querySelector('[data-field="yearDelta"]')?.textContent).toContain('0')
    expect(evidence.querySelector('.raw'), 'it parsed, so nothing is shown raw').toBeFalsy()

    const gates = host.querySelector('[data-inspector] [data-blob="gates"]')!
    expect(gates.querySelector('[data-field="minScore"]')?.textContent).toContain('0.9')
  })

  test('says so when an evidence blob is not JSON, instead of reporting it empty', async () => {
    const { host } = await page(bundle())

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-link="L3"] button')!.click() })

    const evidence = host.querySelector('[data-inspector] [data-blob="evidence"]')!
    expect(evidence.querySelector('.raw')?.textContent).toBe('not json at all')
  })

  test('names who wrote the row, the rule that fired, and whether it passed', async () => {
    const { host } = await page(bundle())

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-link="L2"] button')!.click() })

    const panel = host.querySelector('[data-inspector]')!
    expect(text(host, '[data-inspector] [data-fact="written by"]')).toContain('rule-3')
    expect(text(host, '[data-inspector] [data-fact="rule"]')).toContain('episode-count-mismatch')
    expect(panel.querySelector('.status.refused')?.textContent).toBe('refused')
    expect(text(host, '[data-inspector] [data-fact="confidence"]')).toContain('0.41')
  })

  test('follows supports down two levels, to the answer a claim came from', async () => {
    const loadAnswerBytes = vi.fn(async (_seq: number) => '{"data":{"Media":{"id":39535}}}')
    const { host } = await page(bundle(), { loadAnswerBytes })

    // level one: the active link
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-link="L1"] button')!.click() })
    const supports = [...host.querySelectorAll('[data-inspector] .support')]
    expect(supports.length, 'both claim keys are offered').toBe(2)

    // level two: the claim it was derived from
    await act(async () => { button(host.querySelector<HTMLElement>('[data-inspector] .support')!, 'Follow')!.click() })
    expect(text(host, '[data-inspector] [data-fact="claimed by"]')).toContain('mal')
    expect(text(host, '[data-inspector] [data-fact="answer seq"]')).toContain('7')
    expect(text(host, '[data-inspector] [data-fact="operation"]')).toContain('getMedia')
    expect(
      host.querySelector('[data-inspector] .trail button'),
      'the link is still on the trail, so the descent can be walked back up',
    ).toBeTruthy()

    // and the answer's own bytes
    await act(async () => { button(host.querySelector<HTMLElement>('[data-inspector]')!, 'Load answer bytes')!.click() })
    expect(loadAnswerBytes).toHaveBeenCalledWith(7)
    expect(
      text(host, '[data-inspector] [data-answer]'),
      'the bytes are shown as they are stored, not reformatted',
    ).toContain('{"data":{"Media":{"id":39535}}}')
  })

  // Mutation: answer one label from `gapLabel` for both gaps. The two findings collapse into one and
  // a support that is not an edge key at all reads as a hole in the bundle, which sends the reader
  // looking for a row that never existed.
  test('says which KIND of nothing a support resolved to, keeping both', async () => {
    const { host } = await page(bundle())

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-link="L2"] button')!.click() })

    const panel = host.querySelector('[data-inspector]')!
    const missing = panel.querySelector(`[data-gap="missing"]`)!
    expect(missing, 'a 64 hex key the bundle does not carry is still shown').toBeTruthy()
    expect(missing.textContent).toContain('0'.repeat(64))
    expect(missing.querySelector('.unresolved')?.textContent).toBe('not in this bundle')

    // `plugin:title` writes a folded TITLE into `LINK.supports`, where the schema declares edge keys
    const notAKey = panel.querySelector(`[data-gap="not-an-edge-key"]`)!
    expect(notAKey.textContent).toContain('mob psycho 100')
    expect(notAKey.querySelector('.unresolved')?.textContent).toBe('not an edge key')

    // the control: the key that DOES resolve carries a Follow instead of either label
    const resolved = [...panel.querySelectorAll('.support')].find(row => row.textContent?.includes('C3'))!
    expect(resolved.querySelector('.unresolved')).toBeFalsy()
  })

  // Mutation: drop the `episodeSources` loop from `traceIndex`. Every `via: member` fill's descent
  // dead-ends, which is what 56 of 56 fills did on a live page.
  test('follows a member fill down to the source list and its answer', async () => {
    const loadAnswerBytes = vi.fn(async (_seq: number) => '{"episodes":[{"uri":"mal:39535/1"}]}')
    const { host } = await page(bundle(), { loadAnswerBytes })

    const fill = host.querySelector('[data-fill="mal:39535/1"]')!
    expect(fill.querySelector('.missing'), 'nothing about this fill is a hole any more').toBeFalsy()

    await act(async () => { button(fill as HTMLElement, 'Inspect')!.click() })
    expect(text(host, '[data-inspector] [data-fact="listed by"]')).toContain('mal')
    expect(text(host, '[data-inspector] [data-fact="episode"]')).toContain('mal:39535/1')

    await act(async () => { button(host.querySelector<HTMLElement>('[data-inspector]')!, 'Load answer bytes')!.click() })
    expect(loadAnswerBytes).toHaveBeenCalledWith(11)
    expect(text(host, '[data-inspector] [data-answer]')).toContain('"mal:39535/1"')
  })
})

describe('the episode table', () => {
  test('keeps the cluster order and shows every fill with its origin and via', async () => {
    const { host } = await page(bundle())

    const slots = [...host.querySelectorAll('[data-slots] tbody tr')].map(row => row.getAttribute('data-slot'))
    expect(slots).toEqual(['s1', 's2'])

    const first = host.querySelector('[data-slot="s1"]')!
    expect(first.querySelector('[data-fill="mal:39535/1"]')?.textContent).toContain('mal')
    expect(first.querySelector('[data-fill="mal:39535/1"]')?.textContent).toContain('member')
    expect(first.querySelector('[data-fill="anilist:101280/1"]')?.textContent).toContain('aligned')
  })

  test('shows which pair proved an aligned fill, and it is inspectable', async () => {
    const { host } = await page(bundle())

    const fill = host.querySelector('[data-fill="anilist:101280/1"]')!
    expect(fill.querySelector('.proof .pair')?.textContent).toContain('mal:39535/1')
    expect(fill.querySelector('.proof .pair')?.textContent).toContain('anilist:101280/1')

    await act(async () => { button(fill as HTMLElement, 'Inspect')!.click() })
    expect(text(host, '[data-inspector] [data-fact="rule"]')).toContain('sequence-pair')
    expect(text(host, '[data-inspector] [data-fact="from number"]')).toContain('1')
  })

  test('lists a refused episode link as refused', async () => {
    const { host } = await page(bundle())

    const row = host.querySelector('[data-episode-link="EL2"]')!
    expect(row.getAttribute('data-status')).toBe('refused')
    expect(row.querySelector('.status.refused')?.textContent).toBe('refused')
    expect(row.textContent).toContain('specials-list-closed')
  })
})

describe('a value the graph does not carry', () => {
  test('renders as the word null, never as something that looks like data', async () => {
    const { host } = await page(bundle())

    const confidence = host.querySelector('[data-link="L3"] .nothing')
    expect(confidence?.textContent, 'a null confidence says null').toBe('null')
    expect(text(host, '[data-slot="s2"]'), 'a slot with no number and no title says so twice').toContain('null')
    expect(text(host, '[data-ask="mal"]')).toContain('null')
    expect(host.textContent, 'nothing on the page stands in for a null').not.toMatch(/[\u2013\u2014]/)
    expect(
      [...host.querySelectorAll('td')].map(cell => cell.textContent?.trim()),
      'and no cell is a bare hyphen either',
    ).not.toContain('-')
  })

  test('is null in the graph too, where a node carries no title', async () => {
    const { host } = await page(bundle())

    expect(host.querySelector('[data-node="anilist:101280"]')?.textContent).toContain('no title')
  })
})

describe('a uri that reached no cluster', () => {
  const unresolved = (reason: TraceBundle['reason']) => ({ ...bundle(), resolved: null, reason })

  test('says which of the four reasons applies, in its own words', async () => {
    const said: Record<string, string> = {}
    for (const reason of ['not-enabled', 'graph-empty', 'no-row', 'no-cluster'] as const) {
      const { host } = await page(unresolved(reason))
      expect(host.querySelector('[data-unresolved]')?.getAttribute('data-reason')).toBe(reason)
      said[reason] = text(host, '[data-unresolved] .why')
      expect(host.querySelector('[data-resolved]'), 'nothing claims to have resolved').toBeFalsy()
    }

    expect(said['not-enabled'], 'the flag is off, so it says how to turn it on').toContain('?graph')
    expect(said['graph-empty']).toContain('empty')
    expect(said['graph-empty'], 'and says why a cold link finds it so').toContain('one tab')
    // NO MESSAGE ADVISES THE ACTION THAT PRODUCES ANOTHER OF THESE STATES: `not-enabled` used to say
    // "reload with ?graph to warm it", and that reload lands on `graph-empty`
    expect(said['graph-empty'], 'so it does not send the reader back to the flag').not.toContain('?graph')
    expect(said['no-row']).toContain('No media row')
    expect(said['no-cluster']).toContain('no cluster holds it')
    expect(new Set(Object.values(said)).size, 'four reasons, four different messages').toBe(4)
  })

  test('says the bundle carries no reason when it carries none', async () => {
    const { host } = await page({ ...bundle(), resolved: null, reason: undefined })

    expect(text(host, '[data-unresolved] .why')).toContain('no reason')
  })
})

describe('the compact rows a missing source is explained by', () => {
  test('carry the run length, the anomalies and the asks', async () => {
    const { host } = await page(bundle())

    expect(text(host, '[data-run-length]')).toContain('13')
    expect(text(host, '[data-run-length]')).toContain('witnessed')
    expect(text(host, '[data-anomalies]')).toContain('mal says 13, tmdb says 12')
    expect(text(host, '[data-ask="netflix"]'), 'a declined ask is half the answer to why one is missing')
      .toContain('declined')
    expect(text(host, '[data-ask="netflix"]')).toContain('no key configured')
    expect(text(host, '[data-counts]'), 'the counts prove the graph is not empty').toContain('media 4')
  })

  // Mutation: render `<Value value={ask.reason}/>` for every ask. The TOKEN "null" and an unwritten
  // column then print the same five characters and differ by colour alone, which is not a difference.
  test('tell an ask reason of "null" apart from an ask with no reason', async () => {
    const { host } = await page(bundle())

    expect(host.querySelector('[data-ask="tmdb"] [data-token-reason]')?.textContent, 'the token, quoted')
      .toBe('"null"')
    expect(host.querySelector('[data-ask="mal"] .nothing')?.textContent, 'and the absence, marked')
      .toBe('null')
    expect(host.querySelector('[data-ask="tmdb"] .nothing'), 'the token is not marked as an absence')
      .toBeFalsy()

    // the seq is drawn and the column that is null by contract is not drawn at all
    const headers = [...host.querySelectorAll('[data-asks] thead th')].map(cell => cell.textContent)
    expect(headers).toEqual(['seq', 'origin', 'outcome', 'reason'])
    expect(text(host, '[data-ask="netflix"]'), 'the ask sequence, which lines up with the answer log')
      .toContain('3')
  })

  // Mutation: answer `otherClusters: []` from the worker, or drop the `[data-other-clusters]` block.
  // An address spanning two clusters then draws one and says nothing about the members it left out.
  test('say when the address reaches a cluster this bundle is not about', async () => {
    const split = bundle()
    split.resolved = { ...split.resolved!, otherClusters: ['cl:other'] }
    const { host } = await page(split)

    expect(text(host, '[data-other-clusters]')).toContain('cl:other')
    expect(host.querySelector('[data-other-clusters] a')?.getAttribute('href'))
      .toContain('uri=cl%3Aother')

    // the control: the ordinary bundle says nothing, so this is not a permanent warning
    const { host: plain } = await page(bundle())
    expect(plain.querySelector('[data-other-clusters]')).toBeFalsy()
  })
})

describe('what the worker half sends beyond the agreed contract', () => {
  // Its `traceAnswer` answers a ROW carrying the payload in `raw`, and its attachments and bundle
  // carry `supports` and `cost`. Rendering a row as JSON would show the payload escaped inside an
  // escaped string, and dropping the other two would hide data the bundle paid for.
  test('an answer row is shown as its stored payload, not as a JSON encoding of one', async () => {
    const detail = {
      key: 'A7', seq: 7, uri: 'mal:39535', origin: 'mal', kind: 'media', operation: 'getMedia',
      selection: ['id', 'title'], raw: '{"id":39535,"title":"Mob Psycho 100 II"}',
    }
    const { host } = await page(bundle(), { loadAnswerBytes: async () => detail })

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-claim="C1"] button')!.click() })
    await act(async () => { button(host.querySelector<HTMLElement>('[data-inspector]')!, 'Load answer bytes')!.click() })

    const shown = text(host, '[data-inspector] [data-answer]')
    expect(shown).toContain('{"id":39535,"title":"Mob Psycho 100 II"}')
    expect(shown, 'the payload is not double encoded').not.toContain('\\"id\\"')
  })

  test('an attachment offers its supports, and the bundle says what it cost', async () => {
    const { host } = await page(bundle())

    expect(text(host, '[data-cost]'), 'statements and milliseconds').toContain('14')
    expect(text(host, '[data-cost]')).toContain('62')

    const support = host.querySelector<HTMLButtonElement>('[data-attachment-support="L1"]')
    expect(support, 'the attachment names L1, so L1 is offered').toBeTruthy()
    await act(async () => { support!.click() })
    expect(text(host, '[data-inspector] [data-fact="rule"]')).toContain('title-and-year')
  })
})

describe('the way into this page from the app', () => {
  const link = async (search: string, uri?: string | null) => {
    const { hook, searchHook } = memoryLocation({ path: '/media/ag:(mal:39535)', searchPath: search })
    let host!: HTMLElement
    await act(async () => {
      host = mount(
        <Router hook={hook} searchHook={searchHook}>
          <TraceLink uri={uri === undefined ? 'ag:(mal:39535)' : uri}/>
        </Router>,
      )
    })
    hosts.push(host)
    return host
  }

  // Mutation: return the link whatever the flag says (drop the `readTraceFlag` test). It appears on
  // every media view for every user, which is why it is behind a flag at all (7.5).
  test('is a link on the media view, and only behind ?trace=1', async () => {
    const shown = await link('trace=1&graph=1')
    const anchor = shown.querySelector('a[data-trace-link]')!
    expect(anchor, 'the entry point the app was missing until 2026-09-13').toBeTruthy()

    // the href is asserted by what the PAGE reads back out of it, not by one of the several legal
    // encodings of a bracket: `?uri=ag%3A(x)` and `?uri=ag%3A%28x%29` are the same url
    const href = anchor.getAttribute('href') ?? ''
    expect(href.startsWith('/debug/trace?'), href).toBe(true)
    expect(traceUriFromSearch(new URL(href, 'http://d/').search)).toBe('ag:(mal:39535)')

    // the controls: no flag at all, and a flag with no uri to trace
    expect((await link('graph=1')).querySelector('a[data-trace-link]')).toBeFalsy()
    expect((await link('trace=1', null)).querySelector('a[data-trace-link]')).toBeFalsy()
  })

  // Mutation: drop the `graph` entry from `CARRIED_PARAMS`. The link still works while the tab is
  // open, and the url in the bug report comes up on an engine that is off.
  test('carries the engine flags, so the same string works when it is pasted', async () => {
    const warmed = (await link('trace=1&graph=1')).querySelector('a[data-trace-link]')!
    const engine = new URL(warmed.getAttribute('href') ?? '', 'http://d/').searchParams
    expect(engine.get('graph'), 'without this the pasted url comes up with the engine off')
      .toBe('1')

    const flagged = (await link('trace=1&store=graph')).querySelector('a[data-trace-link]')!
    const carried = new URL(flagged.getAttribute('href') ?? '', 'http://d/').searchParams
    expect(carried.get('store'), 'a page reading through the graph links a trace that does too')
      .toBe('graph')

    // the control: a flag the page does not carry is not invented
    const plain = (await link('trace=1')).querySelector('a[data-trace-link]')!
    const none = new URL(plain.getAttribute('href') ?? '', 'http://d/').searchParams
    expect([...none.keys()], 'the uri and nothing else').toEqual(['uri'])
  })

  // The modal itself cannot be imported here at all: it reaches @floating-ui/react, which resolves
  // `react` through vite's preact alias, so the import dies on a missing package. Same measurement
  // and same workaround as `modal-media.test.ts`: the component's shape is read off its source, with
  // a control that must fail.
  test('is rendered by the media modal for the uri on screen', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)),
      'utf-8',
    )
    expect(source, 'the modal imports it').toContain("import TraceLink from '../debug/link'")
    expect(source, 'and renders it for the media it drew').toContain('<TraceLink uri={media?.uri}/>')
    expect(source, 'the control: this probe can miss').not.toContain('<TraceLinkThatIsNotThere')
  })

  // Mutation: drop `${location.search}` from the modal's `navigate` (the shape it had until
  // 2026-09-13). A media view rewrites its own url without the query as the address grows, so on a
  // real build `location.search` was empty seconds after load and no flag could be read off the
  // route again. Read off the source for the same reason as the case above.
  test('survives the media view rewriting its own url', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)),
      'utf-8',
    )
    const grow = source.slice(source.indexOf('shouldGrowAddress(media?.uri'), source.indexOf('if (!open) return'))
    expect(grow, 'the address grow keeps the query string').toContain('${location.search}')
    expect(grow, 'the control: it is this navigate and not another').toContain('replace: true')

    // and the link does not depend on that fix alone: the flag is the session's
    const link = readFileSync(
      fileURLToPath(new URL('../../../src/router/debug/link.tsx', import.meta.url)),
      'utf-8',
    )
    expect(link).toContain('sessionSearch(useSearch())')
  })
})

describe('the query string an in-app link carries', () => {
  // THE OWNER'S OWN CLICK PATH, 2026-09-13. Opening `/media/ag:(anilist:178789)?store=graph` and
  // clicking the relation cards through to the earlier seasons left every address after the first
  // click with no query at all, so a reload or a pasted link anywhere along that walk came up on the
  // legacy store while the page you were looking at was on the graph.
  test('is the session flags and nothing else', () => {
    expect(carriedSearch('?store=graph&graph=1')).toBe('?graph=1&store=graph')
    expect(carriedSearch('?store=graph'), 'one flag on its own').toBe('?store=graph')
    expect(carriedSearch('?trace=1&export=query'), 'and only the flags a full load has to come up with').toBe('')
    expect(carriedSearch(''), 'nothing to carry is an empty string, never a bare ?').toBe('')
    expect(carriedSearch(), 'and a caller with no route search at all').toBe('')
  })

  // Mutation: drop `${search}` from the card's `to`, which is the shape it had until 2026-09-13, and
  // the first assertion fails. Read off the source for the same reason as the modal case above: the
  // component reaches the media modal's dependency tree, which cannot be imported here.
  test('rides on every relation card, read off the route rather than the address', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../src/components/media-relations.tsx', import.meta.url)),
      'utf-8',
    )
    expect(source, 'the card appends it to the media path')
      .toContain('to={`${getRoutePath(Route.MEDIA, { uri: asAggregatedUri(edge.node.uri) })}${search}`}')
    expect(source, 'and the flags are the session\'s, since the media view rewrites its own url')
      .toContain('carriedSearch(useSearch())')
    expect(source, 'the control: this probe can miss').not.toContain('carriedSearchThatIsNotThere')

    // the franchise graph is the modal's other way out to another work, and it drops the flags the
    // same way a relation card did
    const graph = readFileSync(
      fileURLToPath(new URL('../../../src/components/media-franchise.tsx', import.meta.url)),
      'utf-8',
    )
    // `data.uri` rather than `node.uri` since 2026-09-13: the link moved into the custom xyflow node,
    // which is handed a node's `data` rather than the node. The property is the same one.
    expect(graph, 'and every node of the franchise graph carries it too')
      .toContain('to={`${getRoutePath(Route.MEDIA, { uri: asAggregatedUri(data.uri) })}${search}`}')
    expect(graph).toContain('carriedSearch(useSearch())')
    expect(graph, 'the control: this probe can miss too').not.toContain('carriedSearchThatIsNotThere')
  })
})

describe('a worker that cannot answer', () => {
  // CONTROL. Every test above asserts what the page renders from a bundle; if a rejected load rendered
  // nothing at all, or rendered silently, none of them would notice. This is the rig proving it sees
  // the page's own output.
  test('has its refusal shown rather than an empty page', async () => {
    const { host } = await page(new Error('this build of the worker exposes no traceGraph'))

    expect(text(host, '[data-failed]')).toContain('exposes no traceGraph')
    expect(host.querySelector('[data-trace-graph]'), 'and no graph is drawn').toBeFalsy()
  })
})
