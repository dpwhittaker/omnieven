// Writes client/app.json for PUBLIC_URL and packs the built client into an
// .ehpk for a permanent (private build) install.
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENT_DIST, ROOT } from './config.js'
import { manifest } from './setup.js'

const appJson = join(ROOT, 'client', 'app.json')
writeFileSync(appJson, JSON.stringify(manifest(), null, 2) + '\n')
console.log(`wrote ${appJson}`)
if (!existsSync(CLIENT_DIST)) {
  const b = spawnSync('npm', ['--prefix', join(ROOT, 'client'), 'run', 'build'], { stdio: 'inherit' })
  if (b.status !== 0) process.exit(b.status)
}
const out = join(ROOT, 'omni.ehpk')
const r = spawnSync('npx', ['--prefix', join(ROOT, 'client'), 'evenhub', 'pack', appJson, CLIENT_DIST, '-o', out], { stdio: 'inherit', cwd: join(ROOT, 'client') })
if (r.status !== 0) process.exit(r.status)
console.log(`packed ${out}`)
