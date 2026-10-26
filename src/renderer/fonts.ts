// Fonts for notes and code: a curated list of popular families (shown only when installed on this Mac)
// plus fonts the user added, which are loaded from the app-data folder as FontFace objects.
import { api, type CustomFont } from './api'

/** Popular families, grouped; each appears in the picker only if this Mac has it. */
export const FONT_GROUPS = {
  serif: [
    'Charter', 'Iowan Old Style', 'Georgia', 'Palatino', 'Baskerville', 'Times New Roman', 'Didot', 'Bodoni 72',
    'Cochin', 'Athelas', 'PT Serif', 'STIX Two Text', 'Literata', 'Merriweather', 'Source Serif 4', 'Lora', 'EB Garamond',
  ],
  sans: [
    'Helvetica Neue', 'Helvetica', 'Avenir Next', 'Avenir', 'Futura', 'Gill Sans', 'Optima', 'Seravek', 'Verdana',
    'Trebuchet MS', 'Arial', 'Lucida Grande', 'PT Sans', 'Inter', 'Roboto',
    'Open Sans', 'Lato', 'Source Sans 3', 'IBM Plex Sans', 'Atkinson Hyperlegible',
  ],
  display: [
    'American Typewriter', 'Marker Felt', 'Chalkboard SE', 'Noteworthy', 'Bradley Hand', 'Snell Roundhand', 'Apple Chancery',
    'Zapfino', 'Copperplate', 'Luminari', 'Comic Sans MS', 'Impact', 'Papyrus',
  ],
  mono: [
    'SF Mono', 'Menlo', 'Monaco', 'Courier New', 'JetBrains Mono', 'Fira Code',
    'IBM Plex Mono', 'Source Code Pro', 'Cascadia Code',
  ],
} as const

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, boolean>()
const SAMPLE = 'mmmmmmmmmmlliWWWQ@#0123456789'

/**
 * True when the family resolves to a real font: its width differs from at least one generic fallback.
 * shortcut: metric-compatible families (e.g. Arial vs Helvetica) can be missed; the picker always
 * shows the currently selected family, and custom fonts are listed from the store, not detected here.
 */
export function isInstalled(family: string): boolean {
  const hit = cache.get(family)
  if (hit !== undefined) return hit
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return true
  const width = (font: string) => {
    ctx!.font = `48px ${font}`
    return ctx!.measureText(SAMPLE).width
  }
  const ok = ['monospace', 'serif', 'sans-serif'].some((g) => width(`"${family}", ${g}`) !== width(g))
  cache.set(family, ok)
  return ok
}

const faces = new Map<string, FontFace>()

/** Stored fonts Chromium refused to load (broken or unsupported compression); shown as unavailable in the picker. */
export const unloadableFonts = new Set<string>()

/** Register every added font with the document (once each), and drop removed ones. */
export async function loadCustomFonts(): Promise<CustomFont[]> {
  const list = await api.fonts()
  const ids = new Set(list.map((f) => f.id))
  for (const [id, face] of faces) if (!ids.has(id)) {
    document.fonts.delete(face)
    faces.delete(id)
    unloadableFonts.delete(id)
  }
  for (const f of list) {
    if (faces.has(f.id)) continue
    try {
      const data = await api.fontData(f.id)
      const face = new FontFace(f.family, new Uint8Array(data), { weight: String(f.weight), style: f.style })
      await face.load() // Chromium sanitizes the font here; a broken file is rejected, not rendered
      document.fonts.add(face)
      faces.set(f.id, face)
      unloadableFonts.delete(f.id)
      cache.delete(f.family)
    } catch (e) {
      unloadableFonts.add(f.id)
      console.warn('font not loaded', f.id, e)
    }
  }
  return list
}
