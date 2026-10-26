import { describe, it, expect } from 'vitest'
import { parseTasks, toggleTaskLine } from '../src/shared/tasks'

const pick = (s: string) => parseTasks(s).map((t) => [t.line, t.text, t.done])

describe('parseTasks', () => {
  it('finds open and completed tasks with every list marker, nested and in sections', () => {
    const note = '# Plan\n- [ ] a\n  - [x] b\n\t* [X] c\n## Later\n+ [ ] d\n1. [ ] e\n2) [x] f\n> - [ ] quoted\n'
    expect(pick(note)).toEqual([
      [1, 'a', false],
      [2, 'b', true],
      [3, 'c', true],
      [5, 'd', false],
      [6, 'e', false],
      [7, 'f', true],
      [8, 'quoted', false],
    ])
    expect(parseTasks(note).map((t) => t.indent)).toEqual([0, 2, 4, 0, 0, 0, 1])
  })

  it('ignores malformed items and tasks inside code fences or frontmatter', () => {
    const note = '---\ntodo: - [ ] fm\n---\n-[ ] no space\n- [y] wrong\n- [ ]\n- [ ]no gap\n```\n- [ ] code\n```\n~~~~md\n- [ ] tilde\n~~~\n- [ ] still code\n~~~~\nplain [ ] text\n- [ ] real\n'
    expect(pick(note)).toEqual([[16, 'real', false]])
  })

  it('handles CRLF line endings and empty notes', () => {
    expect(pick('- [ ] a\r\n- [x] b\r\n')).toEqual([
      [0, 'a', false],
      [1, 'b', true],
    ])
    expect(parseTasks('')).toEqual([])
  })
})

describe('toggleTaskLine', () => {
  it('flips only the given line, even when another task has the same text', () => {
    const note = '- [ ] same\n- [ ] same\n'
    const [, second] = parseTasks(note)
    expect(toggleTaskLine(note, second.line, second.raw)).toBe('- [ ] same\n- [x] same\n')
  })

  it('unchecks completed tasks and preserves formatting and CRLF', () => {
    const note = 'x\r\n  1. [X] **bold** `code`  \r\nend'
    const [task] = parseTasks(note)
    expect(toggleTaskLine(note, task.line, task.raw)).toBe('x\r\n  1. [ ] **bold** `code`  \r\nend')
  })

  it('refuses when the line changed since the list was built (external edit)', () => {
    const note = '- [ ] a\n- [ ] b\n'
    const [, b] = parseTasks(note)
    expect(toggleTaskLine('new first line\n- [ ] a\n- [ ] b\n', b.line, b.raw)).toBeNull()
    expect(toggleTaskLine('- [ ] a\n- [ ] b edited\n', b.line, b.raw)).toBeNull()
    expect(toggleTaskLine('- [ ] a\n', b.line, b.raw)).toBeNull()
  })

  it('refuses when the same text is now inside a code block', () => {
    const note = '- [ ] a\n'
    const [a] = parseTasks(note)
    expect(toggleTaskLine('```\n- [ ] a\n```\n', 1, a.raw)).toBeNull()
    expect(toggleTaskLine(note, 0, a.raw)).toBe('- [x] a\n')
  })
})
