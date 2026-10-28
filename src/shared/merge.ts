// Line-based three-way merge: base is the last version both sides started from.
// Clean regions merge themselves; regions both sides changed differently come
// back as conflict parts for the user to pick from. Nothing is ever guessed.

export type MergePart = { text: string[] } | { mine: string[]; theirs: string[] }

export interface MergeResult {
  parts: MergePart[]
  conflicts: number
}

const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** base index -> other index for lines matched by the longest common subsequence. */
// shortcut: the DP table is capped; past ~2000x2000 lines there are no anchors and
// the whole note falls back to a single conflict instead of merging blind.
function lcsMatches(a: string[], b: string[]): Map<number, number> {
  const out = new Map<number, number>()
  if (!a.length || !b.length || a.length * b.length > 4_000_000) return out
  const w = b.length + 1
  const dp = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.set(i, j)
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return out
}

export function merge3(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs || theirs === base) return { parts: [{ text: mine.split('\n') }], conflicts: 0 }
  if (mine === base) return { parts: [{ text: theirs.split('\n') }], conflicts: 0 }
  const b = base.split('\n')
  const m = mine.split('\n')
  const t = theirs.split('\n')
  const inMine = lcsMatches(b, m)
  const inTheirs = lcsMatches(b, t)
  const parts: MergePart[] = []
  const text = (lines: string[]) => {
    if (!lines.length) return
    const last = parts[parts.length - 1]
    if (last && 'text' in last) last.text.push(...lines)
    else parts.push({ text: [...lines] })
  }
  const region = (rb: string[], rm: string[], rt: string[]) => {
    if (eq(rm, rb)) text(rt)
    else if (eq(rt, rb) || eq(rm, rt)) text(rm)
    else parts.push({ mine: rm, theirs: rt })
  }
  // Anchors are base lines matched on both sides; the region before each anchor
  // (and after the last) is resolved on its own.
  let i = 0
  let j = 0
  let k = 0
  const anchors = [...inMine.keys()].filter((x) => inTheirs.has(x)).sort((x, y) => x - y)
  for (const bi of [...anchors, b.length]) {
    const bj = bi === b.length ? m.length : inMine.get(bi)!
    const bk = bi === b.length ? t.length : inTheirs.get(bi)!
    region(b.slice(i, bi), m.slice(j, bj), t.slice(k, bk))
    if (bi < b.length) {
      text([b[bi]])
      i = bi + 1
      j = bj + 1
      k = bk + 1
    }
  }
  return { parts, conflicts: parts.filter((p) => 'mine' in p).length }
}

/** Join parts into the final text, taking `choices[n]` ('mine' by default) for the n-th conflict. */
export function assembleMerge(parts: MergePart[], choices: ('mine' | 'theirs')[]): string {
  let c = 0
  const out: string[] = []
  for (const p of parts) out.push(...('text' in p ? p.text : (choices[c++] ?? 'mine') === 'mine' ? p.mine : p.theirs))
  return out.join('\n')
}
