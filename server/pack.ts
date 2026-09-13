// Writes client/app.json for PUBLIC_URL and packs the built client into an
// .ehpk for a permanent (private build) install.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CLIENT_DIST, ROOT, wsUrl } from './config.ts'
import { manifest } from './setup.ts'

// The Even app only reinstalls a private build whose version is higher than
// the one already installed, so every pack bumps the patch version
// (package.json is the single source of the version). Pass --no-bump to keep it.
const pkgFile = join(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
if (!process.argv.includes('--no-bump')) {
  const [ma, mi, pa] = pkg.version.split('.').map(Number)
  pkg.version = `${ma}.${mi}.${pa + 1}`
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
  console.log(`version bumped to ${pkg.version}`)
}

const appJson = join(ROOT, 'client', 'app.json')
writeFileSync(appJson, JSON.stringify({ ...manifest(), version: pkg.version }, null, 2) + '\n')
console.log(`wrote ${appJson} (version ${pkg.version})`)
// Always rebuild so the WebSocket URL for this PUBLIC_URL is baked into the
// bundle; the installed app then only needs the token.
const b = spawnSync('npm', ['--prefix', join(ROOT, 'client'), 'run', 'build'], {
  stdio: 'inherit', env: { ...process.env, VITE_OMNI_WS_URL: wsUrl() },
})
if (b.status !== 0) process.exit(b.status ?? 1)
console.log(`built client with default server ${wsUrl()}`)
const out = join(ROOT, 'omni.ehpk')
const r = spawnSync('npx', ['--prefix', join(ROOT, 'client'), 'evenhub', 'pack', appJson, CLIENT_DIST, '-o', out], { stdio: 'inherit', cwd: join(ROOT, 'client') })
if (r.status !== 0) process.exit(r.status ?? 1)
console.log(`packed ${out}`)
