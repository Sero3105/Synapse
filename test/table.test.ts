import { describe, it, expect } from 'vitest'
import { parseTable, formatTable, splitRow, insertColumn, deleteColumn } from '../src/shared/table'

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
  it('inserts a column to the right, keeping other cells and alignment', () => {
    const t = parseTable('| Name | Qty |\n|:---|---:|\n| apple | 3 |')!
    const next = insertColumn(t, 0)
    expect(formatTable(next)).toBe('| Name |  | Qty |\n| :--- | --- | ---: |\n| apple |  | 3 |')
    expect(formatTable(t)).toBe('| Name | Qty |\n| :--- | ---: |\n| apple | 3 |') // original untouched
  })
  it('deletes a column, and refuses to delete the last one', () => {
    const t = parseTable('| Name | Qty | Note |\n|---|---|---|\n| apple | 3 | red |')!
    expect(formatTable(deleteColumn(t, 1)!)).toBe('| Name | Note |\n| --- | --- |\n| apple | red |')
    const one = parseTable('| Name |\n|---|\n| apple |')!
    expect(deleteColumn(one, 0)).toBeNull()
  })
  it('rejects text that is not a table', () => {
    expect(parseTable('| a | b |\nnot a delimiter')).toBeNull()
    expect(parseTable('just text')).toBeNull()
  })
})
