// Recently used commands for the command palette. Only command ids, kept in memory for the session.

export const MAX_RECENT = 5

/** `id` moves to the front; no duplicates; at most `max` entries. */
export const remember = (list: string[], id: string, max = MAX_RECENT) => [id, ...list.filter((x) => x !== id)].slice(0, max)

/**
 * Split the available commands for an empty query: recent ones first (in recent order, only those
 * still available), then every other command once.
 */
export function splitRecent<T extends { id: string }>(available: T[], recent: string[]): { recent: T[]; rest: T[] } {
  const byId = new Map(available.map((c) => [c.id, c]))
  const top = recent.map((id) => byId.get(id)).filter((c): c is T => !!c)
  const shown = new Set(top.map((c) => c.id))
  return { recent: top, rest: available.filter((c) => !shown.has(c.id)) }
}
