import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { isNewer, parseVersion, updateFromRelease } from '../src/shared/update'
import { verifySignature } from '../src/main/updater'

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

describe('in-app update', () => {
  const release = (assets: { name: string; browser_download_url: string }[]) => ({
    tag_name: 'v1.5.0', html_url: 'https://github.com/Sero3105/Synapse/releases/tag/v1.5.0', draft: false, prerelease: false, assets,
  })
  const dl = (name: string) => ({ name, browser_download_url: `https://github.com/Sero3105/Synapse/releases/download/v1.5.0/${name}` })

  it('offers the signed zip for this arch only when both zip and signature are on github.com', () => {
    const both = updateFromRelease(release([dl('Synapse-1.5.0-arm64.zip'), dl('Synapse-1.5.0-arm64.zip.sig')]), '1.4.0', 'arm64')
    expect(both?.zip).toMatch(/arm64\.zip$/)
    expect(both?.sig).toMatch(/\.sig$/)
    expect(updateFromRelease(release([dl('Synapse-1.5.0-arm64.zip')]), '1.4.0', 'arm64')?.zip).toBeUndefined()
    expect(updateFromRelease(release([dl('Synapse-1.5.0-arm64.zip'), dl('Synapse-1.5.0-arm64.zip.sig')]), '1.4.0', 'x64')?.zip).toBeUndefined()
    const evil = [{ name: 'Synapse-1.5.0-arm64.zip', browser_download_url: 'https://evil.example/x.zip' }, dl('Synapse-1.5.0-arm64.zip.sig')]
    expect(updateFromRelease(release(evil), '1.4.0', 'arm64')?.zip).toBeUndefined()
  })

  it('accepts only data signed by the matching key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
    const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const data = Buffer.from('zip bytes')
    const sig = crypto.sign(null, data, privateKey).toString('base64')
    expect(verifySignature(data, sig, pub)).toBe(true)
    expect(verifySignature(Buffer.from('zip bytez'), sig, pub)).toBe(false)
    expect(verifySignature(data, 'garbage', pub)).toBe(false)
    expect(verifySignature(data, sig)).toBe(false) // the real release key did not sign this
  })
})
