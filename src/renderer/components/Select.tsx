// The one dropdown of the app: a button that opens the app's own menu, never the native pop-up,
// so every choice list looks and behaves the same (aligned text, tick on the current choice, keys).
import { ChevronDown } from 'lucide-react'
import { model } from '../model'

export interface SelectOption<T extends string> { value: T; label: string }

export function Select<T extends string>({ value, options, onChange, label, title, quiet, accent }: {
  value: T
  options: SelectOption<T>[]
  onChange: (v: T) => void
  /** Accessible name; the button shows the current choice. */
  label: string
  title?: string
  /** Text-only look for secondary choices (sort order, setting scope). */
  quiet?: boolean
  /** Shown in the accent colour (a vault override in effect). */
  accent?: boolean
}) {
  const current = options.find((o) => o.value === value)
  const open = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const items = options.map((o) => ({ label: o.label, checked: o.value === value, run: () => o.value !== value && onChange(o.value) }))
    model.openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {} }, items, r.width)
  }
  return (
    <button
      type="button"
      className={`select${quiet ? ' is-quiet' : ''}${accent ? ' is-accent' : ''}`}
      aria-haspopup="menu"
      aria-label={`${label}: ${current?.label ?? ''}`}
      title={title}
      onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          open(e.currentTarget)
        }
      }}
    >
      <span className="select-value">{current?.label}</span>
      <ChevronDown size={13} strokeWidth={2} aria-hidden />
    </button>
  )
}
