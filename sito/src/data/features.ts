import type { ImageMetadata } from 'astro'
import editor from '../assets/screenshots/editor.png'
import graph from '../assets/screenshots/graph.png'
import search from '../assets/screenshots/search.png'
import settings from '../assets/screenshots/settings.png'
import related from '../assets/screenshots/related.png'
import tasks from '../assets/screenshots/tasks.png'
import reading from '../assets/screenshots/reading.png'

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
    alt: 'The backlinks panel listing the notes that link to Spaced repetition, each with its surrounding text',
    focus: '100% 20%',
  },
  {
    id: 'graph',
    title: 'See the shape of your thinking',
    body: 'The graph draws every note and link in the vault. Filter it with path:, tag:, file: and plain words, show only unlinked notes, and ⇧-click a note to light up its connections.',
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
    id: 'related',
    title: 'Notes that belong together',
    body: 'Related notes suggests notes you have not linked yet and says why: shared tags, shared links, shared words. Insert the link only if you agree, or dismiss the suggestion.',
    image: related,
    alt: 'The related notes panel suggesting notes to link to, each with the reason it is related',
    focus: '100% 60%',
  },
  {
    id: 'tasks',
    title: 'Every task, one list',
    body: 'Every checklist item in the vault in one place, grouped by note: tick it there or jump to its line. The start page adds pinned, recently opened and recently changed notes, plus a daily note for today.',
    image: tasks,
    alt: 'The tasks view listing checklist items from across the vault, grouped by note',
    focus: '0% 40%',
  },
  {
    id: 'export',
    title: 'Take a note anywhere',
    body: 'Export a note to standalone HTML or PDF, with images, highlighted code and diagrams inside. And if an edit goes wrong, version history keeps earlier copies you can read and restore.',
    image: reading,
    alt: 'A note in reading view with highlighted code and a Mermaid diagram, as exported to HTML or PDF',
    focus: '50% 60%',
  },
  {
    id: 'preferences',
    title: 'One set of preferences',
    body: 'Theme, accent, fonts, editor and hotkeys are global, so switching vaults never resets them. Pick from installed fonts or add your own font files (font picker included). Any single setting can still be overridden for one vault.',
    image: settings,
    alt: 'Synapse settings, where each preference has a scope menu for all vaults or this vault only',
    focus: '50% 40%',
  },
]
