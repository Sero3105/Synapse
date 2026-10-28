// Ordering of one folder's children in the file explorer. Folders always come
// first; dates are newest-first. Pure so the tree builder stays a mapping.

export type FileSort = 'name' | 'modified' | 'created'

export interface SortableEntry {
  name: string
  type: 'file' | 'folder'
  /** ms since epoch; 0 = unknown, sorts last in date orders */
  mtime: number
  created: number
}

const byName = (a: SortableEntry, b: SortableEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export function sortEntries<T extends SortableEntry>(entries: readonly T[], sort: FileSort): T[] {
  const key = sort === 'modified' ? 'mtime' : sort === 'created' ? 'created' : null
  return [...entries].sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : key ? b[key] - a[key] || byName(a, b) : byName(a, b)))
}
