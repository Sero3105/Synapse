# Synapse website

The original Synapse site (as published at synapse-bxv.pages.dev), kept as a
static mirror with small UI refinements on top. No build step.

## Run locally

```sh
python3 -m http.server 4173 --directory sito
# open http://localhost:4173/
```

## Deploy (Cloudflare Pages)

- **Build command:** none
- **Build output directory:** `sito`

## What differs from the original

- `assets/polish.css` — the only added stylesheet, loaded by the home and
  download pages after the original CSS. It fixes the pinned screenshot
  gallery (the frame now starts below the header, the title is capped, and
  photo sizes account for the caption, so nothing is clipped), adds a header
  hairline, and gives screenshots, cards and rows a quiet shadow and hover.
  Original animations (hero seam, pinned story, pinned screenshot pan,
  graph playground, reveal on scroll) are untouched.
- Version strings updated from 1.3.0 / "Coming in 1.3.1" to the published
  1.4.0 release (25 October 2026, arm64 132 MB, x64 139 MB), whose feature
  set includes everything the site used to announce as upcoming.
