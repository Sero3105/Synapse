// Update check against GitHub Releases. Pure helpers here; the network call lives in main.

export const RELEASES_API = 'https://api.github.com/repos/Sero3105/Synapse/releases/latest'

export interface UpdateInfo {
  version: string
  /** Release page on github.com, opened in the browser. */
  url: string
  /** Signed app zip for this Mac's arch, when the release carries one (in-app install). */
  zip?: string
  sig?: string
}

/** Release signing key (ed25519, SPKI DER, base64). The private half lives outside the repo, see scripts/sign-update.mjs. */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAx+B54y4FFcobCM+iV9yfcj/AQ4GuZpbV2/XrXdWLMLA='

export const zipName = (version: string, arch: string) => `Synapse-${version}-${arch}.zip`

/** "v1.2.0" / "1.2.0" -> [1, 2, 0]; null for anything else (pre-releases are ignored). */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/** Read the GitHub "latest release" payload; only a newer, non-draft release on github.com counts. */
export function updateFromRelease(json: unknown, current: string, arch = 'arm64'): UpdateInfo | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft === true || r.prerelease === true) return null
  const tag = typeof r.tag_name === 'string' ? r.tag_name : ''
  const url = typeof r.html_url === 'string' ? r.html_url : ''
  if (!isNewer(tag, current)) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null
  const version = tag.replace(/^v/, '')
  const info: UpdateInfo = { version, url: u.toString() }
  const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : []
  const asset = (name: string) => {
    const a = assets.find((x) => x && x.name === name)
    const href = a && typeof a.browser_download_url === 'string' ? a.browser_download_url : ''
    return href.startsWith('https://github.com/') ? href : undefined
  }
  const zip = asset(zipName(version, arch))
  const sig = asset(`${zipName(version, arch)}.sig`)
  if (zip && sig) Object.assign(info, { zip, sig })
  return info
}
