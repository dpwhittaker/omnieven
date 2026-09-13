import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = resolve(process.env.OMNI_DATA_DIR || join(ROOT, 'data'))
export const TABS_DIR = resolve(process.env.OMNI_TABS_DIR || join(ROOT, 'tabs'))
export const CLIENT_DIST = join(ROOT, 'client', 'dist')
export const PORT = Number(process.env.PORT || 7788)
export const HOST = process.env.HOST || '0.0.0.0'
export const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

mkdirSync(DATA_DIR, { recursive: true })

// Token: env wins; otherwise generated once and persisted so restarts do not
// force re-pairing the phone.
function loadToken() {
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

export function wsUrl() {
  const u = new URL(PUBLIC_URL)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws'
  return u.toString()
}
