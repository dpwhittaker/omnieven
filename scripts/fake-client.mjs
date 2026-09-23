#!/usr/bin/env node
// Headless stand-in for the phone + glasses. Connects to an Omni server,
// prints what would be drawn, and lets you inject gestures from stdin.
// Usage: node scripts/fake-client.mjs [ws://localhost:7788/ws] [token]
//        node scripts/fake-client.mjs --sandbox [--verbose]
//   --sandbox starts a private server instance for this session — a free port, its
//   own data dir and token (the live data/config.json and data/app-roots are copied
//   in so gestures, homeApp and the app folders match) — and kills it when the client exits, so a test
//   never moves the real glasses. The sandbox's API URL + token are printed on
//   stderr for curl. --verbose relays the whole server log; otherwise only its
//   errors and warnings. (Killed with SIGKILL? `pkill -f omni-sandbox` reaps the server.)
//   keys: t=tap d=double u=up w=down l=longpress r=release e=foreground-enter x=system-exit
//         s<N>=select list item N  m<N>=menu item N  q=quit  (one per line; exits when stdin closes)
//         {…} = raw EvenHubEvent JSON, e.g. {"sysEvent":{"eventType":8,"imuData":{"x":0,"y":1,"z":0}}}
import WebSocket from 'ws'
import { createInterface } from 'node:readline'
import { readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync, createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true }
const sandbox = flag('--sandbox')
const verbose = flag('--verbose')

let url = args[0] || 'ws://localhost:7788/ws'
let token = args[1] || (existsSync('data/token') ? readFileSync('data/token', 'utf8').trim() : '')

// ── --sandbox: a private server that lives exactly as long as this client ──
let child = null, sandboxDir = null, quitting = false
async function quit(code = 0) {
  if (quitting) return
  quitting = true
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')  // the server saves app state on SIGTERM, then exits
    await new Promise((r) => { const t = setTimeout(r, 3000); child.once('exit', () => { clearTimeout(t); r() }) })
  }
  if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => quit(130))
process.on('SIGTERM', () => quit(143))

if (sandbox) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const port = await new Promise((ok, fail) => {
    const s = createServer(); s.on('error', fail)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
  })
  sandboxDir = mkdtempSync(join(tmpdir(), 'omni-sandbox-'))
  const liveData = process.env.OMNI_DATA_DIR || join(root, 'data')
  for (const f of ['config.json', 'app-roots']) if (existsSync(join(liveData, f))) copyFileSync(join(liveData, f), join(sandboxDir, f))
  token = randomBytes(8).toString('hex')
  url = `ws://127.0.0.1:${port}/ws`
  const logStream = createWriteStream(join(sandboxDir, 'server.log'))
  const recent = []
  let buf = ''
  const relay = (chunk) => {
    logStream.write(chunk); buf += chunk
    const lines = buf.split('\n'); buf = lines.pop()
    for (const l of lines) {
      recent.push(l); if (recent.length > 30) recent.shift()
      if (verbose || /\[(error|warn)\]/.test(l)) console.error(`server│ ${l}`)
    }
  }
  // The marker argument is ignored by the server; it makes the process findable.
  child = spawn(process.execPath, [join(root, 'server', 'index.ts'), `--omni-sandbox=${sandboxDir}`], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', OMNI_DATA_DIR: sandboxDir, OMNI_TOKEN: token, PUBLIC_URL: `http://127.0.0.1:${port}` },
  })
  child.stdout.on('data', relay); child.stderr.on('data', relay)
  child.on('exit', (code, sig) => { if (!quitting) { console.error(`sandbox server exited (${sig || code}):\n${recent.join('\n')}`); quit(1) } })
  const deadline = Date.now() + 20000
  for (let ready = false; !ready;) {
    if (child.exitCode !== null) await new Promise(() => {})  // the exit handler is quitting
    try { ready = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok } catch {}
    if (!ready) {
      if (Date.now() > deadline) { console.error(`sandbox server did not come up:\n${recent.join('\n')}`); await quit(1) }
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  console.error(`sandbox server http://127.0.0.1:${port}  token ${token}  data ${sandboxDir}`)
  console.error(`  curl -s -H "Authorization: Bearer ${token}" http://127.0.0.1:${port}/api/screen`)
}

const ws = new WebSocket(`${url}?token=${encodeURIComponent(token)}`)
let page = null, created = false

function draw() {
  if (!page) return
  const lines = ['┌' + '─'.repeat(70) + '┐']
  const all = [...page.textObject.map((t) => ({ ...t, kind: 'text' })), ...page.listObject.map((l) => ({ ...l, kind: 'list' })), ...page.imageObject.map((i) => ({ ...i, kind: 'image' }))].sort((a, b) => a.containerID - b.containerID)
  for (const c of all) {
    const tag = `#${c.containerID} ${c.kind} "${c.containerName}" @${c.xPosition},${c.yPosition} ${c.width}x${c.height}${c.isEventCapture ? ' [capture]' : ''}`
    lines.push('│ ' + tag)
    if (c.kind === 'text') for (const l of c.content.split('\n')) lines.push('│   ' + l)
    if (c.kind === 'list') c.itemContainer.itemName.forEach((n, i) => lines.push(`│   ${i === 0 ? '>' : ' '} ${n}`))
    if (c.kind === 'image') lines.push('│   (image)')
  }
  if (page.menuObject) lines.push('│ menu: ' + page.menuObject.menuItems.map((m) => `[${m.itemID}] ${m.itemName}`).join('  '))
  lines.push('└' + '─'.repeat(70) + '┘')
  console.log(lines.join('\n'))
}

ws.on('open', () => {
  console.log('connected')
  ws.send(JSON.stringify({ t: 'hello', token, client: { version: 'fake', sdk: '0.0.15' }, tz: process.env.FAKE_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone, locale: 'en-US', device: { model: 'fake-g2', status: { batteryLevel: 88 } }, user: { name: 'fake' }, launchSource: 'appMenu', pageCreated: false }))
})
ws.on('message', (data, isBinary) => {
  if (isBinary) return
  const f = JSON.parse(data.toString())
  if (f.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' }))
  if (f.t !== 'cmd') return console.log('<', f)
  const { id, op, args } = f
  if (op === 'page') { console.log(`\n[${created ? 'rebuild' : 'create'} page]`); page = args; created = true; draw(); return reply(id, true, 0) }
  if (op === 'text') {
    const t = page?.textObject.find((x) => x.containerID === args.containerID)
    if (t) { t.content = args.content; console.log(`[text #${args.containerID}] ${args.content.replace(/\n/g, ' ⏎ ').slice(0, 120)}`) }
    return reply(id, !!t, true)
  }
  if (op === 'image') { console.log(`[image #${args.containerID}] ${Math.round(args.png.length * 0.75)} bytes`); return reply(id, true, 'success') }
  if (op === 'shutdown') { console.log(`[shutdown mode=${args.mode}]`); return reply(id, true, true) }
  console.log(`[${op}]`, JSON.stringify(args).slice(0, 100)); reply(id, true, true)
})
ws.on('close', () => { console.log('closed'); quit(0) })
ws.on('error', (e) => { console.error('error', e.message); quit(1) })
// FAKE_LATENCY=<ms> delays every result, like a slow BLE link.
const latency = Number(process.env.FAKE_LATENCY) || 0
const reply = (id, ok, value) => setTimeout(() => ws.send(JSON.stringify({ t: 'result', id, ok, value })), latency)
// Lines typed before the socket is open are queued and flushed on connect.
const queued = []
const send = (ev) => { const f = JSON.stringify({ t: 'event', ev }); if (ws.readyState === 1) ws.send(f); else queued.push(f) }
ws.on('open', () => { for (const f of queued) ws.send(f); queued.length = 0 })

const rl = createInterface({ input: process.stdin })
rl.on('close', () => quit(0))
rl.on('line', (line) => {
  const k = line.trim()
  if (k === 'q') return quit(0)
  if (k.startsWith('{')) { try { send(JSON.parse(k)) } catch (e) { console.error('bad json', e.message) } return }
  if (k === 't') send({ sysEvent: {} })
  if (k === 'd') send({ sysEvent: { eventType: 3 } })
  if (k === 'u') send({ textEvent: { eventType: 1 } })
  if (k === 'w') send({ textEvent: { eventType: 2 } })
  if (k === 'l') send({ sysEvent: { eventType: 9 } })
  if (k === 'r') send({ sysEvent: { eventType: 10 } })
  if (k === 'e') send({ sysEvent: { eventType: 4 } })
  if (k === 'x') send({ sysEvent: { eventType: 7 } })
  if (k.startsWith('s')) { const i = Number(k.slice(1)) || 0; const l = page?.listObject[0]; send({ listEvent: { containerID: l?.containerID, containerName: l?.containerName, currentSelectItemIndex: i || undefined, currentSelectItemName: l?.itemContainer.itemName[i] } }) }
  if (k.startsWith('m')) send({ menuItemClickEvent: { itemID: Number(k.slice(1)) } })
})
