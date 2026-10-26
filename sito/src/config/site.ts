// Single source for product facts and external URLs. Every value here was checked against the
// repository or the GitHub Releases API; update it when a new release is published (see README.md).

export const product = {
  name: 'Synapse',
  tagline: 'Local-first Markdown notes for macOS',
  description:
    'Synapse is a calm, local-first Markdown workspace for connected notes on macOS. Notes stay plain files in folders you own, and your preferences follow you across every vault.',
  license: 'MIT',
} as const

const repo = 'https://github.com/Sero3105/Synapse'

export const links = {
  repo,
  repoLabel: 'github.com/Sero3105/Synapse',
  releases: `${repo}/releases`,
  issues: `${repo}/issues`,
  license: `${repo}/blob/main/LICENSE`,
  security: `${repo}/blob/main/SECURITY.md`,
  docs: '/docs/',
  download: '/download/',
} as const

export interface ReleaseAsset {
  fileName: string
  url: string
  sizeBytes: number
  /** Human-readable platform, e.g. "macOS 13 Ventura or later". */
  system: string
  arch: string
}

export interface Release {
  version: string
  /** ISO date of publication on GitHub Releases. */
  publishedAt: string
  notesUrl: string
  assets: readonly ReleaseAsset[]
}

/**
 * Latest release published on GitHub. Set to `null` to show the "not available yet" state.
 * Values from https://api.github.com/repos/Sero3105/Synapse/releases (checked 2026-10-26, after publishing v1.4.0).
 */
export const latestRelease: Release | null = {
  version: '1.4.0',
  publishedAt: '2026-10-25',
  notesUrl: `${repo}/releases/tag/v1.4.0`,
  assets: [
    {
      fileName: 'Synapse-1.4.0-arm64.dmg',
      url: `${repo}/releases/download/v1.4.0/Synapse-1.4.0-arm64.dmg`,
      sizeBytes: 132_191_302,
      system: 'macOS 13 Ventura or later',
      arch: 'Apple silicon (arm64)',
    },
    {
      fileName: 'Synapse-1.4.0-x64.dmg',
      url: `${repo}/releases/download/v1.4.0/Synapse-1.4.0-x64.dmg`,
      sizeBytes: 139_065_012,
      system: 'macOS 13 Ventura or later',
      arch: 'Intel (x64), not yet tested on Intel hardware',
    },
  ],
}

/** Earlier published releases, newest first. */
export const previousReleases: readonly { version: string; publishedAt: string }[] = [
  { version: '1.3.0', publishedAt: '2026-10-23' },
  { version: '1.1.0', publishedAt: '2026-10-15' },
  { version: '1.0.0', publishedAt: '2026-10-15' },
]

export const nav = [
  { label: 'Features', href: '/#features' },
  { label: 'Docs', href: links.docs },
  { label: 'Download', href: links.download },
] as const
