// Sign release/*.zip with the release key so installed apps accept them as in-app updates.
// The private key stays outside the repo (default ~/.config/synapse/update-key.pem). Losing it means
// the next release can only be installed by hand; keep a backup.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const keyFile = process.env.SYNAPSE_UPDATE_KEY || path.join(os.homedir(), '.config/synapse/update-key.pem')
const key = crypto.createPrivateKey(fs.readFileSync(keyFile))
const zips = fs.readdirSync('release').filter((f) => f.endsWith('.zip'))
if (!zips.length) throw new Error('No release/*.zip found. Run "npm run package" first.')
for (const f of zips) {
  const file = path.join('release', f)
  fs.writeFileSync(`${file}.sig`, crypto.sign(null, fs.readFileSync(file), key).toString('base64'))
  console.log(`signed ${file}.sig`)
}
