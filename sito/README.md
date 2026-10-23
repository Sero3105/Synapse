# Synapse website

The public website and documentation for [Synapse](https://github.com/Sero3105/Synapse), built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). It is a static site, independent of the app: it has its own `package.json`, and nothing here is part of the Electron build.

## Requirements

Node.js 22.23.4 or newer (required by Astro 7). The version is pinned in `.node-version`, which Cloudflare Pages and version managers such as nvm, fnm and asdf read automatically.

## Commands

Run them from this folder (`sito/`):

```sh
npm install        # install dependencies (only inside sito/)
npm run dev        # local server with hot reload at http://localhost:4321
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm run check      # TypeScript and Astro diagnostics
```

## Structure

```
sito/
  astro.config.mjs           Astro + Starlight configuration, sidebar
  public/                    favicon
  src/
    config/site.ts           product facts, every external URL, the latest release
    data/                    homepage content: feature bands, FAQ, sample vault
    lib/                     small helpers (formatting, the [[ link matcher)
    layouts/SiteLayout.astro shell of the marketing pages: meta tags, header, footer
    components/              one component per homepage section, header, footer
    pages/                   index (home), download, 404, robots.txt
    content/docs/docs/       documentation pages (Markdown), served under /docs/
    styles/                  brand tokens, marketing styles, Starlight theme
    assets/                  app screenshots and icon, optimised at build time
```

The homepage and the Download page are plain Astro pages. The documentation uses Starlight under `/docs/` with the same tokens, so both share colours and type. Client-side JavaScript is limited to three small scripts: the feature switches, the `[[` link demo and the scroll effects. Everything works without it.

## Updating for a new release

All release data lives in `src/config/site.ts`:

1. Publish the release on GitHub with its DMG.
2. In `latestRelease`, update `version`, `publishedAt`, `notesUrl` and the asset (`fileName`, `url`, `sizeBytes`). Get exact values from `https://api.github.com/repos/Sero3105/Synapse/releases`.
3. Move the previous version into `previousReleases`.
4. If the release adds an Intel build, add a second entry to `assets` and update the Intel notes in `src/data/faq.ts`, `src/pages/download.astro` and the docs (`installation.md`, `troubleshooting.md`, `faq.md`, `releases.md`).

If `latestRelease` is `null`, the Download page shows that no build is published instead of a button.

## Domain, canonical URLs and sitemap

The public domain is not decided yet. Build with `SITE_URL` set to add canonical URLs, Open Graph images, `sitemap-index.xml` and its line in `robots.txt`:

```sh
SITE_URL=https://synapse.pages.dev npm run build
```

Without it, the build leaves those out and Astro prints one warning that the sitemap was skipped.

## Publish for free on Cloudflare Pages

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, and choose this repository.
2. Build settings:
   - Framework preset: **Astro**
   - Root directory: `sito`
   - Build command: `npm run build`
   - Build output directory: `dist`
3. Environment variables: `SITE_URL` = your Pages URL (for example `https://synapse.pages.dev`) or custom domain. Node.js comes from `sito/.node-version`; if you also set `NODE_VERSION`, it must be `22.23.4` or newer, because it takes precedence over the file.
4. Deploy. Every push to `main` then rebuilds the site.

Any other static host works the same way: build in `sito/` and serve `dist/`. On GitHub Pages under a sub-path, also set `base` in `astro.config.mjs`.
