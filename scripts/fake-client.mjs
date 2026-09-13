#!/usr/bin/env node
// Headless stand-in for the phone + glasses. Connects to an Omni server,
// prints what would be drawn, and lets you inject gestures from stdin.
// Usage: node scripts/fake-client.mjs [ws://localhost:7788/ws] [token]
//   keys: t=tap d=double u=up w=down l=longpress r=release e=foreground-enter x=system-exit
//         s<N>=select list item N  m<N>=menu item N  q=quit  (one per line; exits when stdin closes)
//         {…} = raw EvenHubEvent JSON, e.g. {"sysEvent":{"eventType":8,"imuData":{"x":0,"y":1,"z":0}}}
import WebSocket from 'ws'
import { createInterface } from 'node:readline'
import { readFileSync, existsSync } from 'node:fs'

const url = process.argv[2] || 'ws://localhost:7788/ws'
const token = process.argv[3] || (existsSync('data/token') ? readFileSync('data/token', 'utf8').trim() : '')
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
  ws.send(JSON.stringify({ t: 'hello', token, client: { version: 'fake', sdk: '0.0.15' }, device: { model: 'fake-g2', status: { batteryLevel: 88 } }, user: { name: 'fake' }, launchSource: 'appMenu', pageCreated: false }))
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
ws.on('close', () => { console.log('closed'); process.exit(0) })
ws.on('error', (e) => { console.error('error', e.message); process.exit(1) })
const reply = (id, ok, value) => ws.send(JSON.stringify({ t: 'result', id, ok, value }))
// Lines typed before the socket is open are queued and flushed on connect.
const queued = []
const send = (ev) => { const f = JSON.stringify({ t: 'event', ev }); if (ws.readyState === 1) ws.send(f); else queued.push(f) }
ws.on('open', () => { for (const f of queued) ws.send(f); queued.length = 0 })

const rl = createInterface({ input: process.stdin })
rl.on('close', () => process.exit(0))
rl.on('line', (line) => {
  const k = line.trim()
  if (k === 'q') process.exit(0)
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
