import { describe, it, expect } from 'vitest'
import { remember, splitRecent, MAX_RECENT } from '../src/shared/recent'

const cmds = (...ids: string[]) => ids.map((id) => ({ id }))

describe('recent commands', () => {
  it('moves a command run again to the front without duplicating it, and caps the list', () => {
    let r: string[] = []
    for (const id of ['a', 'b', 'c', 'a']) r = remember(r, id)
    expect(r).toEqual(['a', 'c', 'b'])
    for (const id of ['d', 'e', 'f', 'g']) r = remember(r, id)
    expect(r).toHaveLength(MAX_RECENT)
    expect(r).toEqual(['g', 'f', 'e', 'd', 'a'])
  })

  it('shows recent commands once, first, and only while they are available', () => {
    const { recent, rest } = splitRecent(cmds('a', 'b', 'c', 'd'), ['c', 'gone', 'a'])
    expect(recent.map((c) => c.id)).toEqual(['c', 'a'])
    expect(rest.map((c) => c.id)).toEqual(['b', 'd'])
  })

  it('handles no history and no commands', () => {
    expect(splitRecent(cmds('a'), [])).toEqual({ recent: [], rest: [{ id: 'a' }] })
    expect(splitRecent([], ['a'])).toEqual({ recent: [], rest: [] })
  })
})
