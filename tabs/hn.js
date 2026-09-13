// Hacker News top stories — a list-first tab with a detail view. Shows
// server-side fetching, native lists, and a tab-internal back stack
// (double-tap goes back to the list before it goes home).
const API = 'https://hacker-news.firebaseio.com/v0'
const REFRESH_MS = 5 * 60 * 1000

export default {
  title: 'Hacker News',
  order: 4,
  menu: [{ id: 'refresh', label: 'Refresh' }],

  init(ctx) {
    ctx.mem.stories ??= []
    ctx.mem.selected = null
    ctx.mem.loading = false
    this.load(ctx)
    ctx.setInterval(() => this.load(ctx), REFRESH_MS)
  },

  async load(ctx) {
    if (ctx.mem.loading) return
    ctx.mem.loading = true
    ctx.render()
    try {
      const ids = (await (await ctx.fetch(`${API}/topstories.json`)).json()).slice(0, 20)
      ctx.mem.stories = await Promise.all(ids.map(async (id) => (await ctx.fetch(`${API}/item/${id}.json`)).json()))
      ctx.mem.fetchedAt = Date.now()
    } catch (err) {
      ctx.log(`fetch failed: ${err.message}`)
      ctx.mem.error = err.message
    } finally {
      ctx.mem.loading = false
      ctx.render()
    }
  },

  render(ctx) {
    const s = ctx.mem.selected != null ? ctx.mem.stories[ctx.mem.selected] : null
    if (s) {
      const host = s.url ? new URL(s.url).hostname.replace(/^www\./, '') : 'news.ycombinator.com'
      return {
        containers: ctx.ui.headerBody(
          `${s.score} pts  ·  ${s.descendants ?? 0} comments  ·  ${host}`,
          `${s.title}\n\nby ${s.by}\n${s.url || ''}\n\ndouble-tap: back to list`,
        ),
        menu: [{ id: 'back', label: 'Back to list' }, { id: 'refresh', label: 'Refresh' }],
      }
    }
    if (!ctx.mem.stories.length) return ctx.mem.loading ? 'Loading Hacker News…' : `Hacker News\n\n${ctx.mem.error || 'nothing loaded'}\n\nmenu → Refresh`
    const age = ctx.mem.fetchedAt ? `${Math.round((Date.now() - ctx.mem.fetchedAt) / 60000)} min ago` : ''
    return {
      containers: [
        { type: 'text', name: 'header', x: 0, y: 0, w: 576, h: 34, padding: 4, textColor: 2,
          text: ctx.ui.spread('Hacker News  ·  tap to open', ctx.mem.loading ? 'refreshing…' : age) },
        { type: 'list', name: 'stories', x: 0, y: 34, w: 576, h: 254, capture: true,
          items: ctx.mem.stories.map((st) => ctx.ui.fit(`${st.score} ${st.title}`, 540)) },
      ],
    }
  },

  onEvent(ctx, ev) {
    if (ev.type === 'select') { ctx.mem.selected = ev.index; ctx.render(); return }
    if (ev.type === 'double' && ctx.mem.selected != null) { ctx.mem.selected = null; ctx.render(); return true }
  },
  onMenu(ctx, id) {
    if (id === 'back') { ctx.mem.selected = null; ctx.render() }
    if (id === 'refresh') this.load(ctx)
  },
}
