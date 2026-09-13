// Notes — an inbox fed from outside. Two ways in:
//   POST /api/apps/notes/message  {"text": "buy milk"}        (onMessage)
//   POST /api/apps/notes/add?text=buy+milk                     (http hook, webhook-friendly)
//   GET  /api/apps/notes/list                                  (the app's own JSON API)
// Notes live in ctx.state so they survive restarts.

/** @typedef {{ text: string, at: number }} Note */
/** @typedef {{ notes: Note[] }} State */
/** @typedef {{ open: number | null }} Mem */

/**
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx
 * @param {string} text
 * @param {{ notify?: boolean, ms?: number }} [opts]
 */
function add(ctx, text, opts = {}) {
  ctx.state.notes.unshift({ text, at: Date.now() })
  if (ctx.state.notes.length > 20) ctx.state.notes.length = 20
  if (opts.notify !== false) ctx.notify(text, { title: 'Note', ms: opts.ms ?? 5000 })
  ctx.render()
  return { count: ctx.state.notes.length }
}

/** @type {import('../../shared/app.ts').OmniApp<State, Mem>} */
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
    if (!notes.length) return 'Notes\n\nNothing here yet.\n\nPOST /api/apps/notes/message {"text": "..."}'
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

  onMessage(ctx, msg) {
    if (msg.clear) { ctx.state.notes = []; ctx.mem.open = null; ctx.render() }
    if (msg.text) return add(ctx, String(msg.text), msg)
    return { count: ctx.state.notes.length }
  },

  http(ctx, req) {
    if (req.method === 'GET' && req.path === '/list') return { notes: ctx.state.notes }
    if (req.method === 'POST' && req.path === '/add') {
      const body = /** @type {{ text?: string } | string | null} */ (req.body)
      const text = req.query.text || (typeof body === 'string' ? body : body?.text)
      if (!text) return { status: 400, json: { error: 'text required (query ?text= or JSON body)' } }
      return add(ctx, String(text))
    }
    return undefined // 404
  },
}
