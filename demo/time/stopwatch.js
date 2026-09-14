// Stopwatch — tap start/stop, long-press or menu to reset. Uses a fast
// refresh; `state` (persisted) holds elapsed time, `mem` the running start.

/** @typedef {{ elapsed: number, laps: number[] }} State */
/** @typedef {{ startedAt: number | null }} Mem */

/** @param {number} ms */
function fmt(ms) {
  const t = Math.max(0, Math.floor(ms))
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), c = Math.floor((t % 1000) / 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${c}`
}
/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
const elapsed = (ctx) => ctx.state.elapsed + (ctx.mem.startedAt ? Date.now() - ctx.mem.startedAt : 0)

/** @type {import('../../shared/app.ts').OmniApp<State, Mem>} */
export default {
  title: 'Stopwatch',
  order: 2,
  refresh: 200,
  menu: [{ id: 'reset', label: 'Reset' }, { id: 'lap', label: 'Lap' }],

  init(ctx) {
    ctx.state.elapsed ??= 0
    ctx.state.laps ??= []
    ctx.mem.startedAt ??= null
  },

  render(ctx) {
    const running = !!ctx.mem.startedAt
    const total = ctx.state.laps.length
    const laps = ctx.state.laps.slice(-5).map((l, i) => `lap ${total - Math.min(5, total) + i + 1}  ${fmt(l)}`).join('\n')
    return {
      containers: [
        { type: 'text', name: 'big', x: 0, y: 20, w: 300, h: 80, padding: 8, text: fmt(elapsed(ctx)), capture: true,
          border: { width: running ? 2 : 0, color: 12, radius: 8 } },
        { type: 'text', name: 'laps', x: 310, y: 20, w: 266, h: 200, padding: 8, textColor: 2, text: laps || 'no laps' },
        { type: 'text', name: 'hint', x: 0, y: 240, w: 576, h: 48, padding: 8, textColor: 1,
          text: running ? 'tap: stop  ·  menu: lap / reset' : 'tap: start  ·  hold: reset  ·  double-tap: home' },
      ],
    }
  },

  onEvent(ctx, ev) {
    if (ev.type === 'tap') {
      if (ctx.mem.startedAt) { ctx.state.elapsed += Date.now() - ctx.mem.startedAt; ctx.mem.startedAt = null }
      else ctx.mem.startedAt = Date.now()
      ctx.render()
    } else if (ev.type === 'longpress') {
      ctx.state.elapsed = 0; ctx.state.laps = []; ctx.mem.startedAt = null; ctx.render()
      return true // consumed: no in-app default binding for longpress fires
    }
  },

  onMenu(ctx, id) {
    if (id === 'reset') { ctx.state.elapsed = 0; ctx.state.laps = []; ctx.mem.startedAt = null }
    if (id === 'lap') ctx.state.laps.push(elapsed(ctx))
    ctx.render()
  },
}
