// Markdown checklist items ("- [ ] task") across notes. Pure helpers, no I/O.

export interface Task {
  /** 0-based line in the note */
  line: number
  text: string
  done: boolean
  /** leading whitespace width (tabs count 4), for showing nesting */
  indent: number
  /** the whole source line, used to check it is unchanged before toggling */
  raw: string
}

// Same shape the reading view turns into a checkbox: list marker, "[ ]"/"[x]"/"[X]", whitespace, text.
// Blockquoted tasks ("> - [ ] x") count too.
const TASK = /^((?:[ \t]*>)*([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[)( |x|X)(\][ \t]+)(\S.*?)\r?$/
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/

export function parseTasks(content: string): Task[] {
  const lines = content.split('\n')
  const out: Task[] = []
  let i = 0
  // frontmatter, same rule as the reading view: "---" on line 1 up to the next "---"
  if (/^---\r?$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, j) => j > 0 && /^---\s*$/.test(l))
    if (end > 0) i = end + 1
  }
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const l = lines[i]
    const f = FENCE.exec(l)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !l.slice(f[0].length).trim()) fence = null
      continue
    }
    if (f) {
      fence = f[1]
      continue
    }
    const m = TASK.exec(l)
    if (m) out.push({ line: i, text: m[5], done: m[3] !== ' ', indent: m[2].replace(/\t/g, '    ').length, raw: l })
  }
  return out
}

/**
 * Flip the checkbox on `line`. Returns null (no change) when that line is no longer exactly
 * `expectedRaw` or no longer a task, so a stale list can never touch a different line.
 */
export function toggleTaskLine(content: string, line: number, expectedRaw: string): string | null {
  const lines = content.split('\n')
  if (lines[line] !== expectedRaw || !parseTasks(content).some((t) => t.line === line)) return null
  const m = TASK.exec(expectedRaw)!
  const at = m[1].length
  lines[line] = expectedRaw.slice(0, at) + (m[3] === ' ' ? 'x' : ' ') + expectedRaw.slice(at + 1)
  return lines.join('\n')
}
