/**
 * The corpus against the GRAPH store, at step 2g-c: ALL SIX plugins of 5.4, which is the pass the
 * live worker runs (`DEFAULT_PLUGINS`, imported rather than retyped).
 *
 * IT REPORTS AND IT TRIAGES. Every line the run produces is collected, counted by kind and written to
 * ./graph-store.report.md with a VERDICT against it, and a line with no verdict fails the run. Four
 * verdicts, and only the first is work for this repo's code:
 *
 * - `STORE BUG`: a plugin's rule reached the wrong answer on evidence that was there. Named with the
 *   plugin, the rule, the rows and the fix expected, because that list is what gets dispatched.
 * - `LABEL DOUBTED`: the store is right and the case is not. It goes to the review queue through the
 *   label server, never edited here, and the case stays exactly as labelled until a person settles it.
 * - `RECORDING`: the answer set cannot carry the label. The evidence a rule would need is not in the
 *   rows, so no rule can reach the conclusion; listed in ../../../corpus/known-disagreements.graph.json
 *   with what is missing.
 * - `EXPECTED GAP`: the specification defers the rule and no plugin owes it yet. Named with the section.
 *
 * WHAT IS ASSERTED, which is what the steps through 2g promised:
 * - no `WELD` between two rows the labels put apart where BOTH rows carry a first-party id. Sameness
 *   between two metadata catalogues is decided by `plugin:direct` and the guards of 5.2, so a weld
 *   there is a bug in the guards or in the closure of 3.5.
 * - every `together` group that first-party `SAME_AS` claims already join IS together, unless a guard
 *   of 5.2 refused a link inside it and said so on the row.
 * - every `partOf` the labels state that a SOURCE CLAIMED is attached, which is `plugin:direct`'s edge
 *   and `plugin:containment`'s attachment.
 * - EVERY LINE CARRIES A VERDICT, and every verdict matches at least one line. A line nothing triages
 *   is a new disagreement; a rule nothing matches is a disagreement that went away and a stale entry.
 * - the cases the triage calls `RECORDING` are EXACTLY the known-disagreements list, so a fix, a
 *   regression and a stale entry are all loud, which is the contract `current-store.test.ts` holds
 *   its own list to.
 *
 * Nothing here weakens a case to make it pass. A line in the report is a debt, named and owned.
 */
import { expect, test } from 'vite-plus/test'

import { writeFileSync } from 'node:fs'

import type { CorpusCase } from '../../../corpus/types'

import { containmentClaimed, graphStore, lastUpsertCost, refusalsWithin } from '../../../corpus/adapters/graph-store'
import { checkRelations, loadCases } from '../../../corpus/run'
import knownDisagreements from '../../../corpus/known-disagreements.graph.json'
import { PER_RUN_ORIGINS } from '../../../../src/worker/graph/plugins/sameness'

const REPORT = new URL('./graph-store.report.md', import.meta.url).pathname

/**
 * The origins whose every id names ONE RUN, which is what "a first-party id" means here (5.2 class 0):
 * mal, anilist, kitsu, anizip, anidb, offline and simkl. Imported rather than retyped, because a
 * second list of the same origins is the drift that makes two rules disagree about one catalogue.
 */
const firstParty = (uri: string): boolean => PER_RUN_ORIGINS.has(uri.slice(0, uri.indexOf(':')))

/**
 * `runCorpus`'s cluster half, ported so this file can COLLECT what that one throws.
 *
 * `tests/corpus/run.ts` belongs to the corpus rather than to this step and `runCorpus` is an
 * assertion harness by design: every case is a failing test the moment a store disagrees with a
 * label. The line format is kept identical, so a line in the report reads exactly as the same line
 * would read out of a failing run.
 */
const checkClusters = (corpusCase: CorpusCase, clusters: string[][]): string[] => {
  const holding = (uri: string): string[] => clusters.find(cluster => cluster.includes(uri)) ?? []
  const failures: string[] = []
  for (const group of corpusCase.expect.together) {
    for (const uri of group) {
      const actual = holding(uri)
      const missing = group.filter(member => !actual.includes(member))
      if (missing.length) {
        failures.push(`SPLIT: ${uri} should share a cluster with ${missing.join(', ')} but its cluster is [${actual.join(', ')}]`)
      }
    }
  }
  for (const group of corpusCase.expect.apart) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i]!, group[j]!]
        const actual = holding(a)
        if (actual.includes(b)) {
          failures.push(`WELD: ${a} and ${b} are one cluster and must not be. Cluster is [${actual.join(', ')}]`)
        }
      }
    }
  }
  return failures
}

const normalise = (clusters: string[][]): string[][] =>
  clusters.map(cluster => [...cluster].sort()).sort((a, b) => ((a[0] ?? '') < (b[0] ?? '') ? -1 : 1))

/** Whether every member of `group` reaches every other over the claims `admits` accepts. */
const joinedBy = (corpusCase: CorpusCase, group: string[], admits: (claim: { mediaUri: string, handleUri: string, relation?: string }) => boolean): boolean => {
  const neighbours = new Map<string, string[]>()
  for (const claim of corpusCase.claims) {
    if (!admits(claim)) continue
    neighbours.set(claim.mediaUri, [...neighbours.get(claim.mediaUri) ?? [], claim.handleUri])
    neighbours.set(claim.handleUri, [...neighbours.get(claim.handleUri) ?? [], claim.mediaUri])
  }
  const inside = new Set(group)
  const seen = new Set([group[0]!])
  const queue = [group[0]!]
  while (queue.length) {
    for (const next of neighbours.get(queue.shift()!) ?? []) {
      if (seen.has(next) || !inside.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return group.every(uri => seen.has(uri))
}

const isSameAs = (claim: { relation?: string }): boolean => (claim.relation ?? 'SAME_AS') === 'SAME_AS'

/**
 * Why a `together` group would hold at THIS step, which is what tells an expected split from a bug.
 *
 * `claim` means first-party ids already assert it and `plugin:direct` alone must produce it.
 * `claim (other origins)` means a claim asserts it but at least one side is not a metadata catalogue,
 * so a guard of 5.2 may legitimately have refused it, and since address provenance landed (3.3) an
 * echo from `cr`, `nf`, `appletv` or `jw` into a first-party id space is refused by guard 3 and
 * contributes nothing. `containment` never welds, and `title` is `plugin:title`'s to hold.
 */
const holdsBy = (corpusCase: CorpusCase, group: string[]): 'claim' | 'claim (other origins)' | 'containment' | 'title' => {
  if (joinedBy(corpusCase, group, claim => isSameAs(claim) && firstParty(claim.mediaUri) && firstParty(claim.handleUri))) return 'claim'
  if (joinedBy(corpusCase, group, isSameAs)) return 'claim (other origins)'
  if (joinedBy(corpusCase, group, () => true)) return 'containment'
  return 'title'
}

const KINDS = ['SPLIT', 'WELD', 'PART_OF', 'INCLUDES', 'EPISODE_PAIR', 'UNRELATED', 'ORDER'] as const
type Kind = typeof KINDS[number]

const kindOf = (line: string): Kind => {
  if (line.startsWith('SPLIT')) return 'SPLIT'
  if (line.startsWith('WELD')) return 'WELD'
  if (line.startsWith('PART_OF')) return 'PART_OF'
  if (line.startsWith('INCLUDES')) return 'INCLUDES'
  if (line.startsWith('EPISODE_PAIR') || line.startsWith('EPISODE_WELD')) return 'EPISODE_PAIR'
  if (line.startsWith('UNRELATED')) return 'UNRELATED'
  return 'ORDER'
}

/** What step 2d's report counted, so the same table can be read as a before and after. */
const BEFORE_2D: { cases: number, green: number, lines: Record<Kind, number> } = {
  cases: 249,
  green: 166,
  lines: { SPLIT: 106, WELD: 15, PART_OF: 0, INCLUDES: 2, EPISODE_PAIR: 162, UNRELATED: 169, ORDER: 0 },
}

/**
 * The four verdicts a remaining line can carry. One per line, and a line with none fails the run.
 *
 * `STORE BUG` is the only one that is work for this repo's plugins. The other three each say WHO owns
 * the disagreement: a person settling a label, the walk that recorded the answers, or a section of the
 * specification that has not been implemented because nothing owes it yet.
 */
type Verdict = 'STORE BUG' | 'LABEL DOUBTED' | 'RECORDING' | 'EXPECTED GAP'

/**
 * One triage rule: a verdict for the lines of named cases, of named kinds, with the reasoning.
 *
 * Rules are tried IN ORDER and the first match wins, so a case whose `PART_OF` line and whose `SPLIT`
 * lines have different owners is split by `kinds` rather than by a second list of slugs. Every rule
 * must match at least one line, which is what makes a disagreement that went away loud.
 */
type TriageRule = {
  id: string
  verdict: Verdict
  /** The case slugs this rule answers for. */
  cases: string[]
  /** The line kinds it answers for, inside those cases. */
  kinds: Kind[]
  /** The finding, in one paragraph: what the store did, on what evidence, and who owns it. */
  why: string
}

const TRIAGE: TriageRule[] = [
  // The STORE BUG this list carried on 2026-09-12 is FIXED (`c69c5ff`, plugin:range's schedule skew),
  // and the fix reached the corpus as 22 fewer EPISODE_PAIR lines and one more clean case. Its rule is
  // gone rather than kept as a passing entry: a triage rule that matches no line fails this run by
  // design, which is how a fixed case announces itself here. What the bug was, and the fix that was
  // rejected for dropping every play button rather than moving it, is in the commit and in the record.
  {
    id: 'the-case-pins-a-weld-the-new-store-refuses',
    verdict: 'LABEL DOUBTED',
    cases: [
      'a-member-carrying-another-seasons-date-widens-the-year-set', 'a-show-level-source-id-welds-two-season-clusters',
      'known-gap-a-year-only-side-welds-to-a-season-3-cluster',
    ],
    kinds: ['SPLIT'],
    why: 'The case asserts a WELD of two seasons that the graph store refuses, and the refusal is right about '
      + 'the works: guard 4 (disagreeing-ids) on two anilist ids in one component, and guard 5 (contested) on '
      + 'two components claiming one show-level Apple TV id. All three cases were extracted from a store that '
      + 'had neither guard, and two of them are named in tests/corpus/README.md as pinning a defect whose fix '
      + 'is at the SOURCE, while the third carries a knownGap whose own text says "A replacement store that '
      + 'splits these two is BETTER than the one this corpus was extracted from: change the case, do not '
      + 'weaken it". A case is never edited here, so each is in the review queue for a person to settle.',
  },
  {
    id: 'the-offline-row-pairs-the-anilist-id-with-another-mal-id',
    verdict: 'LABEL DOUBTED',
    cases: ['anilist-205068'],
    kinds: ['SPLIT'],
    why: 'The case puts mal:64683 with anilist:205068 on AniList\'s idMal, while the recording\'s Offline row '
      + 'pairs anilist:205068 with MyAnimeList 63225, as the offline database the trackers read still does '
      + '(release 2026-42). One id per catalogue, with the batch\'s Offline claims weighed first (5.2, guard 4), '
      + 'refuses AniList\'s claim, so the run splits from mal:64683 rather than holding two MyAnimeList ids, '
      + 'and the trackers refuse that card either way. The labeller flagged the same conflict; a person '
      + 'settles which MyAnimeList id is the run\'s.',
  },
  {
    id: 'the-echo-was-the-only-evidence-and-the-row-has-no-title-or-no-date',
    verdict: 'RECORDING',
    cases: [
      'anilist-108992', 'anilist-128757', 'anilist-159309', 'anilist-169583', 'anilist-177637',
      'anilist-177699', 'anilist-180136', 'anilist-185874', 'anilist-185875', 'anilist-186863',
      'anilist-188525', 'anilist-192800', 'anilist-194219', 'anilist-194829', 'anilist-196187',
      'anilist-196218', 'anilist-196356', 'anilist-197715', 'anilist-198376', 'anilist-198409',
      'anilist-199066', 'anilist-199408', 'anilist-199748', 'anilist-200637', 'anilist-201514',
      'anilist-202269', 'anilist-203490', 'anilist-203880', 'anilist-204466', 'anilist-206249',
      'anilist-207254', 'anilist-207809', 'anilist-209504', 'anilist-209669', 'anilist-209983',
      'anilist-213484', 'anilist-213847', 'anilist-215639', 'kitsu-50688', 'kitsu-50695', 'kitsu-50758',
    ],
    kinds: ['SPLIT', 'EPISODE_PAIR'],
    why: 'A catalogue season row the labels put in the run, whose every SAME_AS into a first-party id space is '
      + 'an address echo: guard 3 refuses it and never downgrades it (3.3), which is what removed the fifteen '
      + 'welds of step 2d. plugin:title is then the only route left and the recording gives it nothing to read. '
      + 'Measured over all 249 cases: 63 of the 65 jw rows publish NO title at all and all 65 carry the '
      + '2026-01-01 sentinel start date, so their profiles hold titleKeys [] and a cluster with no title is '
      + 'skipped (5.4 P3); the nf and cr rows that split publish no start date at all, so their profiles hold '
      + 'year NULL and gate 0\'s year bucket never puts them beside the run. Every EPISODE_PAIR line here '
      + 'follows from the same split: the two rows are in two clusters, so no slot and no pair can hold them. '
      + 'What is missing is upstream of the store, in the justwatch and crunchyroll extractors: a title and a '
      + 'real start date on the season row. Each case names its own row in known-disagreements.graph.json.',
  },
  {
    id: 'no-episode-count-anywhere-so-guard-8-refuses',
    verdict: 'RECORDING',
    cases: ['a-january-first-streaming-cluster-attaches-to-an-october-show', 'the-live-mushoku-s1-s3-weld'],
    kinds: ['SPLIT'],
    why: 'No row in either case carries an episodeCount, so every run cluster has a NULL runLength and guard 8 '
      + '(no-length) downgrades the folding origin\'s season to PART_OF rather than welding it: "no count is '
      + 'not zero" (5.2). plugin:title DID propose each pair on an exact title key and the refusal is written '
      + 'on the LINK row with its reason, so this is a priced decision rather than a silence, and the price is '
      + 'the badge the spec says a refusal costs instead of a button. The evidence guard 8 wants is a count on '
      + 'either side and the fixtures carry none.',
  },
  {
    id: 'the-title-is-the-shows-and-scores-below-the-calibrated-threshold',
    verdict: 'RECORDING',
    cases: ['a-season-nobody-splits-still-brings-its-episodes'],
    kinds: ['SPLIT'],
    why: 'The Crunchyroll season row publishes the SHOW\'s title, so its only key is '
      + '"mushoku tensei jobless reincarnation" against the run\'s "mushoku tensei jobless reincarnation '
      + 'season 3", which scores below SIMILARITY_THRESHOLD = 0.9 (the calibrated figure, "change nothing", '
      + '2026-08-29). plugin:title therefore proposes nothing and no refusal row exists, which is the reading '
      + 'of a SPLIT with no refusal behind it when a gate rather than a guard turned the pair down. Its own '
      + 'SAME_AS into anilist: is an address echo refused by guard 3, and no first-party row in this case '
      + 'names the cr season, so nothing in the recording reaches it.',
  },
  {
    id: 'a-containing-answer-no-source-ships-yet',
    verdict: 'EXPECTED GAP',
    cases: [
      // `anilist-209983` was here until 2026-09-13 and is CLOSED: the ordinal axis attaches it to
      // `nf:82703566`, so it reports no line. Left in the list it would triage a regression as an
      // expected gap, which is the one thing this list must never do
      'anilist-185874', 'anilist-196187', 'anilist-210032', 'anilist-211711',
      'anilist-212994', 'mal-61649', 'mal-62707',
    ],
    kinds: ['PART_OF'],
    why: 'Each line wants a run attached to a Netflix or Disney TITLE row that no source claimed: '
      + 'containmentClaimed is false for every one of them. Three things could write it and none may. A source claim: '
      + 'the only one is the address echo, which 3.3 refuses and deliberately does NOT downgrade, because "the '
      + 'address names WHICH sources to ask and asserts nothing about how they relate", and the row is drawn '
      + 'as a plain badge carrying its own url instead (6.2). plugin:containment\'s span rule: it needs the '
      + 'season\'s own episode DAYS to cover the run\'s start and Netflix publishes no date at any level (5.4 '
      + 'P4, failure mode). An ask: 4.4 defines the `containing` answer that will carry exactly this and no '
      + 'source ships one yet (4.6). So no plugin owes these today and the gap is named rather than owned.',
  },
]

/** The verdict for one line of one case, or `undefined` when nothing triages it. */
const verdictFor = (file: string, line: string): TriageRule | undefined => {
  const slug = file.replace(/\.json$/, '')
  return TRIAGE.find(rule => rule.cases.includes(slug) && rule.kinds.includes(kindOf(line)))
}

type CaseReport = {
  file: string
  name: string
  pending?: string
  knownGap?: string
  lines: string[]
  /** Per `together` group, what would have to hold it: the expected / unexpected split. */
  splits: { group: string[], holds: string, failed: boolean, refusals: string[] }[]
  welds: { a: string, b: string, firstParty: boolean }[]
  /** Per failing `PART_OF` line, whether a source CLAIMED the containment the labels state. */
  attachments: { part: string, whole: string, claimed: boolean }[]
}

const drive = async (corpusCase: CorpusCase, reversed: boolean): Promise<string[][]> => {
  const order = <T,>(values: T[]): T[] => (reversed ? [...values].reverse() : values)
  await graphStore.reset()
  await graphStore.upsert(order(corpusCase.rows), order(corpusCase.claims), order(corpusCase.episodes ?? []))
  return normalise(await graphStore.clusters())
}

test('the corpus against the graph store: every disagreement, counted and named', async () => {
  const cases = loadCases()
  const reports: CaseReport[] = []
  const started = Date.now()
  let answers = 0
  let passMs = 0

  for (const { file, corpusCase } of cases) {
    const lines: string[] = []
    let forward: string[][] = []
    for (const reversed of [false, true]) {
      const clusters = await drive(corpusCase, reversed)
      const cost = lastUpsertCost()
      answers += cost.answers
      passMs += cost.passMs
      if (!reversed) forward = clusters
      else if (JSON.stringify(clusters) !== JSON.stringify(forward)) {
        lines.push('ORDER: the two arrival orders produced different clusters, which invariant I15 refuses')
      }
      const found = [
        ...checkClusters(corpusCase, clusters),
        ...await checkRelations(corpusCase, graphStore, clusters),
      ]
      for (const line of found) if (!lines.includes(line)) lines.push(line)
    }

    const holding = (uri: string): string[] => forward.find(cluster => cluster.includes(uri)) ?? []
    reports.push({
      file,
      name: corpusCase.name,
      pending: corpusCase.pending,
      knownGap: corpusCase.expect.knownGap,
      lines,
      splits: await Promise.all(corpusCase.expect.together.map(async group => ({
        group,
        holds: holdsBy(corpusCase, group),
        failed: group.some(uri => group.some(member => !holding(uri).includes(member))),
        // WHY it split, in the graph's own words: a guard of 5.2 refused the link, or nothing did
        refusals: [...new Set((await refusalsWithin(group)).map(refusal => `${refusal.pair}: ${refusal.reason}`))],
      }))),
      welds: corpusCase.expect.apart.flatMap(group => group.flatMap((a, index) =>
        group.slice(index + 1)
          .filter(b => holding(a).includes(b))
          .map(b => ({ a, b, firstParty: firstParty(a) && firstParty(b) })))),
      // a `PART_OF` line a CLAIM backs is the store's debt; one nothing claimed waits on a plugin or
      // on a source shipping `containing` (4.4), and the report says which of the two it is
      attachments: await Promise.all((corpusCase.expect.partOf ?? [])
        .filter(edge => lines.some(line => line.startsWith(`PART_OF: ${edge.part} must be attached to ${edge.whole}`)))
        .map(async edge => ({ ...edge, claimed: await containmentClaimed(edge.part, edge.whole) }))),
    })
  }

  // THE REPORT. Written before the assertions, so a run that goes red still leaves the measurement.
  const counts = new Map<Kind, number>(KINDS.map(kind => [kind, 0]))
  for (const report of reports) for (const line of report.lines) counts.set(kindOf(line), counts.get(kindOf(line))! + 1)
  const splitsByCause = new Map<string, number>()
  for (const report of reports) {
    for (const split of report.splits) {
      if (!split.failed) continue
      splitsByCause.set(split.holds, (splitsByCause.get(split.holds) ?? 0) + 1)
    }
  }
  const green = reports.filter(report => !report.lines.length)
  const unexpectedWelds = reports.flatMap(report => report.welds.filter(weld => weld.firstParty).map(weld => ({ report, weld })))
  // A SPLIT WITH NO REFUSAL BEHIND IT is the bug this step can have: the claims assert the group, no
  // guard of 5.2 refused any link inside it, and the closure still did not hold it. A split a guard
  // DID refuse is a priced decision, which 5.2 guard 9 asks the corpus replay to count before it
  // ships on, so it is reported with the guard named rather than asserted away.
  const unexpectedSplits = reports.flatMap(report =>
    report.splits.filter(split => split.failed && split.holds === 'claim' && !split.refusals.length).map(split => ({ report, split })))
  const pricedSplits = reports.flatMap(report =>
    report.splits.filter(split => split.failed && split.holds === 'claim' && split.refusals.length).map(split => ({ report, split })))
  const unattached = reports.flatMap(report =>
    report.attachments.filter(edge => edge.claimed).map(edge => ({ report, edge })))
  const unclaimedAttachments = reports.flatMap(report =>
    report.attachments.filter(edge => !edge.claimed).map(edge => ({ report, edge })))
  const weldedCases = [...new Set(reports.filter(report => report.welds.length).map(report => report.file.replace(/\.json$/, '')))].sort()
  const knownCases = Object.keys(knownDisagreements.cases).sort()

  // THE TRIAGE. One verdict per line, from the table above, plus the two ways the table can be wrong:
  // a line nothing answers for, and a rule nothing matches any more.
  const triaged = reports.flatMap(report =>
    report.lines.map(line => ({ file: report.file, line, rule: verdictFor(report.file, line) })))
  const untriaged = triaged.filter(entry => !entry.rule)
  const matched = new Set(triaged.flatMap(entry => entry.rule ? [entry.rule.id] : []))
  const staleRules = TRIAGE.filter(rule => !matched.has(rule.id)).map(rule => rule.id)
  const linesOf = (rule: TriageRule) => triaged.filter(entry => entry.rule?.id === rule.id)
  const casesOf = (rule: TriageRule) => [...new Set(linesOf(rule).map(entry => entry.file.replace(/\.json$/, '')))].sort()
  const byVerdict = (verdict: Verdict) => TRIAGE.filter(rule => rule.verdict === verdict)
  const verdictLines = (verdict: Verdict) => byVerdict(verdict).reduce((total, rule) => total + linesOf(rule).length, 0)
  const recordingCases = [...new Set(byVerdict('RECORDING').flatMap(casesOf))].sort()
  const VERDICTS: Verdict[] = ['STORE BUG', 'LABEL DOUBTED', 'RECORDING', 'EXPECTED GAP']

  writeFileSync(REPORT, [
    '# The corpus against the graph store, all six plugins, step 2g-c',
    '',
    'Generated by `tests/unit/worker/corpus/graph-store.test.ts`, which drives every case in',
    '`tests/corpus/cases` twice (file order, then every list reversed) through `DEFAULT_PLUGINS`, the',
    'six of 5.4 the live worker runs: `plugin:profile`, `plugin:direct`, `plugin:title`,',
    '`plugin:containment`, `plugin:range` and `plugin:aggregate`. It carries no date on purpose: the',
    'same corpus over the same code writes the same file, so a diff here is a change in one of the two.',
    '',
    'Every line below carries a VERDICT (see Triage), and a line with none fails the run.',
    '',
    '## Counts',
    '',
    `- cases: ${reports.length}, of which ${green.length} report nothing at all`,
    `- cases with at least one line: ${reports.length - green.length}`,
    `- \`PART_OF\` lines a source CLAIMED, which is the store's debt: ${unattached.length}`,
    `- \`PART_OF\` lines no claim carries: ${unclaimedAttachments.length}`,
    `- \`WELD\` cases: ${weldedCases.length}`,
    '',
    '| kind | 2d | now | what it means |',
    '| --- | --- | --- | --- |',
    ...KINDS.map(kind => `| ${kind} | ${BEFORE_2D.lines[kind]} | ${counts.get(kind)} | ${({
      SPLIT: 'a `together` group came back as more than one cluster',
      WELD: 'an `apart` pair came back as one cluster',
      PART_OF: 'a container attachment the labels state and the store does not hold',
      INCLUDES: 'an episode range, which `plugin:range` writes (5.4 P4)',
      EPISODE_PAIR: 'two rows that are one broadcast episode, or two that must never be one',
      UNRELATED: 'a row that must stand alone and does not',
      ORDER: 'the two arrival orders disagreed (invariant I15)',
    } as Record<Kind, string>)[kind]} |`),
    `| cases reporting nothing | ${BEFORE_2D.green} | ${green.length} | the case is fully satisfied, both arrival orders |`,
    '',
    '### What moved, per kind',
    '',
    '- **`WELD` 15 to 0, and `UNRELATED` 169 to 0.** Both were one mechanism: a `SAME_AS` a Netflix or',
    '  Crunchyroll row made into a first-party id space, which the walk recorded from a title search.',
    '  Address provenance (3.3) now stamps those `address`, `plugin:direct` never consumes one, and',
    '  guard 3 refuses it without downgrading. So the bare Netflix title id no longer welds into the run',
    '  (the fifteen echo welds of step 2d are gone, and every one of those entries has been removed from',
    '  `known-disagreements.graph.json`), and it no longer attaches to it either, which is what every',
    '  `UNRELATED ATTACHED` and `UNRELATED HOLDS` line was.',
    '- **`SPLIT` 106 to 280, and `EPISODE_PAIR` 162 to 732, while the cases reporting nothing went 166 to',
    `  ${green.length}.** The same change, seen from the other side, and the reason the line count rises`,
    '  while the case count falls: thirty cases that only ever failed through an echo weld now pass',
    '  outright, and the cases that used the echo to HOLD a group now fail visibly instead, each one',
    '  naming every member of the group rather than one pair. `plugin:title` holds a group only when it',
    '  can read a title and a year off both sides, and the catalogue rows in question publish neither.',
    '- **`PART_OF` 0 to 8.** Same root: an attachment that used to arrive as a downgrade of the echo has',
    '  no source behind it any more, and nothing else may write it (see the `EXPECTED GAP` rule).',
    '- **`INCLUDES` 2 to 0.** `plugin:range` ships, so the two ranges the corpus asks for are held.',
    '- **`ORDER` 0 to 0.** Invariant I15 holds with all six plugins in the pass.',
    '',
    '## Which SPLITs are expected',
    '',
    '| what would hold the group | failing groups | expected |',
    '| --- | --- | --- |',
    `| a first-party \`SAME_AS\` claim | ${splitsByCause.get('claim') ?? 0} | only where a guard of 5.2 REFUSED it, named on the line: ${pricedSplits.length} of them, and ${unexpectedSplits.length} with no refusal behind them |`,
    `| a \`SAME_AS\` claim naming another origin | ${splitsByCause.get('claim (other origins)') ?? 0} | sometimes: a guard of 5.2 may have refused it, and an address echo is refused by guard 3 and contributes nothing (3.3) |`,
    `| a containment edge | ${splitsByCause.get('containment') ?? 0} | a containment edge never welds: \`plugin:containment\` attaches and mints no sameness (5.4 P2) |`,
    `| a title match | ${splitsByCause.get('title') ?? 0} | only when both sides publish a title and a year: gate 0 buckets and gate 5 compares (5.4 P3) |`,
    '',
    '## Triage',
    '',
    'One verdict per line. A line nothing answers for and a rule nothing matches are both assertion',
    'failures, so this section cannot rot quietly.',
    '',
    '| verdict | lines | rules | cases |',
    '| --- | --- | --- | --- |',
    ...VERDICTS.map(verdict => `| ${verdict} | ${verdictLines(verdict)} | ${byVerdict(verdict).length} | ${[...new Set(byVerdict(verdict).flatMap(casesOf))].length} |`),
    `| (untriaged) | ${untriaged.length} | 0 | ${[...new Set(untriaged.map(entry => entry.file))].length} |`,
    '',
    ...VERDICTS.flatMap(verdict => [
      `### ${verdict}`,
      '',
      ...byVerdict(verdict).flatMap(rule => [
        `**\`${rule.id}\`**, ${linesOf(rule).length} line${linesOf(rule).length === 1 ? '' : 's'} over `
        + `${casesOf(rule).length} case${casesOf(rule).length === 1 ? '' : 's'}, kinds ${rule.kinds.join(', ')}.`,
        '',
        rule.why,
        '',
        `Cases: ${casesOf(rule).map(slug => `\`${slug}\``).join(', ')}`,
        '',
        // a bug is dispatched from this file, so its lines are printed here rather than only in the
        // per-case section a reader would have to assemble by hand
        ...rule.verdict === 'STORE BUG'
          ? ['```', ...linesOf(rule).map(entry => `${entry.file}: ${entry.line}`), '```', '']
          : [],
      ]),
    ]),
    ...untriaged.length
      ? ['### UNTRIAGED, which fails the run', '', '```', ...untriaged.map(entry => `${entry.file}: ${entry.line}`), '```', '']
      : [],
    '## The known disagreements',
    '',
    'The cases the triage calls `RECORDING` are exactly the list in',
    '`tests/corpus/known-disagreements.graph.json`, each with what the answer set is missing.',
    '',
    ...recordingCases.map(slug => `- \`${slug}\`: ${knownDisagreements.cases[slug as keyof typeof knownDisagreements.cases] ?? 'NOT LISTED'}`),
    '',
    '## The lines',
    '',
    ...reports.filter(report => report.lines.length).flatMap(report => [
      `### ${report.file}`,
      '',
      `${report.name}`,
      ...report.pending ? ['', `PENDING on "${report.pending}": the case says this cannot be asked of any store yet.`] : [],
      ...report.knownGap ? ['', `KNOWN GAP: the case pins what the OLD store does rather than what is right. ${report.knownGap}`] : [],
      ...report.splits.filter(split => split.failed).map(split =>
        `\n- the group [${split.group.join(', ')}] would be held by: ${split.holds}`
        + (split.refusals.length ? `, and a guard of 5.2 refused: ${split.refusals.join('; ')}` : '')),
      ...report.attachments.map(edge =>
        `\n- the containment [${edge.part} part of ${edge.whole}] ${edge.claimed ? 'IS CLAIMED by a source and must be attached' : 'is claimed by nothing: no source said so, and 3.3 refuses the address echo without downgrading it'}`),
      '',
      `\nVERDICTS: ${[...new Set(report.lines.map(line => verdictFor(report.file, line)?.id ?? 'UNTRIAGED'))].join(', ')}`,
      '',
      '```',
      ...report.lines,
      '```',
      '',
    ]),
  ].join('\n'))

  // THE ASSERTIONS. Everything above is a measurement; these are what the steps through 2g promised.
  expect(
    unexpectedWelds.map(entry => `${entry.report.file}: ${entry.weld.a} and ${entry.weld.b}`),
    'a weld between two first-party ids is a bug in the guards of 5.2 or in the closure of 3.5, never a missing plugin'
  ).toEqual([])
  expect(
    unexpectedSplits.map(entry => `${entry.report.file}: [${entry.split.group.join(', ')}]`),
    'a group first-party SAME_AS claims join, that no guard of 5.2 refused, is what plugin:direct asserts and the closure holds'
  ).toEqual([])
  // Containment a source CLAIMED must be attached. `plugin:direct` derives the edge and
  // `plugin:containment` attaches the clusters, so a claimed containment that draws no attachment is
  // a bug in one of them (5.4 P1, P2).
  expect(
    unattached.map(entry => `${entry.report.file}: ${entry.edge.part} part of ${entry.edge.whole}`),
    'containment a source claimed is an edge plugin:direct writes and an attachment plugin:containment makes'
  ).toEqual([])
  // EVERY LINE CARRIES A VERDICT, and every verdict still has a line. The first catches a new
  // disagreement, the second a disagreement that went away and left a stale entry behind.
  expect(
    untriaged.map(entry => `${entry.file}: ${entry.line}`),
    'every remaining line needs a verdict in TRIAGE: a line nothing answers for is a new disagreement'
  ).toEqual([])
  expect(
    staleRules,
    'a triage rule that matches no line is a disagreement that went away; delete the rule and its known-disagreements entries'
  ).toEqual([])
  // and the RECORDING cases are exactly the list, with what is missing named for each: a case that
  // starts agreeing, a case that starts disagreeing, and a stale slug are all loud (the contract
  // current-store.test.ts holds its own list to)
  expect(recordingCases, 'the cases the triage calls RECORDING are exactly known-disagreements.graph.json').toEqual(knownCases)
  expect(
    knownCases.filter(slug => !cases.some(entry => entry.file === `${slug}.json`)),
    'a listed slug with no case file'
  ).toEqual([])

  console.info('the corpus against the graph store:', JSON.stringify({
    cases: reports.length,
    green: green.length,
    answers,
    lines: Object.fromEntries([...counts].filter(([, total]) => total)),
    splitsByCause: Object.fromEntries(splitsByCause),
    pricedSplits: pricedSplits.map(entry => `${entry.report.file}: ${entry.split.refusals.join('; ')}`),
    claimedAttachmentsMissing: unattached.length,
    unclaimedAttachmentsPending: unclaimedAttachments.length,
    weldedCases: weldedCases.length,
    triage: Object.fromEntries(VERDICTS.map(verdict => [verdict, verdictLines(verdict)])),
    untriaged: untriaged.length,
    staleRules,
    recordingCases: recordingCases.length,
    passMs,
    totalMs: Date.now() - started,
  }, null, 2))
}, 1_800_000)
