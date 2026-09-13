// One connected glasses client (phone WebView). Owns the command queue and
// the last view committed to that specific display, so several clients (the
// glasses plus the simulator, say) can be driven from a single shell.
import { EventEmitter } from 'node:events'
import { compile, diff } from './renderer.js'
import { log } from './log.js'

const RESULT_TIMEOUT_MS = 12000
let nextConnId = 1

export class Connection extends EventEmitter {
  constructor(ws, remote) {
    super()
    this.id = nextConnId++
    this.ws = ws
    this.remote = remote
    this.connectedAt = Date.now()
    this.device = null
    this.user = null
    this.launchSource = null
    this.client = null
    this.alive = true
    this.committed = null      // last compiled view known to be on the glasses
    this.pending = new Map()   // cmd id → {resolve, reject, timer}
    this.nextCmdId = 1
    this.queue = Promise.resolve()
    this.wantView = null       // latest requested view while a render is in flight
    this.rendering = false
    this.pageCreated = false
    this.audioOn = false
    this.imuOn = false
  }

  /** Called when the client's page state is unknown; forces a full rebuild. */
  resetPage() { this.committed = null }

  send(frame) {
    if (this.ws.readyState !== 1) return false
    this.ws.send(JSON.stringify(frame))
    return true
  }

  /** Send a command and await the client's result. */
  cmd(op, args) {
    return new Promise((resolve, reject) => {
      const id = this.nextCmdId++
      if (!this.send({ t: 'cmd', id, op, args })) { reject(new Error('socket closed')); return }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${op} timed out`))
      }, RESULT_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer, op })
    })
  }

  handleResult(frame) {
    const p = this.pending.get(frame.id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(frame.id)
    if (frame.ok) p.resolve(frame.value)
    else p.reject(new Error(frame.error || `${p.op} failed`))
  }

  /**
   * Render a view. Coalesces: if called while a render is in flight only the
   * newest view is applied afterwards.
   */
  render(view) {
    this.wantView = view
    if (this.rendering) return this.queue
    this.rendering = true
    this.queue = this.queue.then(() => this.drain()).catch((err) => {
      log('error', `conn ${this.id} render: ${err.message}`)
    }).finally(() => { this.rendering = false })
    return this.queue
  }

  async drain() {
    while (this.wantView !== null && this.alive) {
      const view = this.wantView
      this.wantView = null
      const next = compile(view, { forUpgrade: !!this.committed })
      const ops = diff(this.committed, next)
      if (!ops.length) continue
      let ok = true
      for (const { op, args } of ops) {
        try {
          await this.cmd(op, args)
          if (op === 'page') this.pageCreated = true
        } catch (err) {
          ok = false
          log('warn', `conn ${this.id} ${op} failed: ${err.message}`)
          if (op === 'page') { this.committed = null; break }
          // A failed text/image upgrade means the display no longer matches
          // what we believe; force a rebuild on the next pass.
          this.committed = null
          this.wantView = this.wantView ?? view
          break
        }
      }
      if (ok) this.committed = next
      this.emit('rendered', { view: next, ops: ops.map((o) => o.op) })
    }
  }

  close() {
    this.alive = false
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('connection closed')) }
    this.pending.clear()
    try { this.ws.close() } catch {}
  }

  summary() {
    return {
      id: this.id, remote: this.remote, connectedAt: this.connectedAt,
      client: this.client, device: this.device, user: this.user,
      launchSource: this.launchSource, pageCreated: this.pageCreated,
      audioOn: this.audioOn, imuOn: this.imuOn,
    }
  }
}
