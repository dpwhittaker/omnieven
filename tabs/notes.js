// Notes — content pushed from outside through the API:
//   POST /api/tabs/notes/message  {"text": "buy milk"}
//   POST /api/tabs/notes/message  {"clear": true}
// Useful as an inbox for anything an agent or script wants you to see later.
// Notes are kept in ctx.state so they survive restarts.
export default {
  title: 'Notes',
  order: 5,
  menu: [{ id: 'clear', label: 'Clear all' }],

  init(ctx) {
    ctx.state.notes ??= []
    ctx.mem.open = null
  },

  render(ctx) {
    const notes = ctx.state.notes
    const open = ctx.mem.open != null ? notes[ctx.mem.open] : null
    if (open) {
      return {
        containers: ctx.ui.headerBody(new Date(open.at).toLocaleString(), `${open.text}\n\ndouble-tap: back`),
        menu: [{ id: 'delete', label: 'Delete note' }, { id: 'clear', label: 'Clear all' }],
      }
    }
    if (!notes.length) return 'Notes\n\nNothing here yet.\n\nPOST /api/tabs/notes/message {"text": "..."}'
    return {
      containers: [
        { type: 'text', name: 'header', x: 0, y: 0, w: 576, h: 34, padding: 4, textColor: 2, text: `Notes  ·  ${notes.length}` },
        { type: 'list', name: 'notes', x: 0, y: 34, w: 576, h: 254, capture: true,
          items: notes.map((n) => ctx.ui.fit(n.text.split('\n')[0], 540)) },
      ],
    }
  },

  onEvent(ctx, ev) {
    if (ev.type === 'select') { ctx.mem.open = ev.index; ctx.render(); return }
    if (ev.type === 'double' && ctx.mem.open != null) { ctx.mem.open = null; ctx.render(); return true }
  },

  onMenu(ctx, id) {
    if (id === 'clear') { ctx.state.notes = []; ctx.mem.open = null }
    if (id === 'delete' && ctx.mem.open != null) { ctx.state.notes.splice(ctx.mem.open, 1); ctx.mem.open = null }
    ctx.render()
  },

  // Called for POST /api/tabs/notes/message
  onMessage(ctx, msg) {
    if (msg.clear) { ctx.state.notes = []; ctx.mem.open = null }
    if (msg.text) {
      ctx.state.notes.unshift({ text: String(msg.text), at: Date.now() })
      if (ctx.state.notes.length > 20) ctx.state.notes.length = 20
      if (msg.notify !== false) ctx.notify(String(msg.text), { title: 'Note', ms: msg.ms ?? 5000 })
    }
    ctx.render()
    return { count: ctx.state.notes.length }
  },
}
