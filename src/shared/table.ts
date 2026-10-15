// GitHub-flavoured Markdown tables <-> cell grid, for the live-preview table editor.

export interface Table {
  header: string[]
  /** delimiter cells as written (keeps alignment colons) */
  delimiter: string[]
  rows: string[][]
}

/** Split one table line on unescaped pipes; outer pipes are optional. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (c === '|') {
      cells.push(cur)
      cur = ''
    } else cur += c
  }
  cells.push(cur)
  return cells.map((c) => c.trim().replace(/\\\|/g, '|'))
}

export function parseTable(text: string): Table | null {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return null
  const header = splitRow(lines[0])
  const delimiter = splitRow(lines[1])
  if (!delimiter.every((d) => /^:?-+:?$/.test(d.replace(/\s/g, '')))) return null
  const width = header.length
  const fit = (r: string[]) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')])
  return { header, delimiter: fit(delimiter).map((d) => d || '---'), rows: lines.slice(2).map((l) => fit(splitRow(l))) }
}

const cell = (s: string) => s.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim()

export function formatTable(t: Table): string {
  const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`
  return [row(t.header), `| ${t.delimiter.join(' | ')} |`, ...t.rows.map(row)].join('\n')
}
