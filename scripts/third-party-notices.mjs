// Generate dist/THIRD_PARTY_NOTICES.txt for the packaged app.
// Starts from the packages the source actually imports, follows their runtime dependencies,
// and embeds each package's own license text. Fails if a package has no license text or uses
// a license that is not on the permissive allow-list, so a release cannot ship without notices.
import fs from 'node:fs'
import path from 'node:path'

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Python-2.0'])
const SRC = ['src/renderer', 'src/shared', 'src/main', 'src/preload']
const BUILTIN = /^(node:|electron$)/

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (/\.(ts|tsx)$/.test(e.name)) yield p
  }
}

const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
const roots = new Set()
for (const dir of SRC)
  for (const f of files(dir))
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/from '([^.'][^']*)'/g)) if (!BUILTIN.test(m[1]) && !m[1].startsWith('import ')) roots.add(pkgName(m[1]))

const seen = new Map()
const visit = (name) => {
  if (seen.has(name)) return
  const dir = path.join('node_modules', name)
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  seen.set(name, { dir, pj })
  for (const dep of Object.keys(pj.dependencies ?? {})) visit(dep)
  for (const dep of Object.keys(pj.peerDependencies ?? {})) if (fs.existsSync(path.join('node_modules', dep))) visit(dep)
}
for (const r of roots) visit(r)

const problems = []
const sections = []
for (const [name, { dir, pj }] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
  const license = typeof pj.license === 'string' ? pj.license : pj.license?.type
  if (!ALLOWED.has(license)) problems.push(`${name}: license "${license}" is not on the allow-list`)
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)([.-]|$)/i.test(f))
  if (!file) problems.push(`${name}: no license file in the package`)
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : ''
  sections.push(`${'='.repeat(78)}\n${name}@${pj.version} (${license})\n${pj.homepage ?? pj.repository?.url ?? ''}\n${'-'.repeat(78)}\n${text}\n`)
}
if (problems.length) {
  console.error('Third-party license check failed:\n  ' + problems.join('\n  '))
  process.exit(1)
}

const header = `Synapse includes the following third-party software.
Electron and Chromium notices are shipped alongside this file as
LICENSE.electron.txt and LICENSES.chromium.html.

${seen.size} packages, generated ${new Date().toISOString().slice(0, 10)}.
`
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/THIRD_PARTY_NOTICES.txt', header + '\n' + sections.join('\n'))
console.log(`wrote dist/THIRD_PARTY_NOTICES.txt (${seen.size} packages from ${roots.size} direct imports)`)
