// Graph view filtering and selection, kept free of canvas code so it can be unit-tested.

export interface GraphFilter {
  /** Note paths matching the filter query, or null when there is no query. */
  match: Set<string> | null
  /** Vault setting: show notes without links. */
  showOrphans: boolean
  /** Show only notes without links. */
  orphansOnly: boolean
}

/** Which nodes are drawn. `deg` is each node's number of edges. */
export function visibleNodes(ids: string[], deg: number[], f: GraphFilter): boolean[] {
  return ids.map((id, i) => (f.orphansOnly ? deg[i] === 0 : f.showOrphans || deg[i] > 0) && (!f.match || f.match.has(id)))
}

/** Direct neighbours of node `i`. */
export function neighbours(edges: [number, number][], i: number): Set<number> {
  const out = new Set<number>()
  if (i < 0) return out
  for (const [a, b] of edges) {
    if (a === i) out.add(b)
    else if (b === i) out.add(a)
  }
  return out
}
