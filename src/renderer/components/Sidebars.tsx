import { useMemo, useState, useRef, useEffect } from 'react'
import { Folder, Search, Hash, Link2, ArrowUpRight, ListTree, FilePlus, FolderPlus, ChevronsDownUp, ChevronRight, FileText, Image as ImageIcon, File as FileIcon, X } from 'lucide-react'
import { model, useModel, isMd, IMAGE_EXT } from '../model'
import { api, FileEntry } from '../api'
import { noteTitle, basename, Link } from '../../shared/markdown'

// ---------- shells ----------

export function LeftSidebar() {
  const tab = useModel((s) => s.snap!.global.layout.leftTab)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const tabs = [
    { id: 'files' as const, icon: <Folder size={16} />, label: 'Files', on: true },
    { id: 'search' as const, icon: <Search size={16} />, label: 'Search', on: plugins.search },
    { id: 'tags' as const, icon: <Hash size={16} />, label: 'Tags', on: plugins.tags },
  ].filter((t) => t.on)
  const current = tabs.some((t) => t.id === tab) ? tab : 'files'
  return (
    <SidebarShell tabs={tabs} current={current} onSelect={(id) => model.setLayout({ leftTab: id })}>
      {current === 'files' && <FileExplorer />}
      {current === 'search' && <SearchPanel />}
      {current === 'tags' && <TagsPanel />}
    </SidebarShell>
  )
}

export function RightSidebar() {
  const tab = useModel((s) => s.snap!.global.layout.rightTab)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const tabs = [
    { id: 'backlinks' as const, icon: <Link2 size={16} />, label: 'Backlinks', on: plugins.backlinks },
    { id: 'outgoing' as const, icon: <ArrowUpRight size={16} />, label: 'Outgoing links', on: plugins.outgoing },
    { id: 'outline' as const, icon: <ListTree size={16} />, label: 'Outline', on: plugins.outline },
  ].filter((t) => t.on)
  if (!tabs.length) return <div className="sidebar"><div className="pane-empty">All right-sidebar plugins are disabled.</div></div>
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0].id
  return (
    <SidebarShell tabs={tabs} current={current} onSelect={(id) => model.setLayout({ rightTab: id })}>
      {current === 'backlinks' && <BacklinksPanel />}
      {current === 'outgoing' && <OutgoingPanel />}
      {current === 'outline' && <OutlinePanel />}
    </SidebarShell>
  )
}

function SidebarShell<T extends string>({ tabs, current, onSelect, children }: { tabs: { id: T; icon: React.ReactNode; label: string }[]; current: T; onSelect: (id: T) => void; children: React.ReactNode }) {
  return (
    <div className="sidebar">
      <div className="sidebar-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current} aria-label={t.label} title={t.label} className={`icon-btn sidebar-tab${t.id === current ? ' is-active' : ''}`} onClick={() => onSelect(t.id)}>
            {t.icon}
          </button>
        ))}
      </div>
      <div className="sidebar-content">{children}</div>
    </div>
  )
}

// ---------- file explorer ----------

interface TreeNode { name: string; path: string; type: 'file' | 'folder'; children: TreeNode[] }

function buildTree(files: FileEntry[], filter: string): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] }
  const folders = new Map<string, TreeNode>([['', root]])
  const f = filter.toLowerCase()
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const ensure = (path: string): TreeNode => {
    let n = folders.get(path)
    if (n) return n
    const parent = ensure(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    n = { name: basename(path), path, type: 'folder', children: [] }
    parent.children.push(n)
    folders.set(path, n)
    return n
  }
  for (const e of sorted) {
    if (e.type === 'folder') {
      if (!f) ensure(e.path)
      continue
    }
    if (f && !e.path.toLowerCase().includes(f)) continue
    const dir = e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''
    ensure(dir).children.push({ name: basename(e.path), path: e.path, type: 'file', children: [] })
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
    n.children.forEach(sort)
  }
  sort(root)
  return root
}

function FileExplorer() {
  const files = useModel((s) => s.files)
  const [filter, setFilter] = useState('')
  const tree = useMemo(() => buildTree(files, filter), [files, filter])
  const active = useModel(() => model.activeFile)
  const [dropRoot, setDropRoot] = useState(false)

  return (
    <div className="file-explorer" data-testid="file-explorer">
      <div className="nav-header">
        <button className="icon-btn" aria-label="New note" title="New note" onClick={() => model.createNote()}>
          <FilePlus size={16} />
        </button>
        <button className="icon-btn" aria-label="New folder" title="New folder" onClick={() => model.createFolder()}>
          <FolderPlus size={16} />
        </button>
        <button className="icon-btn" aria-label="Collapse all" title="Collapse all" onClick={() => model.set({ expanded: {} })}>
          <ChevronsDownUp size={16} />
        </button>
      </div>
      <div className="filter-box">
        <input className="text-input" placeholder="Filter files…" aria-label="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {filter && (
          <button className="icon-btn clear" aria-label="Clear filter" onClick={() => setFilter('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <div
        className={`nav-files${dropRoot ? ' is-drop-target' : ''}`}
        role="tree"
        onContextMenu={(e) =>
          model.openMenu(e, [
            { label: 'New note', run: () => model.createNote({ folder: '' }) },
            { label: 'New folder', run: () => model.createFolder('') },
          ])
        }
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-synapse-path')) {
            e.preventDefault()
            setDropRoot(true)
          }
        }}
        onDragLeave={() => setDropRoot(false)}
        onDrop={(e) => {
          setDropRoot(false)
          const p = e.dataTransfer.getData('application/x-synapse-path')
          if (p && p.includes('/')) model.rename(p, basename(p))
        }}
      >
        {tree.children.length === 0 && <div className="pane-empty">{filter ? 'No matching files.' : 'This vault is empty.'}</div>}
        {tree.children.map((n) => (
          <TreeItem key={n.path} node={n} depth={0} active={active} forceOpen={!!filter} />
        ))}
      </div>
    </div>
  )
}

function TreeItem({ node, depth, active, forceOpen }: { node: TreeNode; depth: number; active: string | null; forceOpen: boolean }) {
  const open = useModel((s) => !!s.expanded[node.path]) || forceOpen
  const [over, setOver] = useState(false)
  const isFolder = node.type === 'folder'
  const label = isFolder ? node.name : isMd(node.name) ? node.name.slice(0, -3) : node.name

  const menu = (e: React.MouseEvent) => {
    e.stopPropagation()
    const items = isFolder
      ? [
          { label: 'New note', run: () => model.createNote({ folder: node.path }) },
          { label: 'New folder', run: () => model.createFolder(node.path) },
          { separator: true, label: '' },
          { label: 'Rename…', run: () => model.renamePrompt(node.path) },
          { label: 'Reveal in Finder', run: () => api.reveal(node.path) },
          { label: 'Copy path', run: () => navigator.clipboard.writeText(node.path) },
          { separator: true, label: '' },
          { label: 'Delete', danger: true, run: () => model.remove(node.path) },
        ]
      : [
          { label: 'Open in new tab', run: () => model.open(node.path, 'new') },
          { label: 'Open to the right', run: () => model.open(node.path, 'split') },
          { separator: true, label: '' },
          { label: 'Rename…', run: () => model.renamePrompt(node.path) },
          { label: 'Reveal in Finder', run: () => api.reveal(node.path) },
          { label: 'Copy path', run: () => navigator.clipboard.writeText(node.path) },
          { separator: true, label: '' },
          { label: 'Delete', danger: true, run: () => model.remove(node.path) },
        ]
    model.openMenu(e, items)
  }

  const activate = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isFolder) model.toggleExpanded(node.path)
    else model.open(node.path, e.metaKey || e.ctrlKey ? 'new' : 'tab')
  }

  return (
    <div className="tree-item" role="treeitem" aria-expanded={isFolder ? open : undefined} aria-selected={active === node.path}>
      <div
        className={`tree-item-self${active === node.path ? ' is-active' : ''}${over ? ' is-drop-target' : ''}`}
        style={{ paddingLeft: 8 + depth * 17 }}
        data-path={node.path}
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-synapse-path', node.path)
          e.dataTransfer.setData('text/plain', isMd(node.path) ? `[[${noteTitle(node.path)}]]` : node.path)
          e.dataTransfer.effectAllowed = 'copyMove'
        }}
        onDragOver={(e) => {
          if (!isFolder || !e.dataTransfer.types.includes('application/x-synapse-path')) return
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!isFolder) return
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          const p = e.dataTransfer.getData('application/x-synapse-path')
          if (p && p !== node.path && !node.path.startsWith(p + '/')) model.rename(p, `${node.path}/${basename(p)}`).then((ok) => ok && model.toggleExpanded(node.path, true))
        }}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter') activate(e)
          if (e.key === 'ArrowRight' && isFolder && !open) model.toggleExpanded(node.path, true)
          if (e.key === 'ArrowLeft' && isFolder && open) model.toggleExpanded(node.path, false)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const all = [...document.querySelectorAll<HTMLElement>('.nav-files .tree-item-self')]
            all[all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
          }
          if (e.key === 'Backspace' && e.metaKey) model.remove(node.path)
          if (e.key === 'F2') model.renamePrompt(node.path)
        }}
        onContextMenu={menu}
      >
        {isFolder ? <ChevronRight size={14} className={`tree-chevron${open ? ' is-open' : ''}`} /> : <span className="tree-file-icon">{isMd(node.name) ? <FileText size={14} /> : IMAGE_EXT.test(node.name) ? <ImageIcon size={14} /> : <FileIcon size={14} />}</span>}
        <span className="tree-item-inner">{label}</span>
        {!isFolder && !isMd(node.name) && <span className="nav-file-tag">{node.name.split('.').pop()?.toUpperCase()}</span>}
      </div>
      {isFolder && open && (
        <div className="tree-item-children" role="group">
          {node.children.map((c) => (
            <TreeItem key={c.path} node={c} depth={depth + 1} active={active} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- search ----------

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const out: React.ReactNode[] = []
  let last = 0
  // trim long lines around the first match
  const start = Math.max(0, (ranges[0]?.[0] ?? 0) - 60)
  ranges.forEach(([a, b], i) => {
    if (a < last) return
    out.push(text.slice(Math.max(last, start), a))
    out.push(<mark key={i} className="search-match">{text.slice(a, b)}</mark>)
    last = b
  })
  out.push(text.slice(last, last + 200))
  return <>{start > 0 && '…'}{out}</>
}

function SearchPanel() {
  const query = useModel((s) => s.searchQuery)
  const indexVersion = useModel((s) => s.indexVersion)
  const [debounced, setDebounced] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120)
    return () => clearTimeout(t)
  }, [query])
  const hits = useMemo(() => model.index.search(debounced), [debounced, indexVersion])
  const total = hits.reduce((n, h) => n + h.matches.length, 0)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <div className="search-panel">
      <div className="filter-box">
        <input
          id="search-input"
          className="text-input"
          autoFocus
          placeholder="Search… (tag:#x  path:dir  file:name  -exclude  &quot;phrase&quot;)"
          aria-label="Search all notes"
          value={query}
          onChange={(e) => model.set({ searchQuery: e.target.value })}
        />
        {query && (
          <button className="icon-btn clear" aria-label="Clear search" onClick={() => model.set({ searchQuery: '' })}>
            <X size={14} />
          </button>
        )}
      </div>
      {debounced && <div className="search-summary">{hits.length ? `${hits.length} file${hits.length > 1 ? 's' : ''}${total ? `, ${total} match${total > 1 ? 'es' : ''}` : ''}` : 'No results found.'}</div>}
      <div className="search-results" data-testid="search-results">
        {hits.map((h) => (
          <div key={h.path} className="search-result">
            <div className="search-result-file" onClick={(e) => (e.altKey ? setCollapsed({ ...collapsed, [h.path]: !collapsed[h.path] }) : model.open(h.path, e.metaKey ? 'new' : 'tab'))}>
              <ChevronRight
                size={14}
                className={`tree-chevron${collapsed[h.path] ? '' : ' is-open'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setCollapsed({ ...collapsed, [h.path]: !collapsed[h.path] })
                }}
              />
              <span>{noteTitle(h.path)}</span>
              {h.matches.length > 0 && <span className="count">{h.matches.length}</span>}
            </div>
            {!collapsed[h.path] &&
              h.matches.map((m) => (
                <div key={m.line} className="search-result-match" onClick={(e) => model.open(h.path, e.metaKey ? 'new' : 'tab', { line: m.line, mode: 'source' })}>
                  <Highlighted text={m.text} ranges={m.ranges} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- tags ----------

function TagsPanel() {
  const indexVersion = useModel((s) => s.indexVersion)
  const tags = useMemo(() => [...model.index.tags()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [indexVersion])
  return (
    <div className="tags-panel">
      <div className="pane-subheader">Tags</div>
      {!tags.length && <div className="pane-empty">No tags found.</div>}
      {tags.map(([tag, count]) => (
        <div
          key={tag}
          className="tag-row"
          tabIndex={0}
          onClick={() => {
            model.set({ searchQuery: `tag:${tag}` })
            model.setLayout({ leftTab: 'search' })
          }}
        >
          <span>{tag}</span>
          <span className="count">{count}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- right sidebar panels ----------

function useActiveNote() {
  useModel((s) => s.ws)
  return useModel(() => (model.activeTab.kind === 'note' ? model.activeTab.path ?? null : null))
}

function LinkContext({ source, link }: { source: string; link: Link }) {
  const line = (model.state.buffers[source]?.content ?? model.index.notes.get(source)?.content ?? '').split('\n')[link.line] ?? ''
  return (
    <div className="search-result-match" onClick={(e) => model.open(source, e.metaKey ? 'new' : 'tab', { line: link.line, mode: 'source' })}>
      {line.trim().slice(0, 240)}
    </div>
  )
}

function BacklinksPanel() {
  const path = useActiveNote()
  const indexVersion = useModel((s) => s.indexVersion)
  const [showUnlinked, setShowUnlinked] = useState(false)
  const back = useMemo(() => (path ? model.index.backlinks(path) : []), [path, indexVersion])
  const unlinked = useMemo(() => (path && showUnlinked ? model.index.unlinkedMentions(path) : []), [path, indexVersion, showUnlinked])
  if (!path) return <div className="pane-empty">No active note.</div>
  return (
    <div className="backlinks-panel" data-testid="backlinks">
      <div className="pane-subheader">Linked mentions <span className="count">{back.length}</span></div>
      {!back.length && <div className="pane-empty">No backlinks found.</div>}
      {back.map((b) => (
        <div key={b.source} className="search-result">
          <div className="search-result-file" onClick={(e) => model.open(b.source, e.metaKey ? 'new' : 'tab')}>
            <span>{noteTitle(b.source)}</span>
            <span className="count">{b.links.length}</span>
          </div>
          {b.links.map((l, i) => (
            <LinkContext key={i} source={b.source} link={l} />
          ))}
        </div>
      ))}
      <button className="pane-subheader collapsible" aria-expanded={showUnlinked} onClick={() => setShowUnlinked(!showUnlinked)}>
        <ChevronRight size={14} className={`tree-chevron${showUnlinked ? ' is-open' : ''}`} /> Unlinked mentions {showUnlinked && <span className="count">{unlinked.length}</span>}
      </button>
      {showUnlinked && !unlinked.length && <div className="pane-empty">No unlinked mentions.</div>}
      {unlinked.map((u, i) => (
        <div key={i} className="search-result">
          <div className="search-result-file" onClick={() => model.open(u.source, 'tab', { line: u.line, mode: 'source' })}>
            <span>{noteTitle(u.source)}</span>
          </div>
          <div className="search-result-match" onClick={() => model.open(u.source, 'tab', { line: u.line, mode: 'source' })}>
            {u.text.trim().slice(0, 240)}
          </div>
        </div>
      ))}
    </div>
  )
}

function OutgoingPanel() {
  const path = useActiveNote()
  const indexVersion = useModel((s) => s.indexVersion)
  const links = useMemo(() => {
    if (!path) return { resolved: [], unresolved: [] }
    const seen = new Set<string>()
    const resolved: string[] = []
    const unresolved: string[] = []
    for (const { link, resolved: r } of model.index.outgoing(path)) {
      if (!link.target) continue
      const key = r ?? '?' + link.target.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (r) resolved.push(r)
      else unresolved.push(link.target)
    }
    return { resolved, unresolved }
  }, [path, indexVersion])
  if (!path) return <div className="pane-empty">No active note.</div>
  return (
    <div className="outgoing-panel" data-testid="outgoing">
      <div className="pane-subheader">Links <span className="count">{links.resolved.length}</span></div>
      {!links.resolved.length && <div className="pane-empty">No outgoing links.</div>}
      {links.resolved.map((r) => (
        <div key={r} className="tag-row" tabIndex={0} onClick={(e) => model.open(r, e.metaKey ? 'new' : 'tab')}>
          {isMd(r) ? noteTitle(r) : basename(r)}
        </div>
      ))}
      <div className="pane-subheader">Unresolved links <span className="count">{links.unresolved.length}</span></div>
      {links.unresolved.map((u) => (
        <div key={u} className="tag-row is-unresolved" tabIndex={0} title="Click to create" onClick={() => model.followLink(u, path)}>
          {u}
        </div>
      ))}
    </div>
  )
}

function OutlinePanel() {
  const path = useActiveNote()
  const indexVersion = useModel((s) => s.indexVersion)
  const headings = useMemo(() => (path ? model.index.notes.get(path)?.meta.headings ?? [] : []), [path, indexVersion])
  const ref = useRef<HTMLDivElement>(null)
  if (!path) return <div className="pane-empty">No active note.</div>
  if (!headings.length) return <div className="pane-empty">No headings found.</div>
  const min = Math.min(...headings.map((h) => h.level))
  return (
    <div className="outline-panel" ref={ref}>
      {headings.map((h, i) => (
        <div key={i} className="tag-row" tabIndex={0} style={{ paddingLeft: 10 + (h.level - min) * 14 }} onClick={() => model.open(path, 'tab', { line: h.line, mode: 'source' })}>
          {h.text}
        </div>
      ))}
    </div>
  )
}
