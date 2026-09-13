// Omni server entry: static glasses client, HTTP API, WebSocket bridge.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { WebSocketServer } from 'ws'
import qrcodeTerminal from 'qrcode-terminal'
import { CLIENT_DIST, HOST, PORT, PUBLIC_URL, TABS_DIR, TOKEN, VERSION, wsUrl } from './config.js'
import { Connection } from './connection.js'
import { Shell } from './shell.js'
import { handleApi, sendJson } from './api.js'
import { manifest, setupPage } from './setup.js'
import { log } from './log.js'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json' }

const shell = new Shell({ tabsDir: TABS_DIR })

function tokenOf(req, url) {
  const h = req.headers.authorization
  if (h?.startsWith('Bearer ')) return h.slice(7).trim()
  return url.searchParams.get('token') || ''
}

function serveStatic(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) return false
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
  createReadStream(file).pipe(res)
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  try {
    // The glasses client: public, secret-free. Its token comes from the user.
    if (p === '/app.json' || p === '/app/app.json') { sendJson(res, 200, manifest()); return }
    if (p === '/app' ) { res.writeHead(302, { Location: '/app/' + url.search }); res.end(); return }
    if (p.startsWith('/app/')) {
      if (!existsSync(CLIENT_DIST)) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('client not built: run `npm run build:client`'); return }
      const rel = normalize(p.slice(5)).replace(/^(\.\.[/\\])+/, '')
      const file = join(CLIENT_DIST, rel || 'index.html')
      if (serveStatic(res, file)) return
      if (serveStatic(res, join(CLIENT_DIST, 'index.html'))) return
    }
    if (p === '/healthz') { res.writeHead(200); res.end('ok'); return }

    // Everything else needs the token.
    if (tokenOf(req, url) !== TOKEN) {
      if (p === '/' || p === '/setup') { res.writeHead(401, { 'Content-Type': 'text/plain' }); res.end('Omni: add ?token=<token> (printed at server start)'); return }
      sendJson(res, 401, { error: 'unauthorized' }); return
    }
    if (p === '/' || p === '/setup') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await setupPage(shell)); return
    }
    if (await handleApi(req, res, url, shell)) return
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found')
  } catch (err) {
    log('error', `http ${p}: ${err.stack || err.message}`)
    if (!res.headersSent) sendJson(res, 500, { error: err.message })
  }
})

// ── WebSocket ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname !== '/ws') { socket.destroy(); return }
  if (tokenOf(req, url) !== TOKEN) {
    log('warn', `ws unauthorized from ${req.socket.remoteAddress}`)
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
})

wss.on('connection', (ws, req) => {
  const remote = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
  const conn = new Connection(ws, remote)
  log('ws', `client ${conn.id} connected from ${remote}`)
  conn.send({ t: 'welcome', serverVersion: VERSION })
  let registered = false
  const hb = setInterval(() => conn.send({ t: 'ping' }), 20000)

  ws.on('message', (data, isBinary) => {
    if (isBinary) { shell.handleAudio(conn, data); return }
    let frame
    try { frame = JSON.parse(data.toString()) } catch { return }
    switch (frame.t) {
      case 'hello':
        conn.client = frame.client; conn.device = frame.device; conn.user = frame.user
        conn.launchSource = frame.launchSource; conn.pageCreated = !!frame.pageCreated
        conn.resetPage()
        log('ws', `client ${conn.id} hello: ${frame.client?.version} device=${frame.device?.model ?? '?'} pageCreated=${frame.pageCreated}`)
        if (!registered) { registered = true; shell.addConnection(conn) } else shell.requestRender()
        break
      case 'result': conn.handleResult(frame); break
      case 'event': shell.handleEvent(conn, frame.ev); break
      case 'device': conn.device = { ...(conn.device || {}), status: frame.status }; shell.emit('device', frame.status); break
      case 'location': shell.handleLocation(frame.loc); break
      case 'launch': conn.launchSource = frame.source; break
      case 'log': log(`client:${conn.id}`, `${frame.level}: ${frame.msg}`); break
      case 'pong': break
      default: log('warn', `client ${conn.id} unknown frame ${frame.t}`)
    }
  })
  ws.on('close', () => {
    clearInterval(hb)
    conn.close()
    if (registered) shell.removeConnection(conn)
    log('ws', `client ${conn.id} disconnected`)
  })
  ws.on('error', (err) => log('warn', `ws ${conn.id}: ${err.message}`))
})

// ── boot ─────────────────────────────────────────────────────────────
await shell.start()
server.listen(PORT, HOST, () => {
  const setup = `${PUBLIC_URL}/setup?token=${TOKEN}`
  console.log(`\nOmni v${VERSION} listening on http://${HOST}:${PORT}`)
  console.log(`  public URL : ${PUBLIC_URL}`)
  console.log(`  websocket  : ${wsUrl()}`)
  console.log(`  setup page : ${setup}`)
  console.log(`  token      : ${TOKEN}`)
  console.log(`  tabs dir   : ${TABS_DIR}  (${shell.registry.list().map((t) => t.id).join(', ') || 'empty'})`)
  if (!existsSync(CLIENT_DIST)) console.log('  WARNING    : client not built — run `npm run build:client`')
  console.log('\nScan with the Even app (Even Hub → Developer → Scan QR):')
  qrcodeTerminal.generate(`${PUBLIC_URL}/app/?token=${encodeURIComponent(TOKEN)}`, { small: true })
})

function shutdown() { shell.registry.saveAll(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', (err) => log('error', `uncaught: ${err.stack || err.message}`))
process.on('unhandledRejection', (err) => log('error', `unhandled: ${err?.stack || err}`))
