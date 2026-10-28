import type { ImageMetadata } from 'astro'
import editor from '../assets/screenshots/editor.png'
import graph from '../assets/screenshots/graph.png'
import search from '../assets/screenshots/search.png'
import settings from '../assets/screenshots/settings.png'
import related from '../assets/screenshots/related.png'
import tasks from '../assets/screenshots/tasks.png'
import reading from '../assets/screenshots/reading.png'
import headingLinks from '../assets/screenshots/heading-links.png'
import localGraph from '../assets/screenshots/local-graph.png'
import panes from '../assets/screenshots/panes.png'

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
    body: 'Live Preview hides the syntax except on the line you are editing. Tables are edited as tables, LaTeX renders as you type, headings and lists fold to one line, and front matter sits in a quiet properties block. The file on disk stays plain Markdown.',
    image: editor,
    alt: 'A note in the Synapse editor with a properties block, a wiki link, a table and task checkboxes rendered in place',
    focus: '50% 30%',
  },
  {
    id: 'heading-links',
    title: 'Link to the exact paragraph',
    body: 'Type [[Note# and pick one of its headings. The link opens the note already scrolled there, in the editor and in the reading view, and it survives a rename.',
    image: headingLinks,
    alt: 'Link suggestions listing the headings of the note Spaced repetition while typing [[Spaced repetition#',
    focus: '45% 30%',
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
    body: 'The graph draws every note and link in the vault, coloured by folder or by first tag; click a colour in the legend to change it. Filter with path:, tag:, file: and plain words, and ⇧-click a note to light up its connections. Large vaults stay smooth.',
    image: graph,
    alt: 'Graph view of a vault with notes coloured by folder and a legend of the folders',
    focus: '60% 40%',
  },
  {
    id: 'local-graph',
    title: 'Zoom in on one note',
    body: 'The local graph shows the open note and what is one or two links away. Pick any note as the centre, then save the whole setup — mode, depth, filters, colours — as a named view for this vault.',
    image: localGraph,
    alt: 'The local graph of Spaced repetition at depth 2, with a bar naming the centre note and the depth',
    focus: '40% 40%',
  },
  {
    id: 'panes',
    title: 'Lay out your desk',
    body: 'Split panes in any mix of rows and columns, pin the tabs you keep coming back to, and open another vault in its own window to work on both side by side. Every layout comes back where you left it.',
    image: panes,
    alt: 'Three notes open at once: one on the left, two stacked on the right',
    focus: '50% 40%',
  },
  {
    id: 'search',
    title: 'Find it in a second',
    body: 'Search every note with "phrases", -exclusions, tag:, path: and file:. Results show the matching line; ⌘O jumps to any note by name. Tags nest, so #learning/memory sits under #learning.',
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
    title: 'Take your notes anywhere',
    body: 'Export a note to HTML or PDF, or the whole vault as a folder of linked HTML pages anyone can browse without Synapse. PDFs in the vault open in a tab. Version history keeps earlier copies you can read and restore.',
    image: reading,
    alt: 'A note in reading view with highlighted code and a Mermaid diagram, as exported to HTML or PDF',
    focus: '50% 60%',
  },
  {
    id: 'preferences',
    title: 'One set of preferences',
    body: 'Theme, accent, fonts, editor and hotkeys are global, so switching vaults never resets them. Pick from installed fonts or add your own font files. Any single setting can still be overridden for one vault.',
    image: settings,
    alt: 'Synapse settings, where each preference has a scope menu for all vaults or this vault only',
    focus: '50% 40%',
  },
]
