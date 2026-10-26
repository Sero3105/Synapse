import { describe, it, expect } from 'vitest'
import { isoDate, fillTemplate, dailyNotePath, adjacentDaily, dailyDate, BUILTIN_TEMPLATES } from '../src/shared/templates'
import { DICTIONARIES } from '../src/shared/i18n'

const now = new Date(2026, 0, 5, 9, 7)

describe('templates', () => {
  it('formats local dates as YYYY-MM-DD', () => {
    expect(isoDate(now)).toBe('2026-01-05')
    expect(isoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('fills known placeholders and leaves the rest', () => {
    expect(fillTemplate('# {{title}}\n{{ date }} {{TIME}} {{other}} {single}', { title: 'Plan', now })).toBe('# Plan\n2026-01-05 09:07 {{other}} {single}')
  })

  it('does not reinterpret placeholder-like text in the title', () => {
    expect(fillTemplate('{{title}} {{date}}', { title: '{{date}} $&', now })).toBe('{{date}} $& 2026-01-05')
  })

  it('every built-in template exists in every language and uses only known placeholders', () => {
    for (const dict of Object.values(DICTIONARIES))
      for (const id of BUILTIN_TEMPLATES) {
        const body = dict[`template.${id}.body`]
        expect(body).toContain('{{title}}')
        expect(fillTemplate(body, { title: 'T', now })).not.toMatch(/\{\{/)
      }
  })
})

describe('daily notes', () => {
  it('recognizes daily note names', () => {
    expect(dailyDate('Daily/2026-01-05.md')).toBe('2026-01-05')
    expect(dailyDate('2026-01-05 notes.md')).toBeNull()
    expect(dailyDate('2026-1-5.md')).toBeNull()
  })

  it('opens an existing note instead of creating a duplicate, wherever it is', () => {
    expect(dailyNotePath(['a.md', 'Journal/2026-01-05.md'], '2026-01-05')).toEqual({ path: 'Journal/2026-01-05.md', exists: true })
  })

  it('creates new daily notes next to the latest one, or at the vault root', () => {
    expect(dailyNotePath([], '2026-01-05')).toEqual({ path: '2026-01-05.md', exists: false })
    expect(dailyNotePath(['Daily/2026-01-03.md', 'Old/2025-01-01.md'], '2026-01-05')).toEqual({ path: 'Daily/2026-01-05.md', exists: false })
  })

  it('ignores the Templates folder', () => {
    expect(dailyNotePath(['Templates/2026-01-05.md'], '2026-01-05')).toEqual({ path: '2026-01-05.md', exists: false })
  })

  it('always yields a vault-relative path', () => {
    for (const files of [[], ['a/b/2026-01-01.md']]) {
      const p = dailyNotePath(files, '2026-01-05').path
      expect(p.startsWith('/') || p.split('/').includes('..')).toBe(false)
    }
  })

  it('finds the previous and next existing daily notes', () => {
    const files = ['2026-01-01.md', 'Daily/2026-01-04.md', '2026-01-09.md', 'note.md']
    expect(adjacentDaily(files, '2026-01-05', -1)).toBe('Daily/2026-01-04.md')
    expect(adjacentDaily(files, '2026-01-04', 1)).toBe('2026-01-09.md')
    expect(adjacentDaily(files, '2026-01-01', -1)).toBeNull()
    expect(adjacentDaily(files, '2026-01-09', 1)).toBeNull()
  })
})
