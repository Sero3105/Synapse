import { describe, it, expect } from 'vitest'
import { merge3, assembleMerge } from '../src/shared/merge'

describe('merge3', () => {
  it('merges edits in different places', () => {
    const r = merge3('a\nb\nc\nd\ne', 'A\nb\nc\nd\ne', 'a\nb\nc\nd\nE')
    expect(r.conflicts).toBe(0)
    expect(assembleMerge(r.parts, [])).toBe('A\nb\nc\nd\nE')
  })
  it('merges an insertion on one side with an edit on the other', () => {
    const r = merge3('a\nb\nc', 'a\nnew line\nb\nc', 'a\nb\nC')
    expect(r.conflicts).toBe(0)
    expect(assembleMerge(r.parts, [])).toBe('a\nnew line\nb\nC')
  })
  it('takes an identical change made on both sides once', () => {
    const r = merge3('a\nb', 'a\nB', 'a\nB')
    expect(r.conflicts).toBe(0)
    expect(assembleMerge(r.parts, [])).toBe('a\nB')
  })
  it('conflicts when both sides change the same line differently', () => {
    const r = merge3('a\nb\nc', 'a\nmine\nc', 'a\ntheirs\nc')
    expect(r.conflicts).toBe(1)
    expect(assembleMerge(r.parts, ['mine'])).toBe('a\nmine\nc')
    expect(assembleMerge(r.parts, ['theirs'])).toBe('a\ntheirs\nc')
  })
  it('conflicts when both sides append different lines, merges when only one does', () => {
    expect(merge3('a', 'a\nmine', 'a\ntheirs').conflicts).toBe(1)
    const r = merge3('a', 'a\nmine', 'a')
    expect(r.conflicts).toBe(0)
    expect(assembleMerge(r.parts, [])).toBe('a\nmine')
  })
  it('conflicts when one side deletes a line the other edited', () => {
    const r = merge3('a\nb\nc', 'a\nc', 'a\nB\nc')
    expect(r.conflicts).toBe(1)
    expect(assembleMerge(r.parts, ['mine'])).toBe('a\nc')
    expect(assembleMerge(r.parts, ['theirs'])).toBe('a\nB\nc')
  })
  it('merges a deletion with an edit elsewhere, and handles no changes', () => {
    const r = merge3('a\nb\nc\nd', 'a\nc\nd', 'a\nb\nc\nD')
    expect(r.conflicts).toBe(0)
    expect(assembleMerge(r.parts, [])).toBe('a\nc\nD')
    const same = merge3('x\ny', 'x\ny', 'x\ny')
    expect(same.conflicts).toBe(0)
    expect(assembleMerge(same.parts, [])).toBe('x\ny')
  })
  it('handles several conflicts with independent choices', () => {
    const r = merge3('1\n2\n3\n4\n5', '1\nM\n3\n4\nM', '1\nT\n3\n4\nT')
    expect(r.conflicts).toBe(2)
    expect(assembleMerge(r.parts, ['theirs', 'mine'])).toBe('1\nT\n3\n4\nM')
  })
})
