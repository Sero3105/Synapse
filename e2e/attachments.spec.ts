import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup } from './helpers'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test('attachment report lists missing and possibly unused files, and deletes nothing', async () => {
  const env = makeEnv({
    'Notes/Trip.md': '# Trip\n\n![[Café photo.png]]\n![[gone.png]]\n',
    'Cover.md': '---\ncover: media/cover.jpg\n---\nText\n',
    'media/Café photo.png': PNG,
    'media/cover.jpg': PNG,
    'media/old scan.pdf': 'pdf',
  })
  try {
    const { app, win } = await launch(env)
    await expect(win.getByTestId('file-explorer')).toBeVisible()
    await palette(win, 'missing and unused attachments')
    const report = win.getByTestId('attachments-report')
    await expect(report.getByTestId('missing-attachment')).toHaveCount(1)
    await expect(report.getByTestId('missing-attachment')).toContainText('gone.png')
    await expect(report.getByTestId('missing-attachment')).toContainText('in Trip, line 4')
    // only the PDF is flagged: the photo is embedded, the cover is named in frontmatter
    await expect(report.getByTestId('unused-attachment')).toHaveCount(1)
    await expect(report.getByTestId('unused-attachment')).toContainText('old scan.pdf')
    // clicking a missing entry opens the referencing note
    await report.getByTestId('missing-attachment').locator('.search-result-file').click()
    await expect(report).toHaveCount(0)
    await expect(win.locator('.cm-content')).toContainText('gone.png')
    for (const f of ['media/Café photo.png', 'media/cover.jpg', 'media/old scan.pdf']) expect(fs.existsSync(path.join(env.vault, f))).toBe(true)
    await app.close()
  } finally {
    cleanup(env)
  }
})
