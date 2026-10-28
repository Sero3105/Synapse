// Keep package.json in step with the newest release tag, so nobody has to
// remember to bump it by hand before packaging. No tag nearby: leave it alone.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

let tag = ''
try {
  tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch { /* not a git checkout, or no tags fetched */ }
const m = /^v?(\d+\.\d+\.\d+)$/.exec(tag)
if (m) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  if (pkg.version !== m[1]) {
    execFileSync('npm', ['pkg', 'set', `version=${m[1]}`], { stdio: 'inherit' })
    console.log(`version: ${pkg.version} -> ${m[1]} (from tag ${tag})`)
  }
}
