// The dashboard itself: a home list of tabs, one active tab, a contextual
// menu for jumping between them, transient notifications, and the routing
// of glasses events to whichever of those is on screen.
import { EventEmitter } from 'node:events'
import { normalizeEvent } from './protocol.js'
import { compile, SCREEN } from './renderer.js'
import { TabRegistry } from './tabs.js'
import { log } from './log.js'

const MENU = { HOME: 1, EXIT: 2, TAB_BASE: 10, CUSTOM_BASE: 100 }
const RENDER_DEBOUNCE_MS = 30
const DEFAULT_NOTIFY_MS = 5000

export class Shell extends EventEmitter {
  constructor({ tabsDir }) {
    super()
    this.connections = new Set()
    this.activeId = null          // null = home
    this.overlay = null           // {text, timer}
    this.scratch = null           // ad-hoc view pushed through the API
    this.refreshTimer = null
    this.renderTimer = null
    this.lastEvent = null
    this.registry = new TabRegistry(tabsDir, {
      requestRender: (tabId) => { if (this.isActive(tabId)) this.requestRender() },
      isActive: (tabId) => this.isActive(tabId),
      notify: (text, opts) => this.notify(text, opts),
      open: (id) => this.open(id),
      home: () => this.home(),
      exit: () => this.exit(),
      audio: (on, source) => this.broadcast('audio', { on: !!on, source }, (c, ok) => { if (ok) c.audioOn = !!on }),
      imu: (on, pace) => this.broadcast('imu', { on: !!on, pace }, (c, ok) => { if (ok) c.imuOn = !!on }),
      location: (opts = {}) => this.first('location', opts.once === false ? opts : { once: true, ...opts }),
      storageGet: (key) => this.first('storage.get', { key }),
      storageSet: (key, value) => this.first('storage.set', { key, value }),
      device: () => [...this.connections].map((c) => c.device).find(Boolean) || null,
      connected: () => this.connections.size > 0,
    })
    this.registry.on('changed', (id) => {
      if (this.activeId && !this.registry.get(this.activeId)) this.activeId = null
      if (this.isActive(id) || this.activeId === null) this.requestRender()
      this.emit('tabs', this.tabSummaries())
    })
  }

  async start() {
    await this.registry.loadAll()
    this.registry.watch()
  }

  // ── connections ────────────────────────────────────────────────────
  addConnection(conn) {
    this.connections.add(conn)
    this.emit('connection', { type: 'open', conn: conn.summary() })
    this.syncRefresh()
    this.requestRender()
  }
  removeConnection(conn) {
    this.connections.delete(conn)
    this.emit('connection', { type: 'close', conn: conn.summary() })
    this.syncRefresh()
  }

  async broadcast(op, args, after) {
    const results = await Promise.all([...this.connections].map(async (c) => {
      try { const v = await c.cmd(op, args); after?.(c, true, v); return v } catch (err) { after?.(c, false); log('warn', `${op}: ${err.message}`); return null }
    }))
    return results
  }
  async first(op, args) {
    const c = [...this.connections][0]
    if (!c) throw new Error('no glasses connected')
    return c.cmd(op, args)
  }

  // ── state ──────────────────────────────────────────────────────────
  isActive(id) { return this.activeId === id && !this.scratch }
  get activeTab() { return this.activeId ? this.registry.get(this.activeId) : null }

  tabSummaries() {
    return this.registry.list().map((t) => ({
      id: t.id, title: t.title, order: t.order, refresh: t.refresh, error: t.loadError || t.error,
      active: this.isActive(t.id), menu: t.menu,
    }))
  }

  open(id) {
    const tab = this.registry.get(id)
    if (!tab || tab.hidden) throw new Error(`no such tab: ${id}`)
    const prev = this.activeTab
    if (prev && prev.id !== id) this.safe(prev, 'onClose')
    this.scratch = null
    this.activeId = id
    if (prev?.id !== id) this.safe(tab, 'onOpen')
    log('shell', `open ${id}`)
    this.syncRefresh()
    this.requestRender()
    this.emit('nav', { active: id })
  }

  home() {
    const prev = this.activeTab
    if (prev) this.safe(prev, 'onClose')
    this.scratch = null
    this.activeId = null
    this.syncRefresh()
    this.requestRender()
    this.emit('nav', { active: null })
  }

  /** Show an arbitrary view (from the API) until the user navigates away. */
  show(view) {
    this.scratch = view
    this.syncRefresh()
    this.requestRender()
  }

  async exit() { return this.broadcast('shutdown', { mode: 1 }) }

  notify(text, opts = {}) {
    const ms = Number(opts.ms ?? opts.duration ?? DEFAULT_NOTIFY_MS)
    if (this.overlay) clearTimeout(this.overlay.timer)
    this.overlay = {
      text: String(text ?? ''), title: opts.title,
      timer: setTimeout(() => this.dismiss(), Math.max(500, ms)),
    }
    log('shell', `notify: ${String(text).slice(0, 80)}`)
    this.requestRender()
  }
  dismiss() {
    if (!this.overlay) return
    clearTimeout(this.overlay.timer)
    this.overlay = null
    this.requestRender()
  }

  safe(tab, hook, ...args) {
    const fn = tab?.mod?.[hook]
    if (typeof fn !== 'function') return undefined
    try { return fn.call(tab.mod, tab.ctx, ...args) } catch (err) {
      log('error', `tab ${tab.id} ${hook}: ${err.stack || err.message}`)
      tab.error = `${hook}: ${err.message}`
      return undefined
    }
  }

  syncRefresh() {
    clearInterval(this.refreshTimer)
    this.refreshTimer = null
    const tab = this.activeTab
    if (!tab || this.scratch || !tab.refresh || !this.connections.size) return
    this.refreshTimer = setInterval(() => this.requestRender(), tab.refresh)
  }

  // ── rendering ──────────────────────────────────────────────────────
  requestRender() {
    clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(() => this.renderNow(), RENDER_DEBOUNCE_MS)
  }

  renderNow() {
    const view = this.currentView()
    this.lastView = view
    for (const c of this.connections) c.render(view)
    try { this.emit('render', compile(view).textDump) } catch {}
  }

  currentView() {
    if (this.overlay) return this.overlayView()
    if (this.scratch) return this.scratch
    const tab = this.activeTab
    if (!tab) return this.homeView()
    if (tab.loadError) return { text: `${tab.title}\n\nfailed to load ${tab.file.split('/').pop()}:\n${tab.loadError}`, menu: this.menuFor(tab) }
    if (!tab.mod) return { text: `${tab.title}\n\nERROR: ${tab.error}`, menu: this.menuFor(tab) }
    let view
    try { view = tab.mod.render(tab.ctx) } catch (err) {
      log('error', `tab ${tab.id} render: ${err.stack || err.message}`)
      return { text: `${tab.title}\n\nrender error:\n${err.message}`, menu: this.menuFor(tab) }
    }
    return this.withMenu(view, tab)
  }

  homeView() {
    const tabs = this.registry.list()
    const items = tabs.length ? tabs.map((t) => (t.loadError || t.error ? `! ${t.title}` : t.title)) : ['(no tabs yet)']
    return {
      containers: [
        { type: 'text', name: 'header', x: 0, y: 0, w: SCREEN.width, h: 34, padding: 4, textColor: 2,
          text: `Omni  ·  ${tabs.length} tab${tabs.length === 1 ? '' : 's'}  ·  tap to open, double-tap to exit` },
        { type: 'list', name: 'tabs', x: 0, y: 34, w: SCREEN.width, h: SCREEN.height - 34, items, capture: true },
      ],
      menu: [{ id: MENU.EXIT, label: 'Exit Omni' }],
    }
  }

  overlayView() {
    const o = this.overlay
    const text = o.title ? `${o.title}\n${o.text}` : o.text
    return {
      containers: [
        { type: 'text', name: 'toast', x: 24, y: 24, w: SCREEN.width - 48, h: SCREEN.height - 48,
          text, padding: 12, border: { width: 2, color: 10, radius: 8 }, capture: true },
      ],
    }
  }

  /** Attach the composed contextual menu to a tab's view. */
  withMenu(view, tab) {
    const v = view == null ? { text: '' } : typeof view === 'string' || typeof view === 'number' ? { text: String(view) } : Array.isArray(view) ? { containers: view } : { ...view }
    const custom = Array.isArray(v.menu) && v.menu.length ? v.menu : tab.menu
    v.menu = this.menuFor(tab, custom)
    return v
  }

  menuFor(tab, custom = tab?.menu || []) {
    const items = []
    tab.menuMap = new Map()
    custom.slice(0, 6).forEach((m, i) => {
      const id = MENU.CUSTOM_BASE + i
      const key = typeof m === 'string' ? m : m.id ?? m.label
      tab.menuMap.set(id, key)
      items.push({ id, label: typeof m === 'string' ? m : m.label ?? String(key) })
    })
    items.push({ id: MENU.HOME, label: 'Home' })
    for (const [i, t] of this.registry.list().entries()) {
      if (items.length >= 10) break
      if (t.id === tab.id) continue
      items.push({ id: MENU.TAB_BASE + i, label: t.title })
    }
    return items
  }

  // ── events ─────────────────────────────────────────────────────────
  handleEvent(conn, raw) {
    const ev = normalizeEvent(raw)
    this.lastEvent = { ...ev, raw: undefined, ts: Date.now(), conn: conn.id }
    this.emit('event', this.lastEvent)

    switch (ev.type) {
      case 'enter':
        conn.resetPage()
        this.requestRender()
        return
      case 'exit':
        return
      case 'system-exit':
      case 'abnormal-exit':
        conn.resetPage()
        conn.pageCreated = false
        conn.audioOn = false
        conn.imuOn = false
        return
      case 'imu': {
        const tab = this.activeTab
        if (tab) this.safe(tab, 'onImu', ev.imu)
        return
      }
    }

    if (this.overlay) {
      if (ev.type === 'tap' || ev.type === 'double' || ev.type === 'select') this.dismiss()
      return
    }

    if (ev.type === 'menu') {
      if (ev.itemId === MENU.HOME) return this.home()
      if (ev.itemId === MENU.EXIT) return void this.exit()
      if (ev.itemId >= MENU.TAB_BASE && ev.itemId < MENU.CUSTOM_BASE) {
        const t = this.registry.list()[ev.itemId - MENU.TAB_BASE]
        if (t) this.open(t.id)
        return
      }
      const tab = this.activeTab
      const key = tab?.menuMap?.get(ev.itemId)
      if (tab && key != null) {
        const handled = this.safe(tab, 'onMenu', key)
        if (handled === undefined) this.safe(tab, 'onEvent', { type: 'menu', id: key, source: ev.source })
        this.requestRender()
      }
      return
    }

    if (this.scratch) {
      if (ev.type === 'double') this.home()
      return
    }

    const tab = this.activeTab
    if (!tab) {
      // Home list
      if (ev.type === 'select') {
        const t = this.registry.list()[ev.index]
        if (t) this.open(t.id)
      } else if (ev.type === 'double') {
        void this.exit()
      }
      return
    }

    const handled = this.safe(tab, 'onEvent', ev)
    if (ev.type === 'double' && handled !== true) { this.home(); return }
    // Tabs usually change state in onEvent; re-render cheaply (diffed).
    this.requestRender()
  }

  handleAudio(conn, pcm) {
    const tab = this.activeTab
    if (tab) this.safe(tab, 'onAudio', pcm)
  }
  handleLocation(loc) {
    const tab = this.activeTab
    if (tab) this.safe(tab, 'onLocation', loc)
    this.emit('location', loc)
  }

  /** Deliver an API message to a tab (active or not). */
  message(id, msg) {
    const tab = this.registry.get(id)
    if (!tab) throw new Error(`no such tab: ${id}`)
    const result = this.safe(tab, 'onMessage', msg)
    if (this.isActive(id)) this.requestRender()
    return result
  }
}
