/**
 * The label UI, served by scripts/label-corpus.mjs.
 *
 * Two screens behind the hash: `#/` lists the season's runs with their label state, `#/run/<index>`
 * shows everything the sources said about one run and collects the marks. A mark is a statement
 * about the WORKS, so an unmarked row asserts nothing: the case still describes it, because the
 * store is handed every row the judge saw, and no expectation names it.
 *
 * THE REVIEW SURFACE. The labelling itself is done by agents through the API, and a person reads
 * this for the runs two of them disagreed about: a flagged run carries a `review` marker in the list
 * and its reason and the two verdicts at the top of its own screen, and saving a case clears the
 * flag, which is what resolving one means.
 *
 * The case is NOT assembled here. `GET /api/runs/:index/case` serves the skeleton, which is every
 * part of a case the data already decides, and `buildCase` overlays the marks on it: an agent
 * labelling over the API and a person labelling here post the same rows, claims and episodes because
 * there is only one thing that builds them. The post is what decides whether the result is valid,
 * and the validator's own message is what this shows on a refusal.
 */

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'value') node.value = value
    else if (key === 'checked') node.checked = Boolean(value)
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

const app = document.getElementById('app')
const get = async path => {
  const response = await fetch(path)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? `${response.status} on ${path}`)
  return body
}

// the owner's own day, not UTC's: at 05:30 local the UTC date is still yesterday, and the stamp is a
// record of when a person decided something
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
// sources do not agree on a date format: anilist answers `Sat, 04 Jul 2026 ...` where mal answers an
// ISO string, and slicing ten characters off the first prints `Sat, 04 Ju`. A year or a month alone
// (`2027`, `2027-10`) stays as it is rather than read as its first day. Only the display is normalised
// here, never the value the case carries.
const day = value => {
  if (typeof value !== 'string' || !value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) || /^\d{4}(-\d{2})?$/.test(value) ? value : parsed.toISOString().slice(0, 10)
}

/* --------------------------------------------------------------------------------------------- */
/* the run list                                                                                    */
/* --------------------------------------------------------------------------------------------- */

let listing
let filter = ''

const listRows = () => {
  const wanted = filter.trim().toLowerCase()
  const runs = listing.runs.filter(run =>
    !wanted
    || run.title.toLowerCase().includes(wanted)
    || run.uri.toLowerCase().includes(wanted)
    || run.memberOrigins.join(' ').includes(wanted)
    || run.state.startsWith(wanted)
    || (run.review && 'review'.startsWith(wanted)))
  return el('table', { class: 'runs' }, ...runs.map(run =>
    el('tr', {},
      el('td', { class: 'idx', text: String(run.index) }),
      el('td', { class: 'title' }, el('a', { href: `#/run/${run.index}`, text: run.title })),
      el('td', { class: 'uri muted', text: run.memberOrigins.join(' ') }),
      el('td', { class: 'muted count', text: `${run.rows} answers` }),
      el('td', {}, el('span', { class: `state ${run.state}`, text: run.state })),
      // the marker the queue exists for: a person reads the flagged runs and nothing else
      el('td', {}, run.review ? el('span', { class: 'state review', title: run.review.reason, text: 'review' }) : undefined),
      el('td', { class: 'uri muted', text: run.slug }))))
}

const showList = async () => {
  listing = await get('/api/runs')
  const body = el('div', {}, listRows())
  app.replaceChildren(
    el('div', { class: 'top' },
      el('h1', { text: `corpus labels: ${listing.season}` }),
      el('span', { class: 'muted', text: `${listing.progress.labelled} / ${listing.progress.total} labelled` }),
      el('span', { class: 'muted', text: `${listing.runs.filter(run => run.review).length} flagged for review` }),
      el('span', { class: 'grow' }),
      el('input', {
        placeholder: 'filter by title, uri, origin or state',
        size: 40,
        value: filter,
        oninput: event => {
          filter = event.target.value
          body.replaceChildren(listRows())
        },
      })),
    el('p', { class: 'muted uri', text: `${listing.dump.file}: ${listing.dump.rows} answers, ${listing.dump.media} distinct media uris` }),
    body)
}

/* --------------------------------------------------------------------------------------------- */
/* the run screen                                                                                  */
/* --------------------------------------------------------------------------------------------- */

const MARKS = [
  ['same', 's', 'this row is the run'],
  ['holds', 'h', 'a container or folded season that holds the run'],
  ['spans', 'p', 'a catalogue season that is a piece of this run'],
  ['unrelated', 'u', 'neither merged nor attached, in either direction'],
  ['unknown', 'n', 'the default: asserts nothing'],
]

const PENDING_WHY = 'today\'s store cannot answer containment with ranges, so the case waits for one that can'

let run
let skeleton
let saved
let marks = new Map()
let ranges = new Map()
let episodeMarks = new Map()
let runEpisodesFrom
let focus = 0
let draft = { name: '', why: '', by: '', notes: '', pending: true }

const allRows = () => run.origins.flatMap(group => group.rows)
const markOf = uri => marks.get(uri) ?? 'unknown'
const judgeable = () => allRows().filter(row => !row.isMember)

/** Every row the case speaks about: the members, plus every row the owner marked. */
const judged = () => allRows().filter(row => row.isMember || markOf(row.uri) !== 'unknown')

/** The run's own episode list: whichever member or `same` row published the most of them. */
const runSideRows = () => allRows()
  .filter(row => (row.isMember || markOf(row.uri) === 'same') && row.episodes.length)
  .sort((a, b) => Number(b.isMember) - Number(a.isMember) || b.episodes.length - a.episodes.length)

const runEpisodes = () => {
  const rows = runSideRows()
  const chosen = rows.find(row => row.uri === runEpisodesFrom) ?? rows[0]
  return { from: chosen?.uri, episodes: chosen?.episodes ?? [] }
}

const pairKey = (a, b) => `${a}|${b}`

/* the marks a saved case carries, read back so a run can be revisited and corrected */
const prefill = () => {
  marks = new Map()
  ranges = new Map()
  episodeMarks = new Map()
  draft = { name: run.title, why: '', by: localStorage.getItem('corpus-label-by') ?? '', notes: '', pending: true }
  if (!saved) return
  const key = run.keyMember
  for (const group of saved.expect.together ?? []) {
    if (!group.includes(key)) continue
    for (const uri of group) if (!run.members.includes(uri)) marks.set(uri, 'same')
  }
  for (const relation of saved.expect.partOf ?? []) {
    if (relation.part === key) marks.set(relation.whole, 'holds')
    else if (relation.whole === key) marks.set(relation.part, 'spans')
  }
  for (const uri of saved.expect.unrelated ?? []) marks.set(uri, 'unrelated')
  for (const edge of saved.expect.includes ?? []) if (edge.range) ranges.set(edge.container, edge.range)
  for (const pair of saved.expect.episodePairs ?? []) episodeMarks.set(pairKey(pair.a, pair.b), 'pair')
  for (const pair of saved.expect.episodeApart ?? []) episodeMarks.set(pairKey(pair.a, pair.b), 'apart')
  draft = {
    name: saved.name ?? run.title,
    why: saved.why ?? '',
    by: saved.checked?.by ?? draft.by,
    notes: saved.checked?.notes ?? '',
    pending: Boolean(saved.pending),
  }
}

/* --------------------------------------------------------------------------------------------- */
/* the case                                                                                        */
/* --------------------------------------------------------------------------------------------- */

const validRange = range =>
  Boolean(range)
  && [range.fromStart, range.fromEnd, range.toStart, range.toEnd].every(value => Number.isFinite(value))
  && range.fromEnd >= range.fromStart
  && range.toEnd >= range.toStart
  && range.fromEnd - range.fromStart === range.toEnd - range.toStart

/**
 * The case, exactly as it is posted: the server's skeleton with the marks laid over it.
 *
 * The rows, claims, episodes and answer keys are the skeleton's own and are not rebuilt here, so this
 * and an agent posting over the API describe the run identically. What the marks decide is `expect`,
 * plus the name, the reason and the stamp. Nothing here decides whether the result is valid: the
 * server runs `validateCase` and its message is what the owner reads.
 */
const buildCase = () => {
  const key = run.keyMember
  const marked = kind => allRows().filter(row => !row.isMember && markOf(row.uri) === kind).map(row => row.uri)
  const same = marked('same')
  const holds = marked('holds')
  const spans = marked('spans')
  const unrelated = marked('unrelated')
  const seenEpisodes = new Set((skeleton.episodes ?? []).map(episode => episode.uri))

  const partOf = [
    ...holds.map(uri => ({ part: key, whole: uri })),
    ...spans.map(uri => ({ part: uri, whole: key })),
  ]
  const includes = holds
    .filter(uri => validRange(ranges.get(uri)))
    .map(uri => ({ container: uri, run: key, range: ranges.get(uri) }))
  const pairs = []
  const apartEpisodes = []
  for (const [id, kind] of episodeMarks) {
    const [a, b] = id.split('|')
    if (!seenEpisodes.has(a) || !seenEpisodes.has(b)) continue
    if (kind === 'pair') pairs.push({ a, b })
    else apartEpisodes.push({ a, b })
  }

  return {
    ...skeleton,
    name: draft.name,
    why: draft.why,
    expect: {
      together: [[...run.members, ...same]],
      apart: unrelated.map(uri => [key, uri]),
      partOf: partOf.length ? partOf : undefined,
      includes: includes.length ? includes : undefined,
      episodePairs: pairs.length ? pairs : undefined,
      episodeApart: apartEpisodes.length ? apartEpisodes : undefined,
      unrelated: unrelated.length ? unrelated : undefined,
    },
    // `by` is free text on purpose: an agent name (`agent:opus`) and a person (`human:banou`) are
    // both a record of who decided it
    checked: { by: draft.by, at: today(), notes: draft.notes || undefined },
    pending: draft.pending ? 'new store' : undefined,
  }
}

/* --------------------------------------------------------------------------------------------- */
/* rendering one run                                                                               */
/* --------------------------------------------------------------------------------------------- */

const factsOf = row => [
  row.scope ?? 'RUN',
  row.episodeCount === null ? undefined : `${row.episodeCount} ep`,
  row.episodes.length ? `${row.episodes.length} listed` : undefined,
  day(row.startDate),
  row.season && row.seasonYear ? `${row.season} ${row.seasonYear}` : undefined,
  row.type,
].filter(Boolean).join(' · ')

const episodePanel = row => {
  const range = ranges.get(row.uri) ?? {}
  const side = runEpisodes()
  const alignment = number => {
    if (!validRange(range) || number === null) return undefined
    if (number < range.fromStart || number > range.fromEnd) return undefined
    return number - range.fromStart + range.toStart
  }
  const partner = episode => {
    const wanted = alignment(episode.number) ?? episode.number
    const chosen = [...episodeMarks.keys()].find(id => id.startsWith(`${episode.uri}|`))
    return chosen ? chosen.split('|')[1] : side.episodes.find(other => other.number === wanted)?.uri
  }

  const numberInput = field => el('input', {
    type: 'number',
    value: range[field] ?? '',
    oninput: event => {
      const next = { ...(ranges.get(row.uri) ?? {}) }
      next[field] = event.target.value === '' ? undefined : Number(event.target.value)
      ranges.set(row.uri, next)
      renderRun()
    },
  })

  const rangeLine = el('div', { class: 'range' },
    el('span', { class: 'muted', text: 'container' }), numberInput('fromStart'), '..', numberInput('fromEnd'),
    el('span', { class: 'muted', text: 'onto run' }), numberInput('toStart'), '..', numberInput('toEnd'),
    el('span', {
      class: validRange(range) ? 'ok' : 'muted',
      text: validRange(range)
        ? `${range.fromEnd - range.fromStart + 1} episodes each side, so expect.includes carries the range`
        : Object.keys(range).length
          ? 'the two sides must name the same number of episodes, so no range is written yet'
          : 'empty: the case states partOf alone, with no correspondence',
    }),
    el('button', {
      text: 'fill',
      onclick: () => {
        const from = row.episodes.map(episode => episode.number).filter(value => typeof value === 'number')
        const to = side.episodes.map(episode => episode.number).filter(value => typeof value === 'number')
        const length = Math.min(from.length, to.length)
        if (!length) return
        ranges.set(row.uri, { fromStart: from[0], fromEnd: from[length - 1], toStart: to[0], toEnd: to[length - 1] })
        renderRun()
      },
    }))

  const sourcePicker = el('div', { class: 'range' },
    el('span', { class: 'muted', text: 'the run\'s episodes come from' }),
    el('select', {
      onchange: event => {
        runEpisodesFrom = event.target.value
        renderRun()
      },
    }, ...runSideRows().map(candidate => el('option', {
      value: candidate.uri,
      selected: candidate.uri === side.from,
      text: `${candidate.uri} (${candidate.episodes.length})`,
    }))),
    !side.episodes.length && el('span', { class: 'muted', text: 'no member or same row published an episode list, so nothing can be paired' }))

  const table = el('table', { class: 'eps' },
    el('tr', {},
      el('th', { colspan: 3, text: `${row.uri} (${row.episodes.length})` }),
      el('th', { text: 'is' }),
      el('th', { colspan: 3, text: `the run (${side.episodes.length})` }),
      el('th', { text: '' })),
    ...row.episodes.map(episode => {
      const other = partner(episode)
      const state = other ? episodeMarks.get(pairKey(episode.uri, other)) : undefined
      const match = side.episodes.find(candidate => candidate.uri === other)
      const mark = kind => {
        if (!other) return
        const id = pairKey(episode.uri, other)
        for (const existing of [...episodeMarks.keys()]) if (existing.startsWith(`${episode.uri}|`)) episodeMarks.delete(existing)
        if (episodeMarks.get(id) !== kind) episodeMarks.set(id, kind)
        renderRun()
      }
      return el('tr', { class: state ?? '' },
        el('td', { class: 'num', text: episode.number ?? '?' }),
        el('td', { text: episode.title ?? '' }),
        el('td', { class: 'date', text: day(episode.releaseDate) }),
        el('td', {}, el('select', {
          onchange: event => {
            const next = event.target.value
            for (const existing of [...episodeMarks.keys()]) if (existing.startsWith(`${episode.uri}|`)) episodeMarks.delete(existing)
            if (next) episodeMarks.set(pairKey(episode.uri, next), state ?? 'pair')
            renderRun()
          },
        },
        el('option', { value: '', selected: !other, text: 'nothing' }),
        ...side.episodes.map(candidate => el('option', {
          value: candidate.uri,
          selected: candidate.uri === other,
          text: `${candidate.number ?? '?'} ${candidate.title ?? candidate.uri}`.slice(0, 60),
        })))),
        el('td', { class: 'num', text: match?.number ?? '' }),
        el('td', { text: match?.title ?? '' }),
        el('td', { class: 'date', text: day(match?.releaseDate) }),
        el('td', {},
          el('button', { class: state === 'pair' ? 'on' : '', text: 'pair', onclick: () => mark('pair') }),
          ' ',
          el('button', { class: state === 'apart' ? 'on' : '', text: 'apart', onclick: () => mark('apart') })))
    }))

  return el('div', { class: 'episodes' }, sourcePicker, rangeLine, table)
}

const rowCard = (row, index) => {
  const mark = markOf(row.uri)
  const card = el('div', {
    class: [
      'row',
      row.isMember ? 'member' : `mark-${mark}`,
      index === focus ? 'focus' : '',
    ].filter(Boolean).join(' '),
    id: index < 0 ? undefined : `row-${index}`,
    'data-uri': row.uri,
  },
  el('div', { class: 'line' },
    el('span', { class: 'name', text: row.title ?? row.uri }),
    row.url
      ? el('a', { class: 'uri', href: row.url, target: '_blank', rel: 'noreferrer', text: row.uri })
      : el('span', { class: 'uri muted', text: row.uri }),
    el('span', { class: 'facts', text: factsOf(row) }),
    row.isMember
      ? el('span', { class: 'chip key', text: row.uri === run.keyMember ? 'key member' : 'member' })
      : el('span', { class: 'marks' }, ...MARKS.map(([kind, letter, hint]) => el('button', {
        class: mark === kind ? 'on' : '',
        title: hint,
        text: `${kind} ${letter}`,
        onclick: () => {
          marks.set(row.uri, mark === kind ? 'unknown' : kind)
          focus = index
          renderRun()
        },
      })))),
  row.handles.length || row.namedBy.length
    ? el('div', { class: 'handles', text: [
      row.handles.length ? `claims ${row.handles.map(handle => `${handle.uri} ${handle.relation}`).join(', ')}` : '',
      row.namedBy.length ? `named by ${row.namedBy.map(entry => `${entry.uri} ${entry.relation}`).join(', ')}` : '',
      `${row.answers} answers`,
    ].filter(Boolean).join('  |  ') })
    : undefined,
  mark === 'holds' && row.episodes.length ? episodePanel(row) : undefined)
  return card
}

const saveBar = () => {
  const message = el('div', { class: 'message muted', text: '' })
  const post = async () => {
    message.className = 'message muted'
    message.textContent = 'saving'
    localStorage.setItem('corpus-label-by', draft.by)
    const response = await fetch(`/api/cases/${run.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildCase()),
    })
    const body = await response.json()
    if (!response.ok) {
      message.className = 'message bad'
      message.textContent = body.error
      return
    }
    message.className = 'message ok'
    message.textContent = `saved ${body.path}`
    saved = body.case
    // a saved case IS the resolution of a disagreement, so the queue loses the run here. The banner
    // is removed in place rather than by re-rendering, which would take the message above with it
    if (run.review) {
      await fetch(`/api/review/${run.slug}`, { method: 'DELETE' })
      run.review = undefined
      const cached = listing?.runs?.[run.index]
      if (cached) cached.review = undefined
      document.getElementById('review-banner')?.remove()
      message.textContent = `saved ${body.path}, and the run is out of the review queue`
    }
  }

  return el('div', { class: 'save' },
    el('div', { class: 'fields' },
      el('label', { text: 'name' }),
      el('input', { size: 52, value: draft.name, oninput: event => { draft.name = event.target.value } }),
      el('label', { text: 'checked by' }),
      el('input', {
        size: 18,
        value: draft.by,
        placeholder: 'agent:opus or human:banou',
        oninput: event => { draft.by = event.target.value },
      }),
      el('span', { class: 'muted', text: `at ${today()}` }),
      el('label', { text: 'notes' }),
      el('input', { size: 36, value: draft.notes, oninput: event => { draft.notes = event.target.value } }),
      el('label', {},
        el('input', { type: 'checkbox', checked: draft.pending, onchange: event => { draft.pending = event.target.checked } }),
        ' pending: new store'),
      el('span', { class: 'muted', text: PENDING_WHY })),
    el('textarea', {
      class: 'why',
      rows: 2,
      placeholder: 'why, in terms of the works rather than the code',
      value: draft.why,
      oninput: event => { draft.why = event.target.value },
    }),
    el('div', { class: 'fields' },
      el('button', { class: 'primary', text: 'save', onclick: post }),
      el('span', { class: 'legend', text: 'j / k move, s same, h holds, p spans, u unrelated, n unknown' })),
    message)
}

/** Why this run is in front of a person: the reason, and the two verdicts that differed. */
const reviewBanner = () => el('div', { class: 'review', id: 'review-banner' },
  el('span', { class: 'chip key', text: 'review' }),
  el('span', { text: run.review.reason }),
  run.review.disagreement ? el('span', { class: 'muted', text: run.review.disagreement }) : undefined,
  el('span', { class: 'muted', text: `flagged by ${run.review.by} on ${run.review.at}` }))

/** Who decided the saved case and when, which is an agent name as often as a person's. */
const stampLine = () => el('div', { class: 'stamp muted' },
  el('span', { text: `checked by ${saved.checked.by} on ${saved.checked.at}` }),
  saved.checked.notes ? el('span', { class: 'notes', text: saved.checked.notes }) : undefined)

const renderRun = () => {
  const cards = []
  let index = 0
  for (const group of run.origins) {
    const rows = group.rows.map(row => rowCard(row, row.isMember ? -1 : index++))
    cards.push(el('div', { class: 'group' },
      el('h2', { text: group.name === group.origin ? group.origin : `${group.name} (${group.origin})` }),
      ...rows))
  }
  // filtered, because replaceChildren stringifies an absent child into the word "undefined" where
  // `el` above drops it
  app.replaceChildren(...[
    el('div', { class: 'top' },
      el('a', { href: '#/', text: '< runs' }),
      el('h1', { text: run.title }),
      el('span', { class: 'uri muted', text: run.uri }),
      el('span', { class: 'grow' }),
      el('span', { class: 'muted', text: `${allRows().length} rows, ${judged().length} judged` }),
      el('span', { class: `state ${saved ? 'labelled' : 'unlabelled'}`, text: saved ? 'labelled' : 'unlabelled' }),
      run.index + 1 < (listing?.progress.total ?? 0) && el('a', { href: `#/run/${run.index + 1}`, text: 'next >' })),
    run.review ? reviewBanner() : undefined,
    saved?.checked ? stampLine() : undefined,
    el('div', { class: 'members' }, ...run.members.map(uri =>
      el('span', { class: `chip uri${uri === run.keyMember ? ' key' : ''}`, text: uri }))),
    ...cards,
    saveBar(),
  ].filter(Boolean))
  const focused = document.getElementById(`row-${focus}`)
  if (focused) focused.scrollIntoView({ block: 'nearest' })
}

const showRun = async index => {
  run = await get(`/api/runs/${index}`)
  // the rows, claims and episodes of the case, built once and on the server: the marks are laid over
  // this rather than assembling a second copy here
  skeleton = await get(`/api/runs/${index}/case`)
  saved = await get(`/api/cases/${run.slug}`).then(body => body.case, () => undefined)
  if (!listing) listing = await get('/api/runs').catch(() => undefined)
  focus = 0
  runEpisodesFrom = undefined
  prefill()
  renderRun()
}

/* --------------------------------------------------------------------------------------------- */
/* keyboard                                                                                        */
/* --------------------------------------------------------------------------------------------- */

const KEYS = new Map(MARKS.map(([kind, letter]) => [letter, kind]))

document.addEventListener('keydown', event => {
  if (!run || event.metaKey || event.ctrlKey || event.altKey) return
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const rows = judgeable()
  if (!rows.length) return
  if (event.key === 'j' || event.key === 'k') {
    focus = Math.max(0, Math.min(rows.length - 1, focus + (event.key === 'j' ? 1 : -1)))
    renderRun()
    event.preventDefault()
    return
  }
  const kind = KEYS.get(event.key)
  if (!kind) return
  const row = rows[focus]
  if (!row) return
  marks.set(row.uri, markOf(row.uri) === kind ? 'unknown' : kind)
  renderRun()
  event.preventDefault()
})

/* --------------------------------------------------------------------------------------------- */
/* routing                                                                                         */
/* --------------------------------------------------------------------------------------------- */

const route = async () => {
  const at = location.hash.replace(/^#/, '').match(/^\/run\/(\d+)$/)
  try {
    if (at) await showRun(Number(at[1]))
    else await showList()
  } catch (error) {
    app.replaceChildren(el('p', { class: 'bad', text: String(error.message ?? error) }))
  }
}

window.addEventListener('hashchange', route)
await route()
