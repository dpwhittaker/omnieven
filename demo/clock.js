// Clock — render() returns a view, `refresh` re-renders it every second.
// Only the changed text is sent to the glasses (no flicker).

/** @type {import('../shared/app.ts').OmniApp<{ hour12?: boolean }>} */
export default {
  title: 'Clock',
  order: 1,
  refresh: 1000,
  menu: [{ id: 'toggle', label: 'Toggle 12/24h' }],

  render(ctx) {
    const hour12 = !!ctx.state.hour12
    const now = new Date()
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12 })
    const date = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const batt = ctx.device?.status?.batteryLevel
    return {
      containers: ctx.ui.rows([
        `\n${time}`,
        date,
        ctx.ui.spread('tap: 12/24h  ·  double-tap: home', batt != null ? `glasses ${batt}%` : ''),
      ], { capture: 0 }),
    }
  },

  onEvent(ctx, ev) {
    if (ev.type === 'tap') { ctx.state.hour12 = !ctx.state.hour12; ctx.render() }
  },
  onMenu(ctx, id) {
    if (id === 'toggle') { ctx.state.hour12 = !ctx.state.hour12; ctx.render() }
  },
}
