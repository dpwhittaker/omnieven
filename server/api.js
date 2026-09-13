// HTTP API. Everything the glasses show can be driven from here, which is
// what lets an agent (or a cron job, or a shell script) push to the display.
import { compile } from './renderer.js'
import { recentLogs, onLog } from './log.js'
import { VERSION } from './config.js'

const started = Date.now()

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => { body += c; if (body.length > 5e6) { reject(new Error('body too large')); req.destroy() } })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(new Error('invalid JSON')) } })
    req.on('error', reject)
  })
}
export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

/**
 * @returns {Promise<boolean>} true when the request was an API route
 */
export async function handleApi(req, res, url, shell) {
  if (!url.pathname.startsWith('/api/')) return false
  const path = url.pathname.slice(4)
  const m = req.method
  try {
    if (m === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' })
      res.end(); return true
    }

    if (m === 'GET' && path === '/status') {
      sendJson(res, 200, {
        version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000),
        connections: [...shell.connections].map((c) => c.summary()),
        active: shell.activeId, scratch: !!shell.scratch, overlay: shell.overlay ? { text: shell.overlay.text } : null,
        tabs: shell.tabSummaries(), lastEvent: shell.lastEvent,
      }); return true
    }
    if (m === 'GET' && path === '/tabs') { sendJson(res, 200, { tabs: shell.tabSummaries() }); return true }
    if (m === 'GET' && path === '/screen') {
      const view = shell.currentView()
      const c = compile(view)
      sendJson(res, 200, { active: shell.activeId, text: c.textDump, page: { ...c.page }, images: c.images.map((i) => ({ containerID: i.containerID, containerName: i.containerName, bytes: Math.round(i.png.length * 0.75) })) })
      return true
    }
    if (m === 'GET' && path === '/logs') { sendJson(res, 200, { logs: recentLogs(Number(url.searchParams.get('n')) || 100) }); return true }

    if (m === 'GET' && path === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'Access-Control-Allow-Origin': '*' })
      res.write(':ok\n\n')
      const write = (type, data) => { try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`) } catch {} }
      const offs = [
        onLog((e) => write('log', e)),
        sub(shell, 'event', (e) => write('event', e)),
        sub(shell, 'render', (t) => write('render', { text: t })),
        sub(shell, 'nav', (e) => write('nav', e)),
        sub(shell, 'connection', (e) => write('connection', e)),
        sub(shell, 'tabs', (e) => write('tabs', e)),
        sub(shell, 'location', (e) => write('location', e)),
      ]
      const hb = setInterval(() => { try { res.write(':hb\n\n') } catch {} }, 15000)
      req.on('close', () => { clearInterval(hb); offs.forEach((f) => f()) })
      return true
    }

    if (m === 'POST' && path === '/notify') {
      const b = await readJson(req)
      if (!b.text) { sendJson(res, 400, { error: 'text required' }); return true }
      shell.notify(b.text, b); sendJson(res, 200, { ok: true }); return true
    }
    if (m === 'POST' && path === '/dismiss') { shell.dismiss(); sendJson(res, 200, { ok: true }); return true }
    if (m === 'POST' && path === '/show') {
      const b = await readJson(req)
      const view = b.view ?? b
      compile(view) // validate before committing
      shell.show(view); sendJson(res, 200, { ok: true }); return true
    }
    if (m === 'POST' && path === '/home') { shell.home(); sendJson(res, 200, { ok: true }); return true }
    if (m === 'POST' && path === '/exit') { await shell.exit(); sendJson(res, 200, { ok: true }); return true }
    if (m === 'POST' && path === '/render') { shell.requestRender(); sendJson(res, 200, { ok: true }); return true }
    if (m === 'POST' && path === '/reload') {
      await shell.registry.loadAll(); shell.requestRender()
      sendJson(res, 200, { ok: true, tabs: shell.tabSummaries() }); return true
    }
    if (m === 'POST' && path === '/client/reload') { await shell.broadcast('reload', {}); sendJson(res, 200, { ok: true }); return true }
    if (m === 'POST' && path === '/audio') { const b = await readJson(req); const r = await shell.registry.host.audio(!!b.on, b.source); sendJson(res, 200, { results: r }); return true }
    if (m === 'POST' && path === '/imu') { const b = await readJson(req); const r = await shell.registry.host.imu(!!b.on, b.pace); sendJson(res, 200, { results: r }); return true }
    if (m === 'POST' && path === '/location') { const b = await readJson(req); const r = await shell.registry.host.location(b); sendJson(res, 200, { location: r }); return true }
    if (m === 'POST' && path === '/cmd') {
      // Raw escape hatch: run any client op on every connection.
      const b = await readJson(req)
      if (!b.op) { sendJson(res, 400, { error: 'op required' }); return true }
      const results = await shell.broadcast(b.op, b.args ?? {})
      sendJson(res, 200, { results }); return true
    }

    const tab = path.match(/^\/tabs\/([\w.-]+)(?:\/(\w+))?$/)
    if (tab) {
      const [, id, action] = tab
      const t = shell.registry.get(id)
      if (!t) { sendJson(res, 404, { error: `no such tab: ${id}` }); return true }
      if (m === 'GET' && !action) { sendJson(res, 200, { id, title: t.title, error: t.error, active: shell.isActive(id), state: t.state, file: t.file }); return true }
      if (m === 'POST' && action === 'open') { shell.open(id); sendJson(res, 200, { ok: true }); return true }
      if (m === 'POST' && action === 'message') {
        const b = await readJson(req)
        const result = await shell.message(id, b)
        sendJson(res, 200, { ok: true, result: result ?? null }); return true
      }
      if (m === 'GET' && action === 'state') { sendJson(res, 200, { state: t.state }); return true }
      if ((m === 'PUT' || m === 'PATCH') && action === 'state') {
        const b = await readJson(req)
        Object.assign(t.state, b); t.ctx?.save()
        if (shell.isActive(id)) shell.requestRender()
        sendJson(res, 200, { ok: true, state: t.state }); return true
      }
      if (m === 'POST' && action === 'reload') { await shell.registry.loadFile(t.file); sendJson(res, 200, { ok: true }); return true }
    }

    sendJson(res, 404, { error: 'not found' })
    return true
  } catch (err) {
    sendJson(res, 500, { error: err.message })
    return true
  }
}

function sub(emitter, name, fn) { emitter.on(name, fn); return () => emitter.off(name, fn) }
