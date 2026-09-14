// The phone-side "Apps" tab: lists the server's apps, opens them on the
// glasses, and shows an app's phone page (its `phone` hook) in a panel.

export interface AppInfo { id: string; title: string; group: string; active: boolean; phone: boolean; settings: boolean; error: string | null }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

/** Sends an API call (path relative to /api) and resolves with the raw reply. */
export type ApiTransport = (method: string, path: string, body?: string) => Promise<{ status: number; body: string }>

export class Companion {
  private origin = ''
  /** when set, API calls go through this instead of fetch() (the socket tunnel) */
  private transport: ApiTransport | null = null
  private token = ''
  private apps: AppInfo[] = []
  private timer: number | null = null

  constructor() {
    $('tab-apps').onclick = () => this.showTab('apps')
    $('tab-connect').onclick = () => this.showTab('connect')
    $('tab-setup').onclick = () => this.showTab('setup')
    $('panel-close').onclick = () => this.closePanel()
    $('panel-reload').onclick = () => { const f = $<HTMLIFrameElement>('panel-frame'); f.src = f.src }
  }

  /** origin = http(s) origin derived from the ws URL */
  configure(wsUrl: string, token: string, transport: ApiTransport | null = null) {
    try { const u = new URL(wsUrl); this.origin = `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}` } catch { this.origin = '' }
    this.token = token
    this.transport = transport
  }

  showTab(which: 'apps' | 'connect' | 'setup') {
    for (const t of ['apps', 'connect', 'setup'] as const) {
      $(`tab-${t}`).classList.toggle('on', which === t)
      $(`sec-${t}`).classList.toggle('on', which === t)
    }
  }

  start() { this.stop(); void this.refresh(); this.timer = window.setInterval(() => void this.refresh(), 5000) }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  private async api(path: string, opts: RequestInit = {}) {
    if (this.transport) {
      const r = await this.transport(opts.method || 'GET', path, typeof opts.body === 'string' ? opts.body : undefined)
      if (r.status < 200 || r.status >= 300) throw new Error(`${r.status}`)
      return r.body ? JSON.parse(r.body) : null
    }
    const r = await fetch(`${this.origin}/api${path}`, { ...opts, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(opts.headers || {}) } })
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }

  async refresh() {
    if (!this.origin || !this.token) return
    try {
      const { apps } = await this.api('/apps') as { apps: AppInfo[] }
      const changed = JSON.stringify(apps.map((a) => [a.id, a.title, a.group, a.active, a.phone, a.error])) !== JSON.stringify(this.apps.map((a) => [a.id, a.title, a.group, a.active, a.phone, a.error]))
      this.apps = apps
      if (changed) this.renderList()
    } catch (err) {
      $('applist').innerHTML = `<div class="status bad">Could not load apps (${(err as Error).message})</div>`
    }
  }

  private renderList() {
    const list = $('applist')
    list.innerHTML = ''
    const groups = new Map<string, AppInfo[]>()
    for (const a of this.apps) { const g = a.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(a) }
    const home = document.createElement('div'); home.className = 'row'
    home.innerHTML = `<button class="secondary" id="go-home">Home on glasses</button><button class="secondary" id="go-settings">Glasses settings</button>`
    list.appendChild(home)
    ;(home.querySelector('#go-home') as HTMLButtonElement).onclick = () => void this.api('/home', { method: 'POST' })
    ;(home.querySelector('#go-settings') as HTMLButtonElement).onclick = () => void this.api('/settings', { method: 'POST' })
    for (const [g, apps] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      if (g) { const h = document.createElement('div'); h.className = 'group'; h.textContent = g.replace(/\//g, ' › '); list.appendChild(h) }
      for (const a of apps) {
        const el = document.createElement('div')
        el.className = 'appitem' + (a.active ? ' active' : '')
        el.innerHTML = `<div class="t">${esc(a.title)}${a.error ? `<small style="color:#f0a0a0">${esc(a.error)}</small>` : a.active ? '<small>on the glasses now</small>' : ''}</div>`
        if (a.phone) { const b = document.createElement('button'); b.textContent = 'Phone page'; b.onclick = () => this.openPanel(a); el.appendChild(b) }
        if (a.settings) { const b = document.createElement('button'); b.textContent = 'Settings'; b.onclick = () => void this.api(`/apps/${a.id}/settings`, { method: 'POST' }); el.appendChild(b) }
        const go = document.createElement('button'); go.className = 'go'; go.textContent = 'Open'; go.onclick = () => void this.api(`/apps/${a.id}/open`, { method: 'POST' }).then(() => this.refresh())
        el.appendChild(go)
        list.appendChild(el)
      }
    }
  }

  openPanel(a: AppInfo) {
    $('panel-title').textContent = a.title
    $<HTMLIFrameElement>('panel-frame').src = `${this.origin}/api/apps/${a.id}/phone?token=${encodeURIComponent(this.token)}`
    $('applist').style.display = 'none'
    $('panel').classList.add('on')
  }
  closePanel() {
    $<HTMLIFrameElement>('panel-frame').src = 'about:blank'
    $('panel').classList.remove('on')
    $('applist').style.display = ''
  }
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]) }
