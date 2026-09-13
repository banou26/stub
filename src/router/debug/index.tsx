import type { TraceBundle } from './trace'
import type { TraceRef } from './model'
import type { WarmProgress } from './warm'

import { css } from '@emotion/react'
import { useEffect, useRef, useState, useMemo } from 'preact/hooks'
import { useLocation, useSearch } from 'wouter'

import { debugTracePath, graphOnHref, graphStoreHref, loadAnswer, loadTrace, traceUriFromSearch } from './trace'
import { isActive, reasonMessage, traceIndex } from './model'
import { warmTrace } from './warm'
import { Value } from './value'
import Graph from './graph'
import Episodes from './episodes'
import Inspector from './inspector'

/**
 * The graph trace page: one uri in, everything the graph believes about it out.
 *
 * Four parts, in this order, and the order is the reading order of a bug report: what was asked and
 * what it resolved to, the media graph with every link drawn including the refused ones, the episodes
 * the cluster resolved to, and an inspector that walks one edge down to the answer bytes that caused
 * it.
 *
 * DENSITY OVER BEAUTY, and honesty over both: every value comes from the bundle and a value the graph
 * does not carry renders as the word null. Nothing on this page is computed from something else, with
 * one exception that is labelled as such: the node set includes uris that only appear at the end of an
 * edge, so a refused neighbour has a box to be refused against.
 *
 * IT WARMS WHAT IT IS ASKED ABOUT, which is the one thing here that is not a read. The engine lives
 * inside one worker, a full page load makes a new one, and a pasted url therefore always arrives at
 * an empty graph: before this page asked the sources itself, a linked trace could answer nothing but
 * `graph-empty`, and the `not-enabled` message sent the reader to do the reload that produced it. So
 * an unresolved uri is fanned out through the same `media(uri)` subscription the media view drives
 * (`./warm.ts`), with the progress on screen, and re-traced as rows arrive. The re-tracing stops the
 * moment a cluster resolves, so nothing moves under a reader who has started clicking.
 *
 * The worker call is a PROP with a default rather than a module import, because `src/worker.ts`
 * spawns a Worker at module scope: injecting it is what lets the page be rendered against a hand
 * built bundle in a test, which is the only way the four `reason` messages and the refused states can
 * be pinned at all.
 */

const style = css`
  max-width: 150rem;
  margin: calc(var(--stub-header-height) + 2rem) auto 6rem;
  padding: 0 1.5rem;
  font-size: 1.3rem;

  h1 { font-size: 2rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.5rem; margin: 2rem 0 0.5rem; }
  h3 { font-size: 1.3rem; margin: 1.2rem 0 0.4rem; }
  .intro { opacity: 0.7; line-height: 1.5; margin-bottom: 1rem; }

  form.ask { display: flex; gap: 0.6rem; margin: 1rem 0; }
  form.ask input {
    flex: 1;
    min-width: 0;
    padding: 0.55rem 0.8rem;
    border-radius: 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    color: inherit;
    font-family: monospace;
  }
  form.ask input:focus { outline: none; border-color: rgba(255, 255, 255, 0.45); }
  form.ask button {
    padding: 0.55rem 1.3rem;
    border-radius: 0.4rem;
    border: none;
    background: #fff;
    color: #000;
    font-weight: 600;
    cursor: pointer;
  }

  .resolved, .unresolved {
    padding: 0.8rem 1rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }
  .unresolved { border-color: rgb(250, 204, 21); }
  .unresolved .why { color: rgb(250, 204, 21); }
  .failed {
    padding: 0.8rem 1rem;
    border: 1px solid rgb(248, 113, 113);
    border-radius: 0.5rem;
    color: rgb(248, 113, 113);
    overflow-wrap: anywhere;
  }
  .pairs { display: flex; flex-wrap: wrap; gap: 0.4rem 1.4rem; font-size: 1.2rem; }
  .pairs span.label { color: rgba(255, 255, 255, 0.5); margin-right: 0.3rem; }
  .pairs code { font-family: monospace; }

  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; font-size: 1.15rem; }
  .chips .chip {
    padding: 0.1rem 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 0.3rem;
    font-family: monospace;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 1.2rem;
  }
  th, td {
    padding: 0.3rem 0.6rem 0.3rem 0;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  thead th {
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: rgba(255, 255, 255, 0.45);
  }
  td.uri { font-family: monospace; overflow-wrap: anywhere; }
  tr.selected > td { background: rgba(61, 180, 242, 0.12); }
  .status.active { color: rgb(74, 222, 128); }
  .status.refused { color: rgb(248, 113, 113); }
  .empty { color: rgba(255, 255, 255, 0.5); font-size: 1.2rem; }

  button.inspect {
    padding: 0.1rem 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }
  button.inspect:hover { border-color: rgba(255, 255, 255, 0.5); color: #fff; }

  .warming {
    padding: 0.6rem 1rem;
    border: 1px solid rgb(61, 180, 242);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    color: rgb(147, 214, 250);
  }
  .warming.done { border-color: rgba(255, 255, 255, 0.2); color: rgba(255, 255, 255, 0.6); }
  .advice { margin-top: 0.4rem; }
  .advice a { color: rgb(147, 214, 250); text-decoration: underline; }
  .split { margin-top: 0.5rem; color: rgb(250, 204, 21); }
  .split a { color: rgb(250, 204, 21); text-decoration: underline; margin-left: 0.4rem; }
  code.token { font-family: monospace; }

  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
  @media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
`

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done', bundle: TraceBundle }
  | { kind: 'failed', error: string }

/** Whether the sources are being asked about the uri on screen, and how far that has got. */
type WarmState =
  | { kind: 'off' }
  | { kind: 'asking', progress: WarmProgress }
  | { kind: 'done', progress: WarmProgress }

/** How long after a payload the page re-traces, so a cold fan-out is not one trace per source. */
const RETRACE_MS = 1_500

const Pair = ({ label, value }: { label: string, value: string | number | boolean | null | undefined }) => (
  <div>
    <span className="label">{label}</span>
    <code><Value value={value}/></code>
  </div>
)

/**
 * An ask's reason, with the TOKEN `null` told apart from a real one.
 *
 * `Ask.reason` legitimately carries the string "null" (a source's own refusal reason, `asks.ts`), and
 * an unwritten column is a real null. Printed plainly the two differed by colour alone, which is not
 * a difference: the token is quoted, the absence is the page's own null marker.
 */
const AskReason = ({ reason }: { reason: string | null }) =>
  reason === 'null'
    ? <code className="token" data-token-reason>{'"null"'}</code>
    : <Value value={reason}/>

const Debug = ({ load = loadTrace, loadAnswerBytes = loadAnswer, warm = warmTrace }: {
  load?: (uri: string) => Promise<TraceBundle>
  loadAnswerBytes?: (seq: number) => Promise<unknown>
  warm?: (uri: string, options: { onProgress?: (progress: WarmProgress) => void }) => Promise<WarmProgress>
}) => {
  const search = useSearch()
  const [, navigate] = useLocation()
  const asked = traceUriFromSearch(search)

  const [input, setInput] = useState(asked)
  const [state, setState] = useState<LoadState>({ kind: 'idle' })
  // bumped by the form so asking for the SAME uri again re-fetches: the url does not change, so the
  // effect below would otherwise never run again and the button would look dead. The warm bumps it
  // too, which is how a cold uri turns into a bundle without the reader touching anything.
  const [nonce, setNonce] = useState(0)
  const [warming, setWarming] = useState<WarmState>({ kind: 'off' })
  /** The descent: one key per level, the last one is what the inspector shows. */
  const [trail, setTrail] = useState<string[]>([])
  /**
   * The uri a warm has already been started for, so one uri is fanned out once per visit.
   *
   * It is the warm's liveness as well: its callbacks fire only while this still names the uri they
   * were started for, so a new uri or an unmount retires them without cancelling on a re-render.
   */
  const warmed = useRef('')
  /** The pending re-trace, so payloads arriving together cause one trace and not one each. */
  const retracing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // SEPARATE from the fetch below, on the asked uri alone. A re-trace must not clear the trail: the
  // warm re-traces while the sources answer, and a reader mid-descent would have the inspector
  // emptied under them each time.
  useEffect(() => {
    setInput(asked)
    setTrail([])
    setWarming({ kind: 'off' })
    warmed.current = ''
    if (retracing.current !== undefined) clearTimeout(retracing.current)
    retracing.current = undefined
  }, [asked])

  useEffect(() => {
    if (!asked) {
      setState({ kind: 'idle' })
      return
    }
    let live = true
    setState(previous => previous.kind === 'done' ? previous : { kind: 'loading' })
    load(asked)
      .then(bundle => { if (live) setState({ kind: 'done', bundle }) })
      .catch(error => {
        if (live) setState({ kind: 'failed', error: error instanceof Error ? error.message : String(error) })
      })
    return () => { live = false }
  }, [asked, nonce])

  const bundle = state.kind === 'done' ? state.bundle : undefined
  const index = useMemo<Map<string, TraceRef>>(() => bundle ? traceIndex(bundle) : new Map(), [bundle])
  const selected = trail[trail.length - 1]
  // Whether the sources are worth asking about this uri: it reached no cluster, and the reason is one
  // a fan-out can change. Read once per render and never un-read, since the warm keeps running after
  // the trace it caused resolves.
  const needsWarm = Boolean(bundle && !bundle.resolved && bundle.reason !== 'not-enabled')

  // THE WARM. A uri that reached no cluster while the engine is ON is a uri no source has been asked
  // about in this tab, which is the normal state of a pasted link: the graph is built in the tab and
  // does not outlive it. `not-enabled` is the one reason a warm cannot help, since the engine flag is
  // read once per worker and only a reload can change it, and that is the case the message below
  // hands a reload link for.
  //
  // IT IS TIED TO THE ASKED URI AND NOT TO A RENDER, which is the whole shape of this effect. An
  // earlier version cancelled itself on any bundle change, so the FIRST trace that resolved killed
  // the warm that produced it: the sources kept answering, the panel stopped re-tracing, and rows
  // that arrive late (the similar consumer's asks, which is a whole section of this page) were
  // permanently missing from a panel that looked complete. `warmed` is therefore the liveness too,
  // and only a new uri or an unmount clears it.
  useEffect(() => {
    if (!asked || !needsWarm || warmed.current === asked) return
    warmed.current = asked
    const forUri = asked
    const wanted = () => warmed.current === forUri
    const retrace = () => {
      // debounced: the re-trace is what fills the page, and one per payload would be one trace per
      // source on a cold page
      if (retracing.current !== undefined) return
      retracing.current = setTimeout(() => {
        retracing.current = undefined
        if (wanted()) setNonce(previous => previous + 1)
      }, RETRACE_MS)
    }
    setWarming({ kind: 'asking', progress: { payloads: 0, uri: null, handles: 0, episodes: 0 } })
    warm(asked, {
      onProgress: progress => {
        if (!wanted()) return
        setWarming({ kind: 'asking', progress })
        retrace()
      },
    })
      .then(progress => {
        if (!wanted()) return
        setWarming({ kind: 'done', progress })
        setNonce(previous => previous + 1)
      })
      .catch(() => { if (wanted()) setWarming({ kind: 'off' }) })
  }, [asked, needsWarm])

  // unmount only, which is why it is its own effect: a cleanup with deps would run on every change
  // and put back the cancellation the comment above explains
  useEffect(() => () => {
    warmed.current = ''
    if (retracing.current !== undefined) clearTimeout(retracing.current)
  }, [])

  const onSubmit = (event: Event) => {
    event.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    setNonce(previous => previous + 1)
    navigate(debugTracePath({ uri: trimmed }))
  }

  return (
    <div css={style} data-debug-trace>
      <h1>Graph trace</h1>
      <p className="intro">
        Everything the graph holds for one cluster: its members, every link between them including the
        refused ones, the episodes it resolved to, and the answer each edge came from. Nothing here is
        derived, and a value the graph does not carry shows as null. The graph is built inside this
        tab, so a uri nothing has asked about yet is asked about here first, which is what makes this
        url worth pasting into a bug report.
      </p>
      <form className="ask" onSubmit={onSubmit}>
        <input
          type="text"
          autoComplete="off"
          spellcheck={false}
          placeholder="ag:(mal:39535,anilist:101280), or a member uri like mal:39535, or a cluster id like cl:..."
          value={input}
          onInput={event => setInput((event.target as HTMLInputElement).value)}
        />
        <button type="submit">Trace</button>
      </form>

      {state.kind === 'idle' && <p className="empty">Give it a uri. It rides in the url, so this page can be linked into a bug report.</p>}
      {
        warming.kind !== 'off' && (
          <p
            className={warming.kind === 'asking' ? 'warming' : 'warming done'}
            data-warming={warming.kind}
            data-answered={warming.progress.payloads}
          >
            {
              /* THREE LINES, NOT ONE, because the three are three different facts and the reader is
                 waiting on the difference: the sources are being asked, they have stopped and
                 produced something, or they have stopped and produced NOTHING. A page that said
                 "asking" forever, or reported a silent fan-out as a finished one, is the spinner
                 with no explanation this replaced. */
              warming.kind === 'asking'
                ? `asking the sources about ${asked}: ${warming.progress.payloads} answer(s) so far,`
                  + ` ${warming.progress.handles} handle(s), ${warming.progress.episodes} episode(s).`
                  + ' All 24 sources are asked, so a cold graph takes tens of seconds. The panel'
                  + ' fills as they answer and stops waiting on its own.'
                : warming.progress.payloads === 0
                  ? `nothing answered about ${asked}. All 24 sources were asked and none returned a`
                    + ' row, so the graph stayed empty: either no source recognises that uri, or'
                    + ' every one of them refused it. Nothing is still loading.'
                  : `the sources have stopped answering about ${asked}:`
                    + ` ${warming.progress.payloads} answer(s), ${warming.progress.handles} handle(s),`
                    + ` ${warming.progress.episodes} episode(s). What is below is what that produced.`
            }
          </p>
        )
      }
      {state.kind === 'loading' && <p className="empty" data-loading>tracing {asked}…</p>}
      {state.kind === 'failed' && <p className="failed" data-failed>{state.error}</p>}

      {
        bundle && (
          <>
            {
              bundle.resolved
                ? (
                  <div className="resolved" data-resolved>
                    <div className="pairs">
                      <Pair label="asked" value={bundle.asked}/>
                      <Pair label="cluster" value={bundle.resolved.clusterId}/>
                      <Pair label="aggregate" value={bundle.resolved.aggUri}/>
                      <Pair label="scope" value={bundle.resolved.scope}/>
                      <Pair label="kind" value={bundle.resolved.kind}/>
                    </div>
                    {
                      /* An `ag:(a,b)` address whose members sit in two clusters resolves to ONE, and
                         the other cluster's members are simply absent from everything below. A split
                         cluster is a common cause of "this page shows the wrong thing", so it is
                         called out here rather than left as a bundle that looks complete. */
                      (bundle.resolved.otherClusters ?? []).length > 0 && (
                        <div className="split" data-other-clusters>
                          This address also reaches{' '}
                          {bundle.resolved.otherClusters!.length} other cluster(s), whose members are
                          not below:{' '}
                          {bundle.resolved.otherClusters!.map(id => (
                            <a key={id} href={debugTracePath({ uri: id, search })}><code>{id}</code></a>
                          ))}
                        </div>
                      )
                    }
                  </div>
                )
                : (
                  <div className="unresolved" data-unresolved data-reason={bundle.reason ?? 'none'}>
                    <div className="why">{reasonMessage(bundle.reason)}</div>
                    {
                      /* THE ONE PIECE OF ADVICE ON THIS PAGE, and it is a link rather than a
                         sentence about a url, because the engine flag is read once per worker and
                         only a reload can change it. It carries the asked uri, so following it lands
                         back here with the engine on and this page then warms the uri itself: that is
                         what breaks the loop the two messages used to form. */
                      bundle.reason === 'not-enabled' && (
                        <div className="advice">
                          <a data-reload-graph href={graphOnHref(search)}>Reload with ?graph=1</a>
                          {' or '}
                          <a data-reload-store href={graphStoreHref(search)}>drop ?store=legacy</a>
                          {', keeping this uri.'}
                        </div>
                      )
                    }
                    <div className="pairs">
                      <Pair label="asked" value={bundle.asked}/>
                      <Pair label="reason" value={bundle.reason ?? null}/>
                    </div>
                  </div>
                )
            }

            <div className="pairs" data-run-length>
              <Pair label="run length" value={bundle.runLength?.value ?? null}/>
              <Pair label="from" value={bundle.runLength?.from ?? null}/>
              <Pair label="tier" value={bundle.runLength?.tier ?? null}/>
              <Pair label="witnesses" value={bundle.runLength?.witnesses ?? null}/>
            </div>

            <div className="pairs" data-cost>
              <Pair label="statements" value={bundle.cost?.statements ?? null}/>
              <Pair label="ms to build" value={bundle.cost?.ms ?? null}/>
            </div>

            <h3>Graph counts</h3>
            <div className="chips" data-counts>
              {
                Object.entries(bundle.counts ?? {}).length === 0
                  ? <span className="empty">the bundle carries no counts</span>
                  : Object.entries(bundle.counts).map(([name, count]) => (
                    <span className="chip" key={name}>{`${name} ${count}`}</span>
                  ))
              }
            </div>

            <div className="columns">
              <div>
                <h3>Anomalies</h3>
                {
                  (bundle.anomalies ?? []).length === 0
                    ? <p className="empty">no rule complained</p>
                    : (
                      <table data-anomalies>
                        <tbody>
                          {bundle.anomalies.map((anomaly, position) => (
                            <tr key={`${anomaly.rule} ${anomaly.detail} ${position}`}>
                              <td>{anomaly.rule}</td>
                              <td>{anomaly.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                }
              </div>
              <div>
                <h3>Asks</h3>
                {
                  (bundle.asks ?? []).length === 0
                    ? <p className="empty">nothing was asked of any origin</p>
                    : (
                      <table data-asks>
                        {/* `seq`, not `at`: the Ask table carries no timestamp column at all, so an
                            `at` column was the word null on every row forever. The sequence is real,
                            monotonic per session, and lines a row up with the answer log. */}
                        <thead>
                          <tr><th>seq</th><th>origin</th><th>outcome</th><th>reason</th></tr>
                        </thead>
                        <tbody>
                          {bundle.asks.map((ask, position) => (
                            <tr key={`${ask.origin} ${ask.seq ?? position}`} data-ask={ask.origin}>
                              <td><Value value={ask.seq ?? null}/></td>
                              <td>{ask.origin}</td>
                              <td>{ask.outcome}</td>
                              <td><AskReason reason={ask.reason}/></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                }
              </div>
            </div>

            <h2>Media graph</h2>
            <Graph bundle={bundle} selected={selected} onSelect={key => setTrail([key])}/>

            <h3>Links</h3>
            {
              (bundle.links ?? []).length === 0
                ? <p className="empty">no links, refused or otherwise</p>
                : (
                  <table data-links>
                    <thead>
                      <tr>
                        <th>from</th><th>to</th><th>kind</th><th>status</th><th>by</th><th>rule</th>
                        <th>confidence</th><th/>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.links.map(link => (
                        <tr
                          key={link.key}
                          data-link={link.key}
                          data-status={link.status}
                          className={selected === link.key ? 'selected' : undefined}
                        >
                          <td className="uri">{link.fromUri}</td>
                          <td className="uri">{link.toUri}</td>
                          <td>{link.kind}</td>
                          <td><span className={`status ${isActive(link.status) ? 'active' : 'refused'}`}>{link.status}</span></td>
                          <td>{link.by}</td>
                          <td>{link.reason}</td>
                          <td><Value value={link.confidence}/></td>
                          <td><button type="button" className="inspect" onClick={() => setTrail([link.key])}>Inspect</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            }

            <h3>Claims</h3>
            {
              (bundle.claims ?? []).length === 0
                ? <p className="empty">no claims between the uris this bundle names</p>
                : (
                  <table data-claims>
                    <thead>
                      <tr>
                        <th>from</th><th>to</th><th>kind</th><th>claimer</th><th>provenance</th>
                        <th>answer</th><th>target scope</th><th/>
                      </tr>
                    </thead>
                    <tbody>
                      {bundle.claims.map(claim => (
                        <tr
                          key={claim.key}
                          data-claim={claim.key}
                          className={selected === claim.key ? 'selected' : undefined}
                        >
                          <td className="uri">{claim.fromUri}</td>
                          <td className="uri">{claim.toUri}</td>
                          <td>{claim.kind}</td>
                          <td>{claim.claimer}</td>
                          <td>{claim.provenance}</td>
                          <td>{claim.answerSeq}</td>
                          <td><Value value={claim.targetScope}/></td>
                          <td><button type="button" className="inspect" onClick={() => setTrail([claim.key])}>Inspect</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            }

            <h3>Attachments</h3>
            {
              (bundle.attachments ?? []).length === 0
                ? <p className="empty">no run is attached to a container here</p>
                : (
                  <table data-attachments>
                    <thead>
                      <tr><th>run</th><th>container</th><th>via</th><th>by</th><th>evidence</th><th>supports</th></tr>
                    </thead>
                    <tbody>
                      {bundle.attachments.map(attachment => (
                        // `via` and `by` are in the key: two ATTACHED_TO rows between one pair with
                        // different `via` are two rows, and a key of the pair alone collides them
                        <tr key={`${attachment.runUri} ${attachment.containerUri} ${attachment.via} ${attachment.by}`}>
                          <td className="uri">{attachment.runUri}</td>
                          <td className="uri">{attachment.containerUri}</td>
                          <td>{attachment.via}</td>
                          <td>{attachment.by}</td>
                          <td className="uri"><Value value={attachment.evidence}/></td>
                          <td>
                            {
                              (attachment.supports ?? []).length === 0
                                ? <Value value={null}/>
                                : attachment.supports!.map(key => (
                                  <button
                                    key={key}
                                    type="button"
                                    className="inspect"
                                    data-attachment-support={key}
                                    onClick={() => setTrail([key])}
                                  >
                                    {key}
                                  </button>
                                ))
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            }

            <h2>Episodes</h2>
            <Episodes bundle={bundle} index={index} selected={selected} onSelect={key => setTrail([key])}/>

            <h2>Inspector</h2>
            <Inspector
              bundle={bundle}
              index={index}
              trail={trail}
              onFollow={key => setTrail(previous => [...previous, key])}
              onTrailTo={depth => setTrail(previous => previous.slice(0, depth + 1))}
              loadAnswerBytes={loadAnswerBytes}
            />
          </>
        )
      }
    </div>
  )
}

export default Debug
