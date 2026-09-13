// Stopwatch — tap start/stop, long-press or menu to reset. Shows how to use
// a fast refresh while running and a slow one when idle.
function fmt(ms) {
  const t = Math.max(0, Math.floor(ms))
  const m = Math.floor(t / 60000), s = Math.floor((t % 60000) / 1000), c = Math.floor((t % 1000) / 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${c}`
}

export default {
  title: 'Stopwatch',
  order: 2,
  refresh: 200,
  menu: [{ id: 'reset', label: 'Reset' }, { id: 'lap', label: 'Lap' }],

  init(ctx) {
    ctx.state.elapsed ??= 0
    ctx.state.laps ??= []
    ctx.mem.startedAt = null
  },

  elapsed(ctx) { return ctx.state.elapsed + (ctx.mem.startedAt ? Date.now() - ctx.mem.startedAt : 0) },

  render(ctx) {
    const running = !!ctx.mem.startedAt
    const laps = ctx.state.laps.slice(-5).map((l, i) => `lap ${ctx.state.laps.length - Math.min(5, ctx.state.laps.length) + i + 1}  ${fmt(l)}`).join('\n')
    return {
      containers: [
        { type: 'text', name: 'big', x: 0, y: 20, w: 300, h: 80, padding: 8, text: `⏱  ${fmt(this.elapsed(ctx))}`, capture: true,
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
      this.onMenu(ctx, 'reset')
    }
  },

  onMenu(ctx, id) {
    if (id === 'reset') { ctx.state.elapsed = 0; ctx.state.laps = []; ctx.mem.startedAt = null }
    if (id === 'lap') ctx.state.laps.push(this.elapsed(ctx))
    ctx.render()
  },
}
