import { describe, expect, it } from 'vitest'
import { isNewer, parseVersion, updateFromRelease } from '../src/shared/update'

describe('update check', () => {
  it('parses plain and v-prefixed versions only', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0])
    expect(parseVersion('1.2.0-beta.1')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })

  it('compares numerically, not as text', () => {
    expect(isNewer('v1.10.0', '1.9.9')).toBe(true)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.2.0', '1.2.0')).toBe(false)
    expect(isNewer('1.1.0', '1.2.0')).toBe(false)
    expect(isNewer('garbage', '1.0.0')).toBe(false)
  })

  it('accepts only a newer, published release on github.com', () => {
    const ok = { tag_name: 'v1.3.0', html_url: 'https://github.com/Sero3105/Synapse/releases/tag/v1.3.0', draft: false, prerelease: false }
    expect(updateFromRelease(ok, '1.2.0')).toEqual({ version: '1.3.0', url: ok.html_url })
    expect(updateFromRelease(ok, '1.3.0')).toBeNull()
    expect(updateFromRelease({ ...ok, prerelease: true }, '1.2.0')).toBeNull()
    expect(updateFromRelease({ ...ok, html_url: 'https://evil.example/x' }, '1.2.0')).toBeNull()
    expect(updateFromRelease({ ...ok, html_url: 'javascript:alert(1)' }, '1.2.0')).toBeNull()
    expect(updateFromRelease(null, '1.2.0')).toBeNull()
  })
})
