import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, Hash, Folder, FolderOpen, FolderTree, Waypoints, FilePlus, FolderPlus, ChevronsDownUp, ChevronRight, ChevronsUpDown, FileText, Image as ImageIcon, File as FileIcon, X, Settings } from 'lucide-react'
import { model, useModel, isMd, IMAGE_EXT } from '../model'
import { api, FileEntry } from '../api'
import { noteTitle, basename, Link, wordCount } from '../../shared/markdown'
import { runCommand, hotkeysFor, formatHotkey } from '../commands'
import { t, tn, getLanguage } from '../../shared/i18n'

const ICON = { size: 15, strokeWidth: 1.75 } as const
const kbd = (id: string) => formatHotkey(hotkeysFor(id)[0] ?? '')

// ---------- navigator (left) ----------

export function Navigator() {
  const tab = useModel((s) => s.snap!.global.layout.leftTab)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const graphActive = useModel((s) => model.activeTab.kind === 'graph' && !!s.ws)
  const current = (tab === 'search' && !plugins.search) || (tab === 'tags' && !plugins.tags) ? 'files' : tab
  const views = [
    { id: 'files' as const, label: t('nav.files'), icon: <FolderTree {...ICON} />, on: true, hint: '' },
    { id: 'search' as const, label: t('nav.search'), icon: <Search {...ICON} />, on: plugins.search, hint: kbd('global-search:open') },
    { id: 'tags' as const, label: t('nav.tags'), icon: <Hash {...ICON} />, on: plugins.tags, hint: '' },
  ].filter((v) => v.on)

  return (
    <div className="nav">
      <div className="dock-titlebar" />
      <VaultSwitcher />
      <button className="jump-field" onClick={() => runCommand('switcher:open')} aria-label={t('nav.jump')}>
        <Search {...ICON} />
        <span>{t('nav.jump')}</span>
        <kbd>{kbd('switcher:open')}</kbd>
      </button>
      <nav className="nav-views" aria-label={t('nav.views')}>
        {views.map((v) => (
          <button key={v.id} className={`nav-row${current === v.id ? ' is-active' : ''}`} aria-current={current === v.id ? 'page' : undefined} onClick={() => {
            model.setLayout({ leftTab: v.id })
            if (v.id === 'search') requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#search-input')?.focus())
          }}>
            {v.icon}
            <span>{v.label}</span>
            {v.hint && <kbd>{v.hint}</kbd>}
          </button>
        ))}
        {plugins.graph && (
          <button className={`nav-row${graphActive ? ' is-current-view' : ''}`} aria-pressed={graphActive} onClick={() => runCommand('graph:open')}>
            <Waypoints {...ICON} />
            <span>{t('nav.graph')}</span>
            <kbd>{kbd('graph:open')}</kbd>
          </button>
        )}
      </nav>
      <div className="nav-panel">
        {current === 'files' && <FileExplorer />}
        {current === 'search' && <SearchPanel />}
        {current === 'tags' && <TagsPanel />}
      </div>
      <div className="nav-footer">
        <button className="nav-row" onClick={() => runCommand('file-explorer:new-file')}>
          <FilePlus {...ICON} />
          <span>{t('common.newNote')}</span>
          <kbd>{kbd('file-explorer:new-file')}</kbd>
        </button>
        <button className="icon-btn" aria-label={t('nav.settings')} title={`${t('nav.settings')} ${kbd('app:open-settings')}`} onClick={() => runCommand('app:open-settings')}>
          <Settings {...ICON} />
        </button>
      </div>
    </div>
  )
}

function VaultSwitcher() {
  const snap = useModel((s) => s.snap!)
  const others = snap.vaults.filter((v) => v.id !== snap.vault!.id && v.available)
  const name = snap.vault!.name
  return (
    <button
      className="vault-switcher"
      aria-label={t('nav.switchVault')}
      title={snap.vault!.path}
      onClick={(e) =>
        model.openMenu(e, [
          ...others.slice(0, 8).map((v) => ({ label: v.name, run: () => model.switchVault(() => api.openVaultId(v.id)) })),
          ...(others.length ? [{ separator: true, label: '' }] : []),
          { label: t('nav.manageVaults'), run: () => model.set({ modal: { kind: 'vaults' } }) },
          { label: t('nav.revealVault'), run: () => api.reveal('') },
        ])
      }
    >
      <span className="vault-mark" aria-hidden>{[...name][0]?.toUpperCase()}</span>
      <span className="vault-switcher-name">{name}</span>
      <ChevronsUpDown size={13} strokeWidth={1.75} className="vault-switcher-chevron" />
    </button>
  )
}

// ---------- note context (right) ----------

export function ContextPanel() {
  const tab = useModel((s) => s.snap!.global.layout.rightTab)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const path = useActiveNote()
  const indexVersion = useModel((s) => s.indexVersion)
  const backCount = useMemo(() => (path && plugins.backlinks ? model.index.backlinks(path).length : 0), [path, indexVersion, plugins.backlinks])
  const tabs = [
    { id: 'backlinks' as const, label: t('context.backlinks'), on: plugins.backlinks, count: backCount },
    { id: 'outgoing' as const, label: t('context.outgoing'), on: plugins.outgoing, count: null },
    { id: 'outline' as const, label: t('context.outline'), on: plugins.outline, count: null },
  ].filter((t) => t.on)
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id

  return (
    <div className="context">
      <div className="dock-titlebar" />
      {!path ? (
        <div className="context-empty">
          <div className="empty-heading">{t('context.noNote')}</div>
          <p>{t('context.noNoteBody')}</p>
        </div>
      ) : (
        <>
          <NoteInfo path={path} />
          {tabs.length > 0 && (
            <div className="segmented" role="tablist" aria-label={t('shell.noteContext')}>
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={current === t.id} className={`segment${current === t.id ? ' is-active' : ''}`} onClick={() => model.setLayout({ rightTab: t.id })}>
                  {t.label}
                  {t.count !== null && t.count > 0 && <span className="segment-count tabular">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="context-panel">
            {current === 'backlinks' && <BacklinksPanel />}
            {current === 'outgoing' && <OutgoingPanel />}
            {current === 'outline' && <OutlinePanel />}
          </div>
        </>
      )}
    </div>
  )
}


/** Real metadata of the active note: location, modification time, size, tags. */
function NoteInfo({ path }: { path: string }) {
  const mtime = useModel((s) => s.buffers[path]?.mtime)
  const content = useModel((s) => s.buffers[path]?.content)
  const indexVersion = useModel((s) => s.indexVersion)
  const tags = useMemo(() => model.index.notes.get(path)?.meta.tags ?? [], [path, indexVersion])
  const words = useMemo(() => (content !== undefined ? wordCount(content).words : 0), [content])
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : t('context.vaultRoot')
  const dateFmt = new Intl.DateTimeFormat(getLanguage(), { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <section className="note-info" aria-label={t('context.details')}>
      <div className="note-info-title">{noteTitle(path)}</div>
      <dl className="note-info-grid">
        <dt>{t('context.folder')}</dt>
        <dd title={folder}>{folder}</dd>
        {mtime !== undefined && (
          <>
            <dt>{t('context.modified')}</dt>
            <dd className="tabular">{dateFmt.format(mtime)}</dd>
          </>
        )}
        <dt>{t('context.length')}</dt>
        <dd className="tabular">{tn('count.words', words)}</dd>
      </dl>
      {tags.length > 0 && (
        <div className="note-info-tags">
          {tags.map((t) => (
            <button key={t} className="tag-chip" onClick={() => searchTag(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function searchTag(tag: string) {
  model.set({ searchQuery: `tag:${tag}` })
  model.setLayout({ leftOpen: true, leftTab: 'search' })
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
      <div className="panel-toolbar">
        <div className="filter-box">
          <input className="text-input" placeholder={t('files.filter')} aria-label={t('files.filterLabel')} value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setFilter('')} />
          {filter && (
            <button className="icon-btn clear" aria-label={t('files.clearFilter')} onClick={() => setFilter('')}>
              <X size={13} />
            </button>
          )}
        </div>
        <button className="icon-btn" aria-label={t('common.newNote')} title={t('common.newNote')} onClick={() => model.createNote()}>
          <FilePlus {...ICON} />
        </button>
        <button className="icon-btn" aria-label={t('common.newFolder')} title={t('common.newFolder')} onClick={() => model.createFolder()}>
          <FolderPlus {...ICON} />
        </button>
        <button className="icon-btn" aria-label={t('files.collapseAll')} title={t('files.collapseAll')} onClick={() => model.set({ expanded: {} })}>
          <ChevronsDownUp {...ICON} />
        </button>
      </div>
      <div
        className={`nav-files${dropRoot ? ' is-drop-target' : ''}`}
        role="tree"
        onContextMenu={(e) =>
          model.openMenu(e, [
            { label: t('common.newNote'), run: () => model.createNote({ folder: '' }) },
            { label: t('common.newFolder'), run: () => model.createFolder('') },
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
        {tree.children.length === 0 &&
          (filter ? (
            <div className="pane-empty">{t('files.noMatch', { q: filter })}</div>
          ) : (
            <div className="panel-empty" data-testid="empty-vault">
              <div className="empty-heading">{t('files.emptyTitle')}</div>
              <p>{t('files.emptyBody')}</p>
              <button className="btn mod-cta" onClick={() => model.createNote()}>{t('files.createFirst')}</button>
            </div>
          ))}
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
          { label: t('common.newNote'), run: () => model.createNote({ folder: node.path }) },
          { label: t('common.newFolder'), run: () => model.createFolder(node.path) },
          { separator: true, label: '' },
          { label: t('common.renameEllipsis'), run: () => model.renamePrompt(node.path) },
          { label: t('common.revealInFinder'), run: () => api.reveal(node.path) },
          { label: t('common.copyPath'), run: () => navigator.clipboard.writeText(node.path) },
          { separator: true, label: '' },
          { label: t('common.delete'), danger: true, run: () => model.remove(node.path) },
        ]
      : [
          { label: t('files.openNewTab'), run: () => model.open(node.path, 'new') },
          { label: t('files.openRight'), run: () => model.open(node.path, 'split') },
          { separator: true, label: '' },
          { label: t('common.renameEllipsis'), run: () => model.renamePrompt(node.path) },
          { label: t('common.revealInFinder'), run: () => api.reveal(node.path) },
          { label: t('common.copyPath'), run: () => navigator.clipboard.writeText(node.path) },
          { separator: true, label: '' },
          { label: t('common.delete'), danger: true, run: () => model.remove(node.path) },
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
        style={{ paddingLeft: 6 + depth * 14 }}
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
        {isFolder ? (
          <>
            <ChevronRight size={12} strokeWidth={2} className={`tree-chevron${open ? ' is-open' : ''}`} />
            <span className="tree-icon is-folder">{open ? <FolderOpen {...ICON} /> : <Folder {...ICON} />}</span>
          </>
        ) : (
          <>
            <span className="tree-chevron-space" />
            <span className="tree-icon">{isMd(node.name) ? <FileText {...ICON} /> : IMAGE_EXT.test(node.name) ? <ImageIcon {...ICON} /> : <FileIcon {...ICON} />}</span>
          </>
        )}
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
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          value={query}
          onChange={(e) => model.set({ searchQuery: e.target.value })}
        />
        {query && (
          <button className="icon-btn clear" aria-label={t('search.clear')} onClick={() => model.set({ searchQuery: '' })}>
            <X size={14} />
          </button>
        )}
      </div>
      {debounced && <div className="search-summary">{hits.length ? tn('search.files', hits.length) + (total ? ', ' + tn('search.matches', total) : '') : t('search.noResults')}</div>}
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
      <div className="pane-subheader">{t('tags.title')}</div>
      {!tags.length && <div className="pane-empty">{t('tags.none')}</div>}
      {tags.map(([tag, count]) => (
        <div
          key={tag}
          className="tag-row"
          tabIndex={0}
          onClick={() => searchTag(tag)}
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
  if (!path) return <div className="pane-empty">{t('context.noActive')}</div>
  return (
    <div className="backlinks-panel" data-testid="backlinks">
      <div className="pane-subheader">{t('backlinks.linked')} <span className="count">{back.length}</span></div>
      {!back.length && <div className="pane-empty">{t('backlinks.none')}</div>}
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
        <ChevronRight size={14} className={`tree-chevron${showUnlinked ? ' is-open' : ''}`} /> {t('backlinks.unlinked')} {showUnlinked && <span className="count">{unlinked.length}</span>}
      </button>
      {showUnlinked && !unlinked.length && <div className="pane-empty">{t('backlinks.noUnlinked')}</div>}
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
  if (!path) return <div className="pane-empty">{t('context.noActive')}</div>
  return (
    <div className="outgoing-panel" data-testid="outgoing">
      <div className="pane-subheader">{t('outgoing.links')} <span className="count">{links.resolved.length}</span></div>
      {!links.resolved.length && <div className="pane-empty">{t('outgoing.none')}</div>}
      {links.resolved.map((r) => (
        <div key={r} className="tag-row" tabIndex={0} onClick={(e) => model.open(r, e.metaKey ? 'new' : 'tab')}>
          {isMd(r) ? noteTitle(r) : basename(r)}
        </div>
      ))}
      <div className="pane-subheader">{t('outgoing.unresolved')} <span className="count">{links.unresolved.length}</span></div>
      {links.unresolved.map((u) => (
        <div key={u} className="tag-row is-unresolved" tabIndex={0} title={t('outgoing.clickToCreate')} onClick={() => model.followLink(u, path)}>
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
  if (!path) return <div className="pane-empty">{t('context.noActive')}</div>
  if (!headings.length) return <div className="pane-empty">{t('outline.none')}</div>
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
