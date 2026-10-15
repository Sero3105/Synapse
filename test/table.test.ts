import { describe, it, expect } from 'vitest'
import { parseTable, formatTable, splitRow } from '../src/shared/table'

describe('tables', () => {
  it('parses header, alignment and rows, tolerating missing outer pipes and short rows', () => {
    const t = parseTable('| Name | Qty |\n|:---|---:|\n| apple | 3 |\npear |')!
    expect(t.header).toEqual(['Name', 'Qty'])
    expect(t.delimiter).toEqual([':---', '---:'])
    expect(t.rows).toEqual([['apple', '3'], ['pear', '']])
  })
  it('round-trips escaped pipes', () => {
    expect(splitRow('| a \\| b | c |')).toEqual(['a | b', 'c'])
    const t = parseTable('| a | b |\n|---|---|\n| x | y |')!
    t.rows[0][0] = 'x | z'
    expect(formatTable(t)).toBe('| a | b |\n| --- | --- |\n| x \\| z | y |')
  })
  it('rejects text that is not a table', () => {
    expect(parseTable('| a | b |\nnot a delimiter')).toBeNull()
    expect(parseTable('just text')).toBeNull()
  })
})
