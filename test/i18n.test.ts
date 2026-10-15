import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DICTIONARIES, COMMAND_NAMES_IT, t, tn, resolveLanguage, commandName } from '../src/shared/i18n'
import { AppStore } from '../src/main/store'
import { normalizeGlobal } from '../src/shared/settings'

describe('dictionaries', () => {
  it('Italian defines every English key with the same placeholders', () => {
    for (const [key, en] of Object.entries(DICTIONARIES.en)) {
      const it_ = DICTIONARIES.it[key as keyof typeof DICTIONARIES.en]
      expect(it_, key).toBeTruthy()
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(vars(it_), key).toEqual(vars(en))
    }
  })

  it('every command has an Italian name', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/renderer/commands.ts'), 'utf8')
    const ids = [...src.matchAll(/id: '([a-z-]+:[a-z0-9-]+)'/g)].map((m) => m[1])
    ids.push(...[1, 2, 3, 4, 5, 6].map((n) => `editor:set-heading-${n}`), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `workspace:goto-tab-${n}`))
    expect(ids.length).toBeGreaterThan(50)
    for (const id of ids) expect(COMMAND_NAMES_IT[id], id).toBeTruthy()
  })
})

describe('lookup', () => {
  it('fills placeholders and pluralizes per language', () => {
    expect(t('vaults.notFound', { path: '/x' }, 'it')).toBe('Cartella non trovata: /x')
    expect(tn('count.words', 1, 'en')).toBe('1 word')
    expect(tn('count.words', 2, 'it')).toBe('2 parole')
    expect(tn('count.words', 12000, 'it')).toBe('12.000 parole')
    expect(commandName('graph:open', 'Graph view: Open graph view', 'it')).toBe('Vista grafo: Apri grafo')
    expect(commandName('graph:open', 'Graph view: Open graph view', 'en')).toBe('Graph view: Open graph view')
  })

  it('unknown keys come back unchanged', () => {
    expect(t('error.NOPE' as never)).toBe('error.NOPE')
  })

  it('resolves system language from preferred locales', () => {
    expect(resolveLanguage('system', ['it-IT', 'en-US'])).toBe('it')
    expect(resolveLanguage('system', ['de-DE', 'en-GB'])).toBe('en')
    expect(resolveLanguage('system', ['fr-FR'])).toBe('en')
    expect(resolveLanguage('en', ['it-IT'])).toBe('en')
    expect(resolveLanguage(undefined, ['it'])).toBe('it')
  })
})

describe('language setting', () => {
  it('is global, validated and persisted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-i18n-'))
    try {
      const app = new AppStore(dir)
      expect(app.getGlobal().language).toBe('system')
      await app.updateGlobal({ language: 'it' })
      expect(new AppStore(dir).getGlobal().language).toBe('it')
      await app.updateGlobal({ language: 'klingon' })
      expect(new AppStore(dir).getGlobal().language).toBe('it')
      expect(normalizeGlobal({ version: 2, language: 42 }).language).toBe('system')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
