import type { ImageMetadata } from 'astro'
import editor from '../assets/screenshots/editor.png'
import graph from '../assets/screenshots/graph.png'
import search from '../assets/screenshots/search.png'
import settings from '../assets/screenshots/settings.png'

export interface Feature {
  id: string
  title: string
  body: string
  image: ImageMetadata
  alt: string
  /** CSS object-position for the crop shown in the feature stage. */
  focus: string
}

export const features: readonly Feature[] = [
  {
    id: 'live-preview',
    title: 'Markdown that gets out of the way',
    body: 'Live Preview hides the syntax except on the line you are editing. Tables are edited as tables, LaTeX renders as you type, and the file on disk stays plain Markdown.',
    image: editor,
    alt: 'A note in the Synapse editor with headings, a wiki link, a table and task checkboxes rendered in place',
    focus: '50% 30%',
  },
  {
    id: 'backlinks',
    title: 'Every note that links here',
    body: 'Backlinks show the line around each mention, unlinked mentions find the ones you forgot to link, and outgoing links list what this note points to.',
    image: editor,
    alt: 'The backlinks panel listing four notes that link to Spaced repetition, each with its surrounding text',
    focus: '100% 20%',
  },
  {
    id: 'graph',
    title: 'See the shape of your thinking',
    body: 'The graph draws every note and link in the vault. Drag, zoom and click a node to open it; orphans and unresolved links can be shown or hidden.',
    image: graph,
    alt: 'Graph view of a vault with notes as nodes connected by their links',
    focus: '60% 40%',
  },
  {
    id: 'search',
    title: 'Find it in a second',
    body: 'Search every note with "phrases", -exclusions, tag:, path: and file:. Results show the matching line; ⌘O jumps to any note by name.',
    image: search,
    alt: 'Search results with the matching lines and the search term highlighted',
    focus: '0% 20%',
  },
  {
    id: 'preferences',
    title: 'One set of preferences',
    body: 'Theme, fonts, editor and hotkeys are global, so switching vaults never resets them. Any single setting can still be overridden for one vault.',
    image: settings,
    alt: 'Synapse settings, where each preference has a scope menu for all vaults or this vault only',
    focus: '50% 40%',
  },
]
