// Tasks across the vault, a view in the navigator.
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { model, useModel } from '../model'
import { noteTitle, type IndexedNote } from '../../shared/markdown'
import { parseTasks, toggleTaskLine, type Task } from '../../shared/tasks'
import { t, tn } from '../../shared/i18n'

type Filter = 'open' | 'done' | 'all'
const MAX_SHOWN = 500

// Index entries are replaced on every change, so each note is parsed once per version.
const parsed = new WeakMap<IndexedNote, Task[]>()
const tasksOf = (n: IndexedNote) => {
  let v = parsed.get(n)
  if (!v) parsed.set(n, (v = n.content.includes('[') ? parseTasks(n.content) : []))
  return v
}

async function toggle(path: string, task: Task) {
  await model.ensureBuffer(path)
  const b = model.state.buffers[path]
  if (!b) return
  if (b.conflict) return model.notice(t('tasks.conflict'), true)
  const next = toggleTaskLine(b.content, task.line, task.raw)
  if (next === null) return model.notice(t('tasks.changed'), true)
  model.edit(path, next) // saved by autosave, which refuses to overwrite changes made on disk
}

export function TasksPanel() {
  const indexVersion = useModel((s) => s.indexVersion)
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const { groups, total } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups: { path: string; tasks: Task[] }[] = []
    let total = 0
    let shown = 0
    for (const n of [...model.index.notes.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const tasks = tasksOf(n).filter((x) => (filter === 'all' || x.done === (filter === 'done')) && (!q || x.text.toLowerCase().includes(q)))
      if (!tasks.length) continue
      total += tasks.length
      if (shown >= MAX_SHOWN) continue
      const visible = tasks.slice(0, MAX_SHOWN - shown)
      shown += visible.length
      groups.push({ path: n.path, tasks: visible })
    }
    return { groups, total }
  }, [indexVersion, filter, query])
  const shown = groups.reduce((n, g) => n + g.tasks.length, 0)
  const filters: { id: Filter; label: string }[] = [
    { id: 'open', label: t('tasks.open') },
    { id: 'done', label: t('tasks.done') },
    { id: 'all', label: t('tasks.all') },
  ]

  return (
    <div className="tasks-panel" data-testid="tasks">
      <div className="segmented" role="radiogroup" aria-label={t('tasks.show')}>
        {filters.map((f) => (
          <button key={f.id} role="radio" aria-checked={filter === f.id} className={`segment${filter === f.id ? ' is-active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="filter-box">
        <input className="text-input" placeholder={t('tasks.filter')} aria-label={t('tasks.filterLabel')} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setQuery('')} />
        {query && (
          <button className="icon-btn clear" aria-label={t('tasks.clearFilter')} onClick={() => setQuery('')}>
            <X size={13} />
          </button>
        )}
      </div>
      {total > 0 && <div className="search-summary">{tn('tasks.count', total)}{shown < total && ` · ${t('tasks.capped', { shown, total })}`}</div>}
      {!total && <div className="pane-empty">{t('tasks.none')}</div>}
      <div className="search-results">
        {groups.map((g) => (
          <div key={g.path} className="search-result">
            <div className="search-result-file" onClick={(e) => model.open(g.path, e.metaKey ? 'new' : 'tab')}>
              <span>{noteTitle(g.path)}</span>
              <span className="count">{g.tasks.length}</span>
            </div>
            {g.tasks.map((task) => (
              <div
                key={task.line}
                className={`search-result-match task-row${task.done ? ' is-done' : ''}`}
                style={{ '--depth': Math.min(4, Math.floor(task.indent / 2)) } as React.CSSProperties}
                onClick={(e) => model.open(g.path, e.metaKey ? 'new' : 'tab', { line: task.line, mode: 'source' })}
              >
                <input type="checkbox" className="task-checkbox" checked={task.done} aria-label={task.text} onClick={(e) => e.stopPropagation()} onChange={() => toggle(g.path, task).catch((e) => model.error(e))} />
                <span className="task-text">{task.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
