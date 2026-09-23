// Loads app modules from the app roots and hot-reloads them on change.
// An app is `<root>/<id>.js|.ts` or `<root>/<id>/index.js|.ts` (files it imports
// live next to it). The roots are apps/ plus every folder listed in
// data/app-roots, treated as one merged folder: a later root's entry replaces
// an earlier root's with the same id (normally the same relative path). An
// app's `state` (persisted JSON) and `mem` (volatile) survive a reload, so
// editing a file never loses what the user was looking at.
import { EventEmitter } from 'node:events'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AppContext, OmniApp } from '../shared/app.ts'
import type { DeviceInfo, UserInfo, AppLocation } from '../shared/protocol.ts'
import type { MenuItem } from '../shared/view.ts'
import { APP_ROOTS_FILE, DATA_DIR, DEMO_DIR } from './config.ts'
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
  tz(): string
  locale(): string
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
  /** home-screen folder path, '' = top level */
  group: string
  menu: MenuItem[]
  /** group implied by the folder (before any `group` override in the module) */
  folderGroup: string
  /** same-id entries in earlier roots that this one replaces */
  shadows: string[]
  /** numeric menu id → app's own id, rebuilt every render by the shell */
  menuMap?: Map<number, string>
  /** other-app menu rows: item id → app id */
  menuApps?: Map<number, string>
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

export interface GroupNode { name: string; path: string; groups: Map<string, GroupNode>; apps: LoadedApp[] }

function normalizeGroup(g: string): string {
  return g.split(/[\/\\]+/).map((p) => p.trim()).filter(Boolean).join('/')
}

const ROOTS_HEADER = `# Extra folders Omni loads apps from: one absolute path per line, in order.
# They and apps/ behave like a single merged folder; on a clash (same app id)
# the later folder wins. Saving this file applies it, no restart. See docs/APPS.md.
`

/** Parse data/app-roots: one absolute path (~/ allowed) per line, # comments. */
export function readRootsFile(file = APP_ROOTS_FILE): string[] {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const p = resolve(line === '~' || line.startsWith('~/') ? join(homedir(), line.slice(1)) : line)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

interface ScanEntry { id: string; file: string; group: string; shadows: string[] }
export interface RootSummary { dir: string; base: boolean; missing: boolean; apps: string[] }

export class AppRegistry extends EventEmitter {
  readonly apps = new Map<string, LoadedApp>()
  private reloadTimers = new Map<string, NodeJS.Timeout>()

  /** the base folder (apps/), always the first root */
  readonly dir: string
  /** every folder apps come from, in precedence order: later shadows earlier */
  roots: string[]
  /** listed roots that do not exist (yet); polled for until they do */
  private missingRoots = new Set<string>()
  readonly host: AppHost
  constructor(dir: string, host: AppHost) { super(); this.dir = dir; this.roots = [dir]; this.host = host }

  list(): LoadedApp[] {
    return [...this.apps.values()]
      .filter((a) => !a.hidden)
      .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title))
  }
  get(id: string): LoadedApp | undefined { return this.apps.get(id) }

  /** First run: seed the apps directory from demo/ so there is something to see. */
  bootstrap(): boolean {
    // anything already there (apps or folders of apps) means the user's set exists
    if (existsSync(this.dir) && readdirSync(this.dir).some((f) => !f.startsWith('.'))) return false
    mkdirSync(this.dir, { recursive: true })
    if (!existsSync(DEMO_DIR) || resolve(DEMO_DIR) === resolve(this.dir)) return false
    cpSync(DEMO_DIR, this.dir, { recursive: true })
    log('apps', `seeded ${this.dir} from demo/`)
    return true
  }

  /** Is this path an app entry? A .js/.ts file, or a directory with index.{ts,js,mjs}. */
  entryAt(full: string): { id: string; file: string } | null {
    const name = basename(full)
    if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') return null
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
  /** Top-level convenience used by bootstrap(). */
  entryFor(name: string): { id: string; file: string } | null { return this.entryAt(join(this.dir, name)) }

  /**
   * Walk the apps dir. A directory that is not itself an app is a group; its
   * relative path becomes the default `group` of the apps inside it.
   */
  scan(dir = this.dir, group = ''): { id: string; file: string; group: string }[] {
    const out: { id: string; file: string; group: string }[] = []
    let names: string[] = []
    try { names = readdirSync(dir) } catch { return out }
    for (const name of names.sort()) {
      if (name.startsWith('.') || name.startsWith('_') || name === 'node_modules') continue
      const full = join(dir, name)
      const e = this.entryAt(full)
      if (e) { out.push({ ...e, group }); continue }
      try { if (statSync(full).isDirectory()) out.push(...this.scan(full, group ? `${group}/${name}` : name)) } catch {}
    }
    return out
  }

  /**
   * (Re)read data/app-roots and apply it: roots that appeared are watched
   * (once watching) and roots that went are unwatched. The caller rescans.
   */
  loadRoots(): { added: string[]; removed: string[] } {
    if (!existsSync(APP_ROOTS_FILE)) { try { writeFileSync(APP_ROOTS_FILE, ROOTS_HEADER) } catch {} }
    const wanted = [this.dir]
    for (const p of readRootsFile()) {
      const clash = wanted.find((r) => p === r || p.startsWith(r + sep) || r.startsWith(p + sep))
      if (clash) { if (p !== this.dir) log('warn', `app root ${p} is inside or contains ${clash}; ignored`); continue }
      wanted.push(p)
    }
    const added = wanted.filter((r) => !this.roots.includes(r))
    const removed = this.roots.filter((r) => !wanted.includes(r))
    this.roots = wanted
    for (const r of removed) { this.unwatchRoot(r); this.missingRoots.delete(r); log('apps', `root removed: ${r}`) }
    for (const r of added) {
      if (existsSync(r)) log('apps', `root added: ${r}`)
      else log('warn', `app root ${r} does not exist (listed in ${APP_ROOTS_FILE}); waiting for it`)
      if (this.watching) this.watchRoot(r); else if (!existsSync(r)) this.missingRoots.add(r)
    }
    return { added, removed }
  }

  /**
   * All roots walked as one merged folder. Within a root a duplicate id is a
   * mistake (first wins, warned); across roots it is the overlay: the later
   * root's entry wins and records what it shadows.
   */
  scanAll(): ScanEntry[] {
    const byId = new Map<string, ScanEntry>()
    for (const root of this.roots) {
      const seen = new Map<string, string>()
      for (const e of this.scan(root)) {
        const dup = seen.get(e.id)
        if (dup) { log('warn', `app id "${e.id}" used by both ${dup} and ${e.file}; ignoring the latter`); continue }
        seen.set(e.id, e.file)
        const prev = byId.get(e.id)
        byId.set(e.id, { ...e, shadows: prev ? [prev.file, ...prev.shadows] : [] })
      }
    }
    return [...byId.values()]
  }

  async loadAll(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    this.loadRoots()
    await this.rescan()
  }

  /** Load new/changed entries; unload apps whose entry is gone or now shadowed. */
  async rescan(): Promise<void> {
    const found = this.scanAll()
    const seen = new Set<string>()
    for (const e of found) {
      seen.add(e.id)
      const cur = this.apps.get(e.id)
      if (!cur || cur.file !== e.file || cur.folderGroup !== e.group) {
        if (e.shadows.length) log('apps', `${e.file} shadows ${e.shadows.join(', ')}`)
        await this.load(e.id, e.file, e.group, e.shadows)
      }
    }
    for (const [id, app] of this.apps) {
      if (app.file.startsWith('<builtin')) continue
      if (!seen.has(id)) this.unload(id)
    }
  }

  async load(id: string, file: string, folderGroup?: string, shadows?: string[]): Promise<void> {
    const prev = this.apps.get(id)
    if (folderGroup === undefined) folderGroup = prev?.folderGroup ?? this.groupOfPath(file)
    if (shadows === undefined) shadows = prev?.file === file ? prev.shadows : []
    let mod: OmniApp
    try {
      const url = pathToFileURL(file).href + `?v=${Date.now()}`
      mod = (await import(url)).default
      if (!mod || typeof mod !== 'object') throw new Error('default export must be an object')
      if (typeof mod.render !== 'function') throw new Error('app must export a render(ctx) function')
    } catch (err) {
      log('error', `app ${id}: ${(err as Error).message}`)
      // Keep the app listed with its error so the failure shows on the glasses.
      const broken: LoadedApp = prev ? { ...prev, file, dir: dirname(file), shadows } : this.blank(id, file)
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
    app.folderGroup = folderGroup
    app.shadows = shadows
    app.group = normalizeGroup(typeof mod.group === 'string' ? mod.group : folderGroup)
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
    return { id, file, dir: dirname(file), mod: null, title: id, order: 100, refresh: 0, hidden: false, group: '', folderGroup: '', menu: [], shadows: [], state: {}, mem: {}, timers: new Set(), error: null, loadError: null, ctx: null }
  }

  /** The root a file lives in, if any. */
  rootOf(file: string): string | null {
    return this.roots.find((r) => file.startsWith(r + sep)) ?? null
  }

  /** Group implied by where a file sits under its root. */
  private groupOfPath(file: string): string {
    const root = this.rootOf(file)
    if (!root) return ''
    const rel = dirname(file).slice(root.length + 1)
    const parts = rel ? rel.split(sep) : []
    // a directory app (…/<id>/index.js) does not count its own folder
    if (parts.length && this.entryAt(join(root, ...parts))) parts.pop()
    return parts.join('/')
  }

  /** Roots in precedence order with the ids each one currently provides. */
  rootSummaries(): RootSummary[] {
    return this.roots.map((dir) => ({
      dir, base: dir === this.dir, missing: this.missingRoots.has(dir),
      apps: [...this.apps.values()].filter((a) => this.rootOf(a.file) === dir).map((a) => a.id).sort(),
    }))
  }

  /** Apps grouped for the home screen: nested folders + apps at each level. */
  tree(): GroupNode {
    const root: GroupNode = { name: '', path: '', groups: new Map(), apps: [] }
    for (const app of this.list()) {
      let node = root
      for (const part of app.group ? app.group.split('/') : []) {
        const key = part.toLowerCase()   // 'time' and 'Time' are one folder; first spelling wins
        let next = node.groups.get(key)
        if (!next) { next = { name: part, path: node.path ? `${node.path}/${part}` : part, groups: new Map(), apps: [] }; node.groups.set(key, next) }
        node = next
      }
      node.apps.push(app)
    }
    return root
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
      apps: () => this.list().filter((a) => a.id !== app.id).map((a) => ({ id: a.id, title: a.title, group: a.group, order: a.order, error: a.loadError || a.error })),
      setInterval: (fn, ms) => { const t = setInterval(wrap('interval', fn), ms); app.timers.add(t); return t },
      setTimeout: (fn, ms) => { const t = setTimeout(() => { app.timers.delete(t); wrap('timeout', fn)() }, ms); app.timers.add(t); return t },
      clear: (t) => { clearInterval(t); clearTimeout(t); app.timers.delete(t) },
      audio: (on, source) => host.audio(on, source),
      imu: (on, pace) => host.imu(on, pace),
      location: (opts) => host.location(opts),
      storage: { get: (k) => host.storageGet(k), set: (k, v) => host.storageSet(k, v) },
      get device() { return host.device() },
      get user() { return host.user() },
      get tz() { return host.tz() },
      get locale() { return host.locale() },
      get connected() { return host.connected() },
      fetch: (...a) => fetch(...a),
    }
    return ctx
  }

  /**
   * Watch every root, and data/app-roots for the list itself. Node's recursive
   * fs.watch is unreliable on Linux, so a plain watcher is placed on every
   * directory (re-scanned whenever a directory entry changes) and any event
   * inside an app schedules a reload. A listed root that does not exist yet is
   * polled for until it does.
   */
  watch(): void {
    if (this.watching) return
    this.watching = true
    for (const r of this.roots) this.watchRoot(r)
    try {
      const w = watch(dirname(APP_ROOTS_FILE), (_event, filename) => {
        if (String(filename) === basename(APP_ROOTS_FILE)) this.schedule('<roots>', () => { this.loadRoots(); void this.rescan() })
      })
      w.on('error', () => w.close())
    } catch (err) { log('warn', `cannot watch ${APP_ROOTS_FILE}: ${(err as Error).message}`) }
    setInterval(() => {
      for (const r of this.missingRoots) {
        if (!existsSync(r)) continue
        this.missingRoots.delete(r); log('apps', `root appeared: ${r}`); this.watchRoot(r)
        this.schedule('<roots>', () => void this.rescan())
      }
    }, 5000).unref()
    log('apps', `watching ${this.roots.join(', ')}`)
  }

  private watching = false
  private watchers = new Map<string, FSWatcher>()

  private watchRoot(root: string): void {
    if (!existsSync(root)) { this.missingRoots.add(root); return }
    this.watchDir(root, root)
  }
  private unwatchRoot(root: string): void {
    for (const [p, w] of this.watchers) if (p === root || p.startsWith(root + sep)) { w.close(); this.watchers.delete(p) }
  }

  private watchDir(root: string, dir: string): void {
    if (this.watchers.has(dir)) return
    try {
      const w = watch(dir, (_event, filename) => this.onFsEvent(root, dir, filename ? String(filename) : ''))
      w.on('error', () => { this.watchers.delete(dir); w.close() })
      this.watchers.set(dir, w)
    } catch { return }
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.isDirectory() && !name.name.startsWith('.') && name.name !== 'node_modules') this.watchDir(root, join(dir, name.name))
    }
  }

  /** Debounced: one `fn` per key, 150 ms after the last event. */
  private schedule(key: string, fn: () => void): void {
    const prev = this.reloadTimers.get(key)
    if (prev) clearTimeout(prev)
    this.reloadTimers.set(key, setTimeout(() => { this.reloadTimers.delete(key); fn() }, 150))
  }

  private onFsEvent(root: string, dir: string, filename: string): void {
    if (filename.startsWith('.')) return
    const full = join(dir, filename)
    // New directory → watch it too (and its children).
    try { if (statSync(full).isDirectory()) this.watchDir(root, full) } catch {
      // Gone (deleted or moved away): close its watcher and every descendant's —
      // a rename fires only on the parent, so the subtree's watchers would
      // otherwise follow the inodes forever.
      for (const [p, w] of this.watchers) if (p === full || p.startsWith(full + sep)) { w.close(); this.watchers.delete(p) }
    }
    // Which app entry owns this path? Walk up until an app entry (file, or a
    // directory with index.*) is found; otherwise it is a group-level change.
    // Walk top-down so helper files inside an app folder map to that app
    // rather than being mistaken for apps of their own.
    let entry: { id: string; file: string } | null = null
    const parts = full.slice(root.length + 1).split(sep)
    for (let i = 1; i <= parts.length; i++) {
      const e = this.entryAt(join(root, ...parts.slice(0, i)))
      if (e) { entry = e; break }
    }
    this.schedule(entry ? entry.file : '*', () => {
      const app = entry ? this.apps.get(entry.id) : null
      // Reload in place only when the loaded app is this very entry. A change to
      // an entry that a later root shadows, or a new/removed entry, is a rescan.
      if (entry && app && app.file === entry.file && existsSync(entry.file)) void this.load(app.id, app.file)
      else void this.rescan()
    })
  }
}
