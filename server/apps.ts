// Loads app modules from the apps directory and hot-reloads them on change.
// An app is `apps/<id>.js|.ts` or `apps/<id>/index.js|.ts` (files it imports
// live next to it). An app's `state` (persisted JSON) and `mem` (volatile)
// survive a reload, so editing a file never loses what the user was looking at.
import { EventEmitter } from 'node:events'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppContext, OmniApp } from '../shared/app.ts'
import type { DeviceInfo, UserInfo, AppLocation } from '../shared/protocol.ts'
import type { MenuItem } from '../shared/view.ts'
import { DATA_DIR, DEMO_DIR } from './config.ts'
import { log } from './log.ts'
import { Canvas } from './png.ts'
import { SCREEN } from './renderer.ts'
import * as ui from './ui.ts'

const STATE_DIR = join(DATA_DIR, 'state')
const APP_DATA_DIR = join(DATA_DIR, 'apps')
mkdirSync(STATE_DIR, { recursive: true })
mkdirSync(APP_DATA_DIR, { recursive: true })

/** Callbacks the shell provides to app contexts. */
export interface AppHost {
  requestRender(id: string): void
  isActive(id: string): boolean
  notify(text: string, opts?: { title?: string; ms?: number }): void
  open(id: string): void
  home(): void
  exit(): Promise<unknown>
  message(id: string, msg: unknown): unknown
  audio(on: boolean, source?: 'glasses' | 'phone'): Promise<unknown>
  imu(on: boolean, pace?: number): Promise<unknown>
  location(opts?: Record<string, unknown>): Promise<AppLocation | boolean | null>
  storageGet(key: string): Promise<string>
  storageSet(key: string, value: string): Promise<boolean>
  device(): DeviceInfo | null
  user(): UserInfo | null
  connected(): boolean
}

/** A loaded (or failed) app. */
export interface LoadedApp {
  id: string
  file: string
  dir: string
  mod: OmniApp | null
  title: string
  order: number
  refresh: number
  hidden: boolean
  menu: MenuItem[]
  /** numeric menu id → app's own id, rebuilt every render by the shell */
  menuMap?: Map<number, string>
  state: Record<string, any>
  mem: Record<string, any>
  timers: Set<NodeJS.Timeout>
  error: string | null
  loadError: string | null
  ctx: AppContext | null
}

function loadState(id: string): Record<string, any> {
  const f = join(STATE_DIR, `${id}.json`)
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
function saveState(id: string, state: unknown): void {
  try { writeFileSync(join(STATE_DIR, `${id}.json`), JSON.stringify(state, null, 2)) }
  catch (err) { log('warn', `state save ${id}: ${(err as Error).message}`) }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i
const ENTRY_RE = /\.(m?js|ts)$/

export class AppRegistry extends EventEmitter {
  readonly apps = new Map<string, LoadedApp>()
  private reloadTimers = new Map<string, NodeJS.Timeout>()

  readonly dir: string
  readonly host: AppHost
  constructor(dir: string, host: AppHost) { super(); this.dir = dir; this.host = host }

  list(): LoadedApp[] {
    return [...this.apps.values()]
      .filter((a) => !a.hidden)
      .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title))
  }
  get(id: string): LoadedApp | undefined { return this.apps.get(id) }

  /** First run: seed the apps directory from demo/ so there is something to see. */
  bootstrap(): boolean {
    if (existsSync(this.dir) && readdirSync(this.dir).some((f) => this.entryFor(f))) return false
    mkdirSync(this.dir, { recursive: true })
    if (!existsSync(DEMO_DIR)) return false
    cpSync(DEMO_DIR, this.dir, { recursive: true })
    log('apps', `seeded ${this.dir} from demo/`)
    return true
  }

  /** Map a top-level entry of the apps dir to {id, file} or null. */
  entryFor(name: string): { id: string; file: string } | null {
    if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') return null
    const full = join(this.dir, name)
    try {
      const st = statSync(full)
      if (st.isDirectory()) {
        if (!ID_RE.test(name)) return null
        for (const idx of ['index.ts', 'index.js', 'index.mjs']) {
          if (existsSync(join(full, idx))) return { id: name, file: join(full, idx) }
        }
        return null
      }
      const id = basename(name, extname(name))
      if (ENTRY_RE.test(name) && ID_RE.test(id)) return { id, file: full }
    } catch {}
    return null
  }

  async loadAll(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    for (const name of readdirSync(this.dir)) {
      const e = this.entryFor(name)
      if (e) await this.load(e.id, e.file)
    }
  }

  async load(id: string, file: string): Promise<void> {
    const prev = this.apps.get(id)
    let mod: OmniApp
    try {
      const url = pathToFileURL(file).href + `?v=${Date.now()}`
      mod = (await import(url)).default
      if (!mod || typeof mod !== 'object') throw new Error('default export must be an object')
      if (typeof mod.render !== 'function') throw new Error('app must export a render(ctx) function')
    } catch (err) {
      log('error', `app ${id}: ${(err as Error).message}`)
      // Keep the app listed with its error so the failure shows on the glasses.
      const broken: LoadedApp = prev ? { ...prev } : this.blank(id, file)
      broken.loadError = (err as Error).message
      this.apps.set(id, broken)
      this.emit('changed', id)
      return
    }
    if (prev) this.teardown(prev)
    const app = this.blank(id, file)
    app.mod = mod
    app.title = String(mod.title || id).slice(0, 32)
    app.order = Number.isFinite(mod.order) ? (mod.order as number) : 100
    app.refresh = Number(mod.refresh) > 0 ? Number(mod.refresh) : 0
    app.hidden = !!mod.hidden
    app.menu = Array.isArray(mod.menu) ? mod.menu : []
    app.state = prev ? prev.state : loadState(id)
    app.mem = prev ? prev.mem : {}
    app.ctx = this.makeContext(app)
    try {
      if (typeof mod.init === 'function') await mod.init.call(mod, app.ctx)
    } catch (err) {
      app.error = `init: ${(err as Error).message}`
      log('error', `app ${id} init: ${(err as Error).stack || (err as Error).message}`)
    }
    this.apps.set(id, app)
    log('apps', `${prev ? 'reloaded' : 'loaded'} ${id} ("${app.title}")`)
    this.emit('changed', id)
  }

  private blank(id: string, file: string): LoadedApp {
    return { id, file, dir: dirname(file), mod: null, title: id, order: 100, refresh: 0, hidden: false, menu: [], state: {}, mem: {}, timers: new Set(), error: null, loadError: null, ctx: null }
  }

  private teardown(app: LoadedApp): void {
    for (const t of app.timers) { clearInterval(t); clearTimeout(t) }
    app.timers.clear()
    try { if (app.ctx) app.mod?.unload?.call(app.mod, app.ctx) } catch (err) { log('warn', `app ${app.id} unload: ${(err as Error).message}`) }
    saveState(app.id, app.state)
  }

  unload(id: string): void {
    const app = this.apps.get(id)
    if (!app) return
    this.teardown(app)
    this.apps.delete(id)
    log('apps', `unloaded ${id}`)
    this.emit('changed', id)
  }

  saveAll(): void { for (const a of this.apps.values()) saveState(a.id, a.state) }

  /** Register a server-provided app (not from the apps dir); never reloaded. */
  async registerBuiltin(id: string, mod: OmniApp<any, any>): Promise<void> {
    const app = this.blank(id, `<builtin:${id}>`)
    app.mod = mod
    app.title = String(mod.title || id)
    app.hidden = !!mod.hidden
    app.order = Number.isFinite(mod.order) ? (mod.order as number) : 1000
    app.menu = Array.isArray(mod.menu) ? mod.menu : []
    app.ctx = this.makeContext(app)
    try { if (typeof mod.init === 'function') await mod.init.call(mod, app.ctx) } catch (err) { app.error = `init: ${(err as Error).message}` }
    this.apps.set(id, app)
  }

  /** The `ctx` object handed to every app hook. */
  private makeContext(app: LoadedApp): AppContext {
    const host = this.host
    let saveTimer: NodeJS.Timeout | null = null
    const persist = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveState(app.id, app.state), 400)
    }
    const dataDir = join(APP_DATA_DIR, app.id)
    const wrap = (label: string, fn: () => void) => () => { try { fn() } catch (e) { ctx.log(`${label}: ${(e as Error).message}`) } }
    const ctx: AppContext = {
      id: app.id,
      get title() { return app.title },
      state: app.state,
      mem: app.mem,
      get dataDir() { mkdirSync(dataDir, { recursive: true }); return dataDir },
      env: process.env,
      screen: SCREEN,
      ui, Canvas,
      log: (...a) => log(`app:${app.id}`, a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
      get active() { return host.isActive(app.id) },
      render: () => { persist(); host.requestRender(app.id) },
      save: () => persist(),
      notify: (text, opts) => host.notify(text, opts),
      open: (id = app.id) => host.open(id),
      home: () => host.home(),
      exit: () => host.exit(),
      message: (id, msg) => host.message(id, msg),
      setInterval: (fn, ms) => { const t = setInterval(wrap('interval', fn), ms); app.timers.add(t); return t },
      setTimeout: (fn, ms) => { const t = setTimeout(() => { app.timers.delete(t); wrap('timeout', fn)() }, ms); app.timers.add(t); return t },
      clear: (t) => { clearInterval(t); clearTimeout(t); app.timers.delete(t) },
      audio: (on, source) => host.audio(on, source),
      imu: (on, pace) => host.imu(on, pace),
      location: (opts) => host.location(opts),
      storage: { get: (k) => host.storageGet(k), set: (k, v) => host.storageSet(k, v) },
      get device() { return host.device() },
      get user() { return host.user() },
      get connected() { return host.connected() },
      fetch: (...a) => fetch(...a),
    }
    return ctx
  }

  /**
   * Watch the apps dir. Node's recursive fs.watch is unreliable on Linux, so a
   * plain watcher is placed on every directory (re-scanned whenever a
   * directory entry changes) and any event inside an app schedules a reload.
   */
  watch(): void {
    if (this.watchers.size) return
    this.watchDir(this.dir)
    log('apps', `watching ${this.dir}`)
  }

  private watchers = new Map<string, FSWatcher>()

  private watchDir(dir: string): void {
    if (this.watchers.has(dir)) return
    try {
      const w = watch(dir, (_event, filename) => this.onFsEvent(dir, filename ? String(filename) : ''))
      w.on('error', () => { this.watchers.delete(dir); w.close() })
      this.watchers.set(dir, w)
    } catch { return }
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory() && !name.name.startsWith('.') && name.name !== 'node_modules') this.watchDir(join(dir, name.name))
    }
  }

  private onFsEvent(dir: string, filename: string): void {
    if (filename.startsWith('.')) return
    const full = join(dir, filename)
    // New directory → watch it too (and its children).
    try { if (statSync(full).isDirectory()) this.watchDir(full) } catch {
      // Deleted directory: drop its watcher.
      const w = this.watchers.get(full)
      if (w) { w.close(); this.watchers.delete(full) }
    }
    // Which top-level app entry does this belong to?
    const rel = full.slice(this.dir.length + 1)
    const top = rel.split(sep)[0]
    if (!top || top.startsWith('.') || top === 'node_modules') return
    const prev = this.reloadTimers.get(top)
    if (prev) clearTimeout(prev)
    this.reloadTimers.set(top, setTimeout(() => {
      const e = this.entryFor(top)
      if (e) void this.load(e.id, e.file)
      else this.unload(basename(top, extname(top)))
    }, 150))
  }
}
