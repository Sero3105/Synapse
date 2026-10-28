// Screenshots for the README and the website, from a demo vault: `npm run screenshots`.
// Skipped in normal test runs. Writes 1440×900 PNGs to docs/screenshots/ and sito/src/assets/screenshots/.
import { test, ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

test.skip(!process.env.SYNAPSE_SCREENSHOTS, 'set SYNAPSE_SCREENSHOTS=1 to regenerate the screenshots')
test.setTimeout(300_000)

const OUT = [path.join(__dirname, '..', 'docs', 'screenshots'), path.join(__dirname, '..', 'sito', 'src', 'assets', 'screenshots')]

const VAULT: Record<string, string> = {
  'Concepts/Spaced repetition.md': `---
tags: [learning/memory]
source: Make It Stick
---
Reviewing material at **increasing intervals** moves it into long-term memory. It pairs naturally with [[Active recall]] and rests on the [[Forgetting curve]].

> Forgetting is the signal that tells you when to review.

## Schedule

| Day | Reviews | Recall |
|---|---|---|
| 1 | 12 | 64% |
| 7 | 9 | 81% |
| 30 | 4 | 93% |

## Next steps

- [x] Turn lecture notes into questions
- [ ] Track lapses in [[Study system#Weekly cycle|the weekly cycle]]
- [ ] Summarise [[Make It Stick]] chapter 2 #learning/practice
`,
  'Concepts/Active recall.md': '#learning/memory\n\nTesting yourself, instead of rereading, strengthens memory. See [[Spaced repetition]] and [[Make It Stick]].\n\nRetrieval beats review: every answer you produce is practice.\n',
  'Concepts/Forgetting curve.md': '#learning/memory\n\nMemory decays predictably after learning; [[Spaced repetition]] flattens the curve. First measured by Ebbinghaus in 1885.\n',
  'Concepts/Retrieval practice.md': '#learning/practice\n\nRecalling an answer strengthens it more than rereading does. [[Spaced repetition]] schedules the recall, and [[Active recall]] is the practice itself.\n',
  'Concepts/Interleaving.md': '#learning/practice\n\nMixing topics in one session feels harder and works better than blocks of one topic. Practice and memory both gain.\n',
  'Concepts/Desirable difficulty.md': '#learning/practice\n\nEffort during practice — recall, spacing, interleaving — makes learning stick, even when it feels slower.\n',
  'Concepts/Elaboration.md': '#learning/memory\n\nExplaining an idea in your own words and linking it to what you know gives memory more hooks.\n',
  'Projects/Exam prep.md': '#project\n\nThe last month runs on [[Spaced repetition]] and past papers, two topics a day.\n\n- [ ] Past paper 2023\n- [ ] Past paper 2024\n- [x] Topic list\n',
  'Projects/Review plan.md': '#project\n\nWeekly cycle: [[Spaced repetition]] for old material, new cards on Monday, a full review on Friday.\n\n- [ ] Set up Friday review\n',
  'Projects/Study system.md': `#project

Built on [[Spaced repetition]] and [[Active recall]], with [[Interleaving]] on Fridays.

## Weekly cycle

\`\`\`mermaid
flowchart LR
  L[Learn] --> R[Recall] --> S[Space out] --> L
\`\`\`

## Card format

\`\`\`ts
interface Card {
  question: string
  answer: string
  due: Date
}
\`\`\`

- [x] Choose a card format
- [ ] Review lapses every Sunday
`,
  'Reading/Make It Stick.md': '#book #learning/memory\n\nBrown, Roediger, McDaniel. Retrieval, spacing and interleaving, with the evidence behind each. Links: [[Active recall]], [[Spaced repetition]], [[Desirable difficulty]].\n',
  'Reading/Atomic Habits.md': '#book\n\nSmall changes, compounding. Useful for keeping the [[Review plan]] going.\n',
  'Daily/2026-10-28.md': '# 28 October\n\n- [ ] Review [[Forgetting curve]] cards\n- [x] Read chapter 3 of [[Make It Stick]]\n',
  'Inbox.md': 'Ideas to sort:\n\n- Spacing for language vocabulary\n- Does interleaving help with proofs?\n',
  'Templates/Book note.md': '# {{title}}\n\nAuthor:\nRead on {{date}}\n',
}

async function setup() {
  const env = makeEnv(VAULT)
  // a vault named like the one in the pictures, plus two more for the vault list
  const study = path.join(env.tmp, 'Study')
  fs.renameSync(env.vault, study)
  env.vault = study
  for (const name of ['Work notes', 'Journal']) fs.mkdirSync(path.join(env.tmp, name))
  fs.writeFileSync(path.join(env.userData, 'vaults.json'), JSON.stringify({
    vaults: {
      aaaaaaaaaaaaaaaa: { path: study, ts: 3 },
      bbbbbbbbbbbbbbbb: { path: path.join(env.tmp, 'Work notes'), ts: 2 },
      cccccccccccccccc: { path: path.join(env.tmp, 'Journal'), ts: 1 },
    },
    lastOpen: 'aaaaaaaaaaaaaaaa',
  }))
  return env
}

async function pdfBytes(app: ElectronApplication) {
  return Buffer.from(await app.evaluate(async ({ BrowserWindow }) => {
    const w = new BrowserWindow({ show: false })
    const body = '<h1>Memory: retention over time</h1><p><i>Notes on Ebbinghaus (1885)</i></p>' + '<p>Retention falls steeply in the first hours after learning and levels off over the following days. Each review resets the curve and makes the next decline slower, which is why spaced reviews need fewer repetitions over time.</p>'.repeat(6)
    await w.loadURL('data:text/html,' + encodeURIComponent(`<title>Ebbinghaus 1885</title><style>body{font:15px/1.6 Georgia,serif;margin:60px}</style>${body}`))
    const b = await w.webContents.printToPDF({})
    w.destroy()
    return b.toString('base64')
  }), 'base64')
}

test('screenshots', async () => {
  const env: Env = await setup()
  const { app, win } = await launch(env)
  fs.writeFileSync(path.join(env.vault, 'Reading', 'Ebbinghaus 1885.pdf'), await pdfBytes(app))
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(1440, 900)
    w.showInactive()
  })
  const M = (js: string) => win.evaluate(js)
  const shot = async (name: string, wait = 600) => {
    await win.mouse.move(1, 1) // no hover states in the picture
    await win.waitForTimeout(wait)
    const png = Buffer.from(await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64')), 'base64')
    for (const dir of OUT) fs.writeFileSync(path.join(dir, `${name}.png`), png)
  }
  const open = (p: string, mode: 'source' | 'preview' = 'source') => M(`window.__synapse.open(${JSON.stringify(p)}, 'tab', { mode: '${mode}' })`)
  const resetTabs = () => M(`(() => { const m = window.__synapse; for (const p of [...m.state.ws.panes].slice(1)) for (const t of [...p.tabs]) m.closeTab(p.id, t.id); const p = m.state.ws.panes[0]; for (const t of p.tabs.slice(1)) m.closeTab(p.id, t.id) })()`)

  await M(`window.__synapse.setGlobal({ language: 'en', prefs: { theme: 'dark' } })`)
  await M(`window.__synapse.setLayout({ leftOpen: true, rightOpen: true, leftTab: 'files', rightTab: 'backlinks' })`)
  for (const f of ['Concepts', 'Projects']) await M(`window.__synapse.toggleExpanded(${JSON.stringify(f)}, true)`)

  // editor
  await open('Concepts/Spaced repetition.md')
  await win.locator('.cm-content').click({ position: { x: 5, y: 5 } })
  await win.keyboard.press('Meta+ArrowUp') // cursor on the first line, the rest shows rendered
  await shot('editor', 1200)

  // a link to a heading, while typing
  await open('Inbox.md')
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type('\n- See [[Spaced repetition#')
  await win.locator('.cm-tooltip-autocomplete').waitFor()
  await shot('heading-links')
  await win.keyboard.press('Escape')
  await M(`window.__synapse.edit('Inbox.md', ${JSON.stringify(VAULT['Inbox.md'])})`)

  // reading view
  await open('Projects/Study system.md', 'preview')
  await shot('reading', 1500)

  // light theme
  await M(`window.__synapse.setGlobal({ prefs: { theme: 'light' } })`)
  await open('Concepts/Spaced repetition.md')
  await shot('light', 1000)
  await M(`window.__synapse.setGlobal({ prefs: { theme: 'dark' } })`)

  // search, tags, tasks
  await M(`window.__synapse.set({ searchQuery: 'recall' }); window.__synapse.setLayout({ leftTab: 'search' })`)
  await shot('search', 900)
  await M(`window.__synapse.setLayout({ leftTab: 'tags' })`)
  for (const t of await win.locator('.tags-panel .tag-toggle').all()) await t.click()
  await shot('tags')
  await M(`window.__synapse.setLayout({ leftTab: 'tasks' })`)
  await shot('tasks')
  await M(`window.__synapse.setLayout({ leftTab: 'files' })`)

  // related notes
  await open('Concepts/Interleaving.md')
  await win.getByTestId('related').getByRole('button', { name: /Related notes/ }).click()
  await shot('related', 900)
  await win.getByTestId('related').getByRole('button', { name: /Related notes/ }).click()

  // command palette
  await open('Concepts/Spaced repetition.md')
  await win.keyboard.press('Meta+P')
  await shot('command-palette')
  await win.keyboard.press('Escape')

  // graph: the whole vault coloured by folder, then the local graph of one note
  await M(`window.__synapse.setVault({ graph: { colorBy: 'folder', local: false, depth: 1 } })`)
  await M(`window.__synapse.openGraph()`)
  await shot('graph', 3500)
  await open('Concepts/Spaced repetition.md')
  await M(`window.__synapse.setVault({ graph: { local: true, depth: 2 } })`)
  await M(`window.__synapse.openGraph()`)
  await shot('local-graph', 3500)
  await M(`window.__synapse.setVault({ graph: { local: false } })`)
  await resetTabs()

  // settings
  await M(`window.__synapse.set({ modal: { kind: 'settings', tab: 'appearance' } })`)
  await shot('settings', 800)
  await win.keyboard.press('Escape')

  // nested panes: a note on the left, two stacked on the right
  await open('Concepts/Spaced repetition.md')
  await palette(win, 'split right')
  await open('Reading/Make It Stick.md', 'preview')
  await palette(win, 'split down')
  await open('Projects/Review plan.md')
  await shot('panes', 1000)
  await resetTabs()

  // PDF in a tab
  await open('Reading/Ebbinghaus 1885.pdf')
  await shot('pdf', 2500)
  await resetTabs()

  // start page of a new tab
  await M(`window.__synapse.newTab()`)
  await shot('start', 800)
  await resetTabs()

  // Italian
  await M(`window.__synapse.setGlobal({ language: 'it' })`)
  await open('Concepts/Spaced repetition.md')
  await shot('italian', 1000)
  await M(`window.__synapse.setGlobal({ language: 'en' })`)

  // starter screen with the vault list
  await palette(win, 'close vault')
  await win.getByTestId('vault-manager').waitFor()
  // the demo vaults live in a temp folder: show the kind of path a user would have
  await win.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.vault-row-path')) el.textContent = '\u200e/Users/you/Documents/' + (el.textContent ?? '').split('/').pop()
  })
  await shot('welcome', 1000)

  await app.close()
  cleanup(env)
})

