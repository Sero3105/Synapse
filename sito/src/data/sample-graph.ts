// Links between the notes of the "Research" sample vault (the one in the app's screenshots).
// Each pair is [from, to]: the first note contains a [[link]] to the second.
export const sampleLinks: readonly (readonly [string, string])[] = [
  ['Spaced repetition', 'Active recall'],
  ['Spaced repetition', 'Forgetting curve'],
  ['Active recall', 'Spaced repetition'],
  ['Active recall', 'Make It Stick'],
  ['Forgetting curve', 'Spaced repetition'],
  ['Study system', 'Spaced repetition'],
  ['Study system', 'Active recall'],
  ['Study system', 'Interleaving'],
  ['Make It Stick', 'Active recall'],
  ['Make It Stick', 'Spaced repetition'],
  ['Make It Stick', 'Interleaving'],
  ['Interleaving', 'Forgetting curve'],
  ['Zettelkasten', 'Atomic notes'],
  ['Atomic notes', 'Zettelkasten'],
  ['Thesis outline', 'Zettelkasten'],
  ['Thesis outline', 'Study system'],
  ['Inbox', 'Thesis outline'],
]
