// Loads tab modules from the tabs directory and hot-reloads them on change.
// A tab's `state` (persisted JSON) and `mem` (volatile) survive a reload so
// editing a file never loses what the user was looking at.
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATA_DIR } from './config.js'
import { log } from './log.js'
import { Canvas } from './png.js'
import { SCREEN } from './renderer.js'
import * as ui from './ui.js'

const STATE_DIR = join(DATA_DIR, 'state')
mkdirSync(STATE_DIR, { recursive: true })

function loadState(id) {
  const f = join(STATE_DIR, `${id}.json`)
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
function saveState(id, state) {
  try { writeFileSync(join(STATE_DIR, `${id}.json`), JSON.stringify(state, null, 2)) }
  catch (err) { log('warn', `state save ${id}: ${err.message}`) }
}

export class TabRegistry extends EventEmitter {
  /**
   * @param {string} dir  tabs directory
   * @param {object} host callbacks implemented by the shell
   */
  constructor(dir, host) {
    super()
    this.dir = dir
    this.host = host
    this.tabs = new Map()
    this.watcher = null
    this.reloadTimers = new Map()
  }

  list() {
    return [...this.tabs.values()]
      .filter((t) => !t.hidden)
      .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title))
  }
  get(id) { return this.tabs.get(id) }

  async loadAll() {
    mkdirSync(this.dir, { recursive: true })
    for (const f of readdirSync(this.dir)) {
      if (this.isTabFile(f)) await this.loadFile(join(this.dir, f))
    }
  }

  isTabFile(f) { return /\.(m?js)$/.test(f) && !f.startsWith('.') && !f.startsWith('_') }

  async loadFile(file) {
    const id = basename(file, extname(file))
    const prev = this.tabs.get(id)
    let mod
    try {
      const url = pathToFileURL(file).href + `?v=${statSync(file).mtimeMs}-${Date.now()}`
      mod = (await import(url)).default
      if (!mod || typeof mod !== 'object') throw new Error('default export must be an object')
    } catch (err) {
      log('error', `tab ${id}: ${err.message}`)
      // Keep the tab visible with its error so the failure shows on the glasses.
      const broken = prev ? { ...prev } : this.blank(id, file)
      broken.loadError = err.message
      this.tabs.set(id, broken)
      this.emit('changed', id)
      return
    }
    if (prev) this.teardown(prev)
    const tab = this.blank(id, file)
    tab.mod = mod
    tab.title = String(mod.title || id).slice(0, 32)
    tab.order = Number.isFinite(mod.order) ? mod.order : 100
    tab.refresh = Number(mod.refresh) > 0 ? Number(mod.refresh) : 0
    tab.hidden = !!mod.hidden
    tab.menu = Array.isArray(mod.menu) ? mod.menu : []
    tab.state = prev ? prev.state : loadState(id)
    tab.mem = prev ? prev.mem : {}
    tab.ctx = this.makeContext(tab)
    try {
      if (typeof mod.init === 'function') await mod.init(tab.ctx)
    } catch (err) {
      tab.error = `init: ${err.message}`
      log('error', `tab ${id} init: ${err.stack || err.message}`)
    }
    this.tabs.set(id, tab)
    log('tabs', `${prev ? 'reloaded' : 'loaded'} ${id} ("${tab.title}")`)
    this.emit('changed', id)
  }

  blank(id, file) {
    return { id, file, mod: null, title: id, order: 100, refresh: 0, hidden: false, menu: [], state: {}, mem: {}, timers: new Set(), error: null, loadError: null, ctx: null }
  }

  teardown(tab) {
    for (const t of tab.timers) { clearInterval(t); clearTimeout(t) }
    tab.timers.clear()
    try { tab.mod?.unload?.(tab.ctx) } catch (err) { log('warn', `tab ${tab.id} unload: ${err.message}`) }
    saveState(tab.id, tab.state)
  }

  unload(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.teardown(tab)
    this.tabs.delete(id)
    log('tabs', `unloaded ${id}`)
    this.emit('changed', id)
  }

  saveAll() { for (const t of this.tabs.values()) saveState(t.id, t.state) }

  /** The `ctx` object handed to every tab hook. */
  makeContext(tab) {
    const host = this.host
    let saveTimer = null
    const persist = () => {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveState(tab.id, tab.state), 400)
    }
    const ctx = {
      id: tab.id,
      get title() { return tab.title },
      state: tab.state,   // persisted to data/state/<id>.json
      mem: tab.mem,       // volatile, survives hot reload
      screen: SCREEN,
      ui, Canvas,
      log: (...a) => log(`tab:${tab.id}`, a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
      get active() { return host.isActive(tab.id) },
      render: () => { persist(); host.requestRender(tab.id) },
      save: () => persist(),
      notify: (text, opts) => host.notify(text, opts),
      open: (id) => host.open(id),
      home: () => host.home(),
      exit: () => host.exit(),
      setInterval: (fn, ms) => { const t = setInterval(() => { try { fn() } catch (e) { ctx.log(`interval: ${e.message}`) } }, ms); tab.timers.add(t); return t },
      setTimeout: (fn, ms) => { const t = setTimeout(() => { tab.timers.delete(t); try { fn() } catch (e) { ctx.log(`timeout: ${e.message}`) } }, ms); tab.timers.add(t); return t },
      clear: (t) => { clearInterval(t); clearTimeout(t); tab.timers.delete(t) },
      audio: (on, source) => host.audio(on, source),
      imu: (on, pace) => host.imu(on, pace),
      location: (opts) => host.location(opts),
      storage: { get: (k) => host.storageGet(k), set: (k, v) => host.storageSet(k, v) },
      get device() { return host.device() },
      get connected() { return host.connected() },
      fetch: (...a) => fetch(...a),
    }
    return ctx
  }

  watch() {
    if (this.watcher) return
    try {
      this.watcher = watch(this.dir, (event, filename) => {
        if (!filename || !this.isTabFile(filename)) return
        clearTimeout(this.reloadTimers.get(filename))
        this.reloadTimers.set(filename, setTimeout(() => {
          const file = join(this.dir, filename)
          if (existsSync(file)) this.loadFile(file)
          else this.unload(basename(filename, extname(filename)))
        }, 150))
      })
      log('tabs', `watching ${this.dir}`)
    } catch (err) {
      log('warn', `tabs watch failed: ${err.message}`)
    }
  }
}
