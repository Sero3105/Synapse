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

/**
 * Local graph: nodes within `depth` links of `center`, walking only through nodes `base` shows (the
 * filtered graph), so every node drawn is connected to the centre by drawn links. The centre always shows.
 */
export function localNodes(edges: [number, number][], base: boolean[], center: number, depth: number): boolean[] {
  const out = base.map(() => false)
  if (center < 0 || center >= base.length) return out
  const adj: number[][] = base.map(() => [])
  for (const [a, b] of edges) {
    adj[a].push(b)
    adj[b].push(a)
  }
  out[center] = true
  let frontier = [center]
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = []
    for (const i of frontier) for (const j of adj[i]) if (base[j] && !out[j]) (out[j] = true), next.push(j)
    frontier = next
  }
  return out
}

/** Distinct hues that read on light and dark pages; violet is left out, it is the focus accent. */
// neighbours in the list are far apart in hue, so the first groups never look alike
export const GROUP_COLORS = ['#e5484d', '#0090ff', '#e2a336', '#46a758', '#d6409f', '#12a594', '#f76b15', '#a07553']

/** A further distinct colour for group `i` past the palette: hues spread by the golden angle. */
export function extraColor(i: number): string {
  const h = (i * 137.508 + 20) % 360
  const sat = 0.62
  const light = 0.52
  const a = sat * Math.min(light, 1 - light)
  // standard HSL -> RGB
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * Colour groups: each note's key (folder, tag…) or null. Every key gets a colour: the user's own if
 * set, else the palette in order of group size (ties by name), then generated hues; so colours stay
 * put as long as the vault does. The legend lists them all, biggest first.
 */
export function colorGroups(keys: (string | null)[], custom: Record<string, string> = {}, palette = GROUP_COLORS): { color: Map<string, string>; legend: { key: string; color: string; count: number; custom: boolean }[] } {
  const counts = new Map<string, number>()
  for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  const legend = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count], i) => ({ key, color: custom[key] ?? palette[i] ?? extraColor(i), count, custom: key in custom }))
  return { color: new Map(legend.map((l) => [l.key, l.color])), legend }
}
