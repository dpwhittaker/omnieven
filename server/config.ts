import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Optional .env in the project root (KEY=VALUE lines, # comments). Real
// environment variables win. This is where API keys for apps go.
function loadDotEnv(): void {
  const f = join(ROOT, '.env')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadDotEnv()

export const DATA_DIR = resolve(process.env.OMNI_DATA_DIR || join(ROOT, 'data'))
export const APPS_DIR = resolve(process.env.OMNI_APPS_DIR || join(ROOT, 'apps'))
/** Extra app folders, one absolute path per line; later lines shadow earlier ones and apps/. */
export const APP_ROOTS_FILE = join(DATA_DIR, 'app-roots')
export const DEMO_DIR = join(ROOT, 'demo')
export const CLIENT_DIST = join(ROOT, 'client', 'dist')
export const PORT = Number(process.env.PORT || 7788)
export const HOST = process.env.HOST || '0.0.0.0'
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

mkdirSync(DATA_DIR, { recursive: true })

// Token: env wins; otherwise generated once and persisted so restarts do not
// force re-pairing the phone.
function loadToken(): string {
  if (process.env.OMNI_TOKEN) return process.env.OMNI_TOKEN.trim()
  const f = join(DATA_DIR, 'token')
  if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  const t = randomBytes(12).toString('hex')
  writeFileSync(f, t + '\n', { mode: 0o600 })
  return t
}
export const TOKEN = loadToken()

// Public origin the phone reaches us at (behind a TLS proxy this differs from
// the bind address). Used for the QR code, the app.json whitelist and the
// default WebSocket URL baked into the client.
export const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')

/**
 * The client's URL for the phone, carrying a fingerprint of the built bundle:
 * the Even App's WebView replays a cached copy of /app/ on a plain reload and
 * never re-asks the server, so only a changed URL delivers a new build.
 */
export function clientTag(): string {
  try { return createHash('sha1').update(readFileSync(join(CLIENT_DIST, 'index.html'))).digest('hex').slice(0, 8) } catch { return '0' }
}
export function clientAppUrl(): string { return `${PUBLIC_URL}/app/?token=${encodeURIComponent(TOKEN)}&v=${clientTag()}` }

export function wsUrl(): string {
  const u = new URL(PUBLIC_URL)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws'
  return u.toString()
}
