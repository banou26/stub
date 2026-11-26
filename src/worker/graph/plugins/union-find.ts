/** A union-find over active or settled `SAME_AS` edges: the closure of 3.5, computed once for a batch. */
export type Components = {
  /** The component key of one uri: its lowest member, so two uris agree iff their keys do. */
  keyOf: (uri: string) => string
  /** Every member of one uri's component, the uri included. */
  membersOf: (uri: string) => string[]
  /**
   * The same relation with every edge incident to the excluded uris removed.
   *
   * GUARDS 4 AND 5 BOTH NEED IT, because without it each asks a question whose answer it has already
   * decided. Guard 5 skips a pair of claimants that share a component, and once both their claims are
   * accepted they share one THROUGH THE TARGET, so the merge erases the evidence that it should never
   * have happened. Guard 4 refuses a proposal that would ADD a disagreement to a component, and a
   * component held together only by a contested row is one guard 5 is about to take apart, so the
   * disagreement it measures is not one the proposal adds.
   *
   * Left plain, both are decided by arrival order: `plugins/arrival-order.test.ts` builds four claims
   * that cannot all be true and gets two different graphs out of six orderings of the same answers.
   *
   * Cheap because the exclusion is LOCAL. Only the excluded uris' own components can come apart, so
   * this re-runs the union-find over those components' edges and delegates every other uri to the
   * full relation. Memoized for the life of the snapshot, which is one write.
   */
  without: (excluded: string | Iterable<string>) => Pick<Components, 'keyOf' | 'membersOf'>
  /** The same relation with `edges` added: the components a write accepting them would leave. */
  joined: (edges: [string, string][]) => Components
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`)

export const apart: Components = {
  keyOf: uri => uri,
  membersOf: uri => [uri],
  without: () => apart,
  joined: () => apart,
}

export const componentsOf = (edges: [string, string][]): Components => {
  const parent = new Map<string, string>()
  const find = (uri: string): string => {
    let root = uri
    while (parent.get(root) && parent.get(root) !== root) root = parent.get(root)!
    let walk = uri
    while (parent.get(walk) && parent.get(walk) !== walk) {
      const next = parent.get(walk)!
      parent.set(walk, root)
      walk = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    parent.set(a, parent.get(a) ?? a)
    parent.set(b, parent.get(b) ?? b)
    const rootA = find(a)
    const rootB = find(b)
    if (rootA === rootB) return
    // the lower uri is always the root, so a component key is stable whatever order the edges arrive
    if (rootA < rootB) parent.set(rootB, rootA)
    else parent.set(rootA, rootB)
  }
  // INDEXED BY ENDPOINT, because `without` walks only the edges inside the cut. Iterating the whole
  // active SAME_AS list and filtering made one memo miss O(|E|) however small the cut: measured on the
  // recorded page 2026-09-14, 7,781 `without` calls, 802 of them misses, 380,757 edge visits against
  // 628 active rows. Free at that size and not at page scale, and `contested` below calls it per
  // multi-claimant target per proposal.
  const incident = new Map<string, [string, string][]>()
  const index = (uri: string, pair: [string, string]) => {
    const list = incident.get(uri)
    if (list) list.push(pair)
    else incident.set(uri, [pair])
  }
  for (const pair of edges) {
    index(pair[0], pair)
    index(pair[1], pair)
    union(pair[0], pair[1])
  }

  const members = new Map<string, string[]>()
  for (const uri of parent.keys()) {
    const root = find(uri)
    const list = members.get(root)
    if (list) list.push(uri)
    else members.set(root, [uri])
  }
  const keyOf = (uri: string): string => (parent.has(uri) ? find(uri) : uri)
  const membersOf = (uri: string): string[] => (parent.has(uri) ? [...members.get(find(uri))!].sort() : [uri])

  const excluding = new Map<string, Pick<Components, 'keyOf' | 'membersOf'>>()
  const without = (excluded: string | Iterable<string>): Pick<Components, 'keyOf' | 'membersOf'> => {
    const cut = typeof excluded === 'string' ? new Set([excluded]) : new Set(excluded)
    const memo = [...cut].sort().join('\u0000')
    const cached = excluding.get(memo)
    if (cached) return cached
    const local = new Set<string>()
    for (const uri of cut) for (const member of membersOf(uri)) local.add(member)
    const localParent = new Map<string, string>()
    const localFind = (uri: string): string => {
      let root = uri
      while (localParent.get(root) && localParent.get(root) !== root) root = localParent.get(root)!
      return root
    }
    for (const uri of local) if (!cut.has(uri)) localParent.set(uri, uri)
    const seen = new Set<[string, string]>()
    for (const uri of local) {
      if (cut.has(uri)) continue
      for (const pair of incident.get(uri) ?? []) {
        if (seen.has(pair)) continue
        seen.add(pair)
        const [from, to] = pair
        if (cut.has(from) || cut.has(to)) continue
        const rootA = localFind(from)
        const rootB = localFind(to)
        if (rootA === rootB) continue
        if (rootA < rootB) localParent.set(rootB, rootA)
        else localParent.set(rootA, rootB)
      }
    }
    const localMembers = new Map<string, string[]>()
    for (const uri of localParent.keys()) {
      const root = localFind(uri)
      const list = localMembers.get(root)
      if (list) list.push(uri)
      else localMembers.set(root, [uri])
    }
    const view = {
      keyOf: (uri: string) => (localParent.has(uri) ? localFind(uri) : cut.has(uri) ? uri : keyOf(uri)),
      membersOf: (uri: string) => (
        localParent.has(uri)
          ? [...localMembers.get(localFind(uri))!].sort()
          : cut.has(uri) ? [uri] : membersOf(uri)
      ),
    }
    excluding.set(memo, view)
    return view
  }

  return { keyOf, membersOf, without, joined: more => componentsOf([...edges, ...more]) }
}
