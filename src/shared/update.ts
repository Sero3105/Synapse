// Update check against GitHub Releases. Pure helpers here; the network call lives in main.

export const RELEASES_API = 'https://api.github.com/repos/Sero3105/Synapse/releases/latest'

export interface UpdateInfo {
  version: string
  /** Release page on github.com, opened in the browser. */
  url: string
}

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
export function updateFromRelease(json: unknown, current: string): UpdateInfo | null {
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
  return { version: tag.replace(/^v/, ''), url: u.toString() }
}
