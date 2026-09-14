// RoyalRoad — read your library on the glasses, position shared with the web
// reader (royalroad service: https://github.com/lettucegoblin/royalroad).
//   library → tap a fiction → resumes where you left off (web or glasses)
//   tap / swipe down: next page · swipe up: previous page · double-tap: back
//   menu: Next chapter · Previous chapter · Chapters… · Library
// Needs ROYALROAD_URL and ROYALROAD_TOKEN in Omni's .env.

/** @typedef {{ id: number, title: string, author: string, chapters: number, downloaded: number, position: { chapter_id: number, paragraph: number, ord: number, title: string } | null }} Fiction */
/** @typedef {{ id: number, fictionId: number, ord: number, total: number, title: string, paragraphs: string[], prev: number | null, next: number | null }} Chapter */
/** @typedef {{ text: string, para: number }} Page */
/** @typedef {{ lines: number, brightness: number }} State */
/** @typedef {{ screen: 'library'|'reader'|'chapters', fictions: Fiction[], fiction: Fiction | null, chapter: Chapter | null,
 *   pages: Page[], page: number, loading: string, error: string, cache: Record<number, Chapter>, chapterList: { id: number, ord: number, title: string }[],
 *   chapterWindow: number, saveTimer: any }} Mem */

const W = 576, HEADER = 34, PAD = 4

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function cfg(ctx) {
  const url = (ctx.env.ROYALROAD_URL || '').replace(/\/+$/, '')
  const token = ctx.env.ROYALROAD_TOKEN || ''
  return { url, token }
}
/**
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {string} path @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
async function api(ctx, path, init = {}) {
  const { url, token } = cfg(ctx)
  if (!url) throw new Error('ROYALROAD_URL not set in .env')
  const r = await ctx.fetch(`${url}/api${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}

/**
 * Paginate paragraphs into screen pages, remembering which paragraph each
 * page starts on so the position can be saved by paragraph.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {string[]} paragraphs
 */
function paginate(ctx, paragraphs) {
  const maxLines = ctx.state.lines
  /** @type {Page[]} */ const pages = []
  /** @type {string[]} */ let lines = []
  let para = 0, startPara = 0
  const flush = () => { if (lines.length) { pages.push({ text: lines.join('\n'), para: startPara }); lines = [] } }
  for (para = 0; para < paragraphs.length; para++) {
    const wrapped = ctx.ui.wrap(paragraphs[para], W - 2 * PAD - 8)
    let i = 0
    while (i < wrapped.length) {
      if (lines.length >= maxLines) { flush(); startPara = para }
      if (!lines.length) startPara = para
      const room = maxLines - lines.length
      lines.push(...wrapped.slice(i, i + room))
      i += room
    }
    if (lines.length && lines.length < maxLines) lines.push('')   // paragraph gap
  }
  flush()
  return pages.length ? pages : [{ text: '(empty chapter)', para: 0 }]
}

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {number} chapterId */
async function loadChapter(ctx, chapterId) {
  const m = ctx.mem
  if (m.cache[chapterId]) return m.cache[chapterId]
  /** @type {Chapter} */ const ch = await api(ctx, `/chapters/${chapterId}`)
  m.cache[chapterId] = ch
  const keys = Object.keys(m.cache)
  if (keys.length > 6) delete m.cache[Number(keys[0])]
  return ch
}

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {number} chapterId @param {number} paragraph */
async function openChapter(ctx, chapterId, paragraph = 0) {
  const m = ctx.mem
  m.loading = 'chapter'; m.error = ''; ctx.render()
  try {
    const ch = await loadChapter(ctx, chapterId)
    m.chapter = ch
    m.pages = paginate(ctx, ch.paragraphs)
    m.page = Math.max(0, m.pages.findIndex((p, i) => p.para <= paragraph && (m.pages[i + 1]?.para ?? Infinity) > paragraph))
    m.screen = 'reader'
    if (ch.next) void loadChapter(ctx, ch.next).catch(() => {})   // prefetch
  } catch (err) { m.error = err instanceof Error ? err.message : String(err) }
  m.loading = ''
  ctx.render()
}

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function savePosition(ctx) {
  const m = ctx.mem
  if (!m.fiction || !m.chapter) return
  const chapterId = m.chapter.id, paragraph = m.pages[m.page]?.para ?? 0
  clearTimeout(m.saveTimer)
  m.saveTimer = setTimeout(() => {
    api(ctx, `/fictions/${m.fiction?.id}/position`, { method: 'PUT', body: JSON.stringify({ chapterId, paragraph, device: 'glasses' }) }).catch((e) => ctx.log(`save position: ${e.message}`))
  }, 1500)
}

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
async function loadLibrary(ctx) {
  const m = ctx.mem
  m.loading = 'library'; m.error = ''; ctx.render()
  try { m.fictions = (await api(ctx, '/library')).fictions } catch (err) { m.error = err instanceof Error ? err.message : String(err) }
  m.loading = ''
  ctx.render()
}

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {Fiction} f */
async function openFiction(ctx, f) {
  const m = ctx.mem
  m.fiction = f
  if (f.position) return openChapter(ctx, f.position.chapter_id, f.position.paragraph)
  m.loading = 'chapter'; ctx.render()
  try {
    const info = await api(ctx, `/fictions/${f.id}`)
    m.chapterList = info.chapters.map((/** @type {any} */ c) => ({ id: c.id, ord: c.ord, title: c.title }))
    if (!info.chapters.length) throw new Error('no chapters yet')
    await openChapter(ctx, info.chapters[0].id, 0)
  } catch (err) { m.error = err instanceof Error ? err.message : String(err); m.loading = ''; ctx.render() }
}

/** @type {import('../../shared/app.ts').OmniApp<State, Mem>} */
export default {
  title: 'RoyalRoad',
  order: 1,
  settings: [
    { key: 'lines', label: 'Lines per page', options: [6, 7, 8, 9].map((v) => ({ value: v, label: `${v}` })) },
    { key: 'brightness', label: 'Text brightness', options: [1, 2, 3, 4].map((v) => ({ value: v, label: ['', 'dim', 'medium', 'bright', 'brightest'][v] })) },
  ],

  init(ctx) {
    ctx.state.lines ??= 8
    ctx.state.brightness ??= 4
    ctx.mem.screen = 'library'
    ctx.mem.fictions ??= []
    ctx.mem.cache ??= {}
    ctx.mem.pages ??= []
    ctx.mem.chapterList ??= []
    ctx.mem.loading = ''; ctx.mem.error = ''
    ctx.mem.chapterWindow = 0
  },
  onOpen(ctx) { if (ctx.mem.screen === 'library') void loadLibrary(ctx) },
  onSettingsChange(ctx, key) {
    if (key === 'lines' && ctx.mem.chapter) { const para = ctx.mem.pages[ctx.mem.page]?.para ?? 0; ctx.mem.pages = paginate(ctx, ctx.mem.chapter.paragraphs); ctx.mem.page = Math.max(0, ctx.mem.pages.findIndex((p, i) => p.para <= para && (ctx.mem.pages[i + 1]?.para ?? Infinity) > para)) }
  },

  render(ctx) {
    const m = ctx.mem, s = ctx.state
    const header = (/** @type {string} */ t) => ({ type: /** @type {const} */ ('text'), name: 'header', x: 0, y: 0, w: W, h: HEADER, padding: PAD, textColor: 2, text: t })
    if (m.error) return { text: `RoyalRoad\n\n${m.error}\n\ntap: retry  ·  double-tap: back` }
    if (m.loading) return { text: m.loading === 'library' ? 'Loading library…' : `${m.fiction?.title ?? ''}\n\nloading chapter…` }
    if (m.screen === 'chapters' && m.fiction) {
      const cur = m.chapter?.ord ?? 0
      const start = Math.max(0, Math.min(cur - 9 + m.chapterWindow, m.chapterList.length - 20))
      const slice = m.chapterList.slice(start, start + 20)
      return {
        containers: [header(`${ctx.ui.fit(m.fiction.title, 380)}  ·  chapters ${start + 1}–${start + slice.length} of ${m.chapterList.length}`),
          { type: 'list', name: 'chapters', x: 0, y: HEADER, w: W, h: 288 - HEADER, capture: true, items: slice.map((c) => `${c.ord === cur ? '› ' : ''}${c.ord + 1}. ${c.title}`) }],
        menu: [{ id: 'earlier', label: 'Earlier chapters' }, { id: 'later', label: 'Later chapters' }, { id: 'back', label: 'Back to reading' }],
      }
    }
    if (m.screen === 'reader' && m.chapter && m.fiction) {
      const pg = m.pages[m.page]
      const last = m.page >= m.pages.length - 1
      const hint = last ? (m.chapter.next ? 'tap: next chapter' : 'the end (so far)') : `${m.page + 1}/${m.pages.length}`
      return {
        containers: [
          header(`${ctx.ui.fit(m.chapter.title, 330)}  ·  ch ${m.chapter.ord + 1}/${m.chapter.total}  ·  ${hint}`),
          { type: 'text', name: 'body', x: 0, y: HEADER, w: W, h: 288 - HEADER, padding: PAD, capture: true, textColor: s.brightness, text: pg?.text ?? '' },
        ],
        menu: [{ id: 'next', label: 'Next chapter' }, { id: 'prev', label: 'Previous chapter' }, { id: 'chapters', label: 'Chapters…' }, { id: 'library', label: 'Library' }],
      }
    }
    if (!m.fictions.length) return 'RoyalRoad\n\nYour library is empty.\nAdd favorites on RoyalRoad, then sync on the reader site.\n\ntap: reload'
    return {
      containers: [header('RoyalRoad  ·  tap to read'),
        { type: 'list', name: 'library', x: 0, y: HEADER, w: W, h: 288 - HEADER, capture: true,
          items: m.fictions.map((f) => ctx.ui.fit(`${f.title}${f.position ? `  (ch ${f.position.ord + 1}/${f.chapters})` : f.downloaded < f.chapters ? `  (${f.downloaded}/${f.chapters} dl)` : ''}`, 550)) }],
      menu: [{ id: 'reload', label: 'Reload library' }],
    }
  },

  onEvent(ctx, ev) {
    const m = ctx.mem
    if (m.error) { if (ev.type === 'tap') { m.error = ''; if (m.screen === 'library') void loadLibrary(ctx); else ctx.render() } if (ev.type === 'double') { m.error = ''; m.screen = 'library'; ctx.render(); return true } return }
    if (m.screen === 'library') {
      if (ev.type === 'select') { const f = m.fictions[ev.index]; if (f) void openFiction(ctx, f); return true }
      if (ev.type === 'tap') { void loadLibrary(ctx); return true }
      return
    }
    if (m.screen === 'chapters') {
      if (ev.type === 'double') { m.screen = 'reader'; ctx.render(); return true }
      if (ev.type === 'select') {
        const cur = m.chapter?.ord ?? 0
        const start = Math.max(0, Math.min(cur - 9 + m.chapterWindow, m.chapterList.length - 20))
        const c = m.chapterList[start + ev.index]
        if (c) { void openChapter(ctx, c.id, 0).then(() => savePosition(ctx)) }
        return true
      }
      return true
    }
    // reader
    if (!m.chapter) return
    if (ev.type === 'double') { m.screen = 'library'; void loadLibrary(ctx); return true }
    if (ev.type === 'tap' || ev.type === 'down') {
      if (m.page < m.pages.length - 1) { m.page++; savePosition(ctx); ctx.render() }
      else if (m.chapter.next) void openChapter(ctx, m.chapter.next, 0).then(() => savePosition(ctx))
      return true
    }
    if (ev.type === 'up') {
      if (m.page > 0) { m.page--; savePosition(ctx); ctx.render() }
      else if (m.chapter.prev) void openChapter(ctx, m.chapter.prev, Number.MAX_SAFE_INTEGER).then(() => savePosition(ctx))
      return true
    }
  },

  onMenu(ctx, id) {
    const m = ctx.mem
    if (id === 'reload') return void loadLibrary(ctx)
    if (id === 'library') { m.screen = 'library'; return void loadLibrary(ctx) }
    if (!m.chapter) return
    if (id === 'next' && m.chapter.next) return void openChapter(ctx, m.chapter.next, 0).then(() => savePosition(ctx))
    if (id === 'prev' && m.chapter.prev) return void openChapter(ctx, m.chapter.prev, 0).then(() => savePosition(ctx))
    if (id === 'back') { m.screen = 'reader'; return ctx.render() }
    if (id === 'earlier') { m.chapterWindow -= 20; return ctx.render() }
    if (id === 'later') { m.chapterWindow += 20; return ctx.render() }
    if (id === 'chapters' && m.fiction) {
      m.chapterWindow = 0
      if (!m.chapterList.length || m.chapterList[0] === undefined) {
        void api(ctx, `/fictions/${m.fiction.id}`).then((info) => { m.chapterList = info.chapters.map((/** @type {any} */ c) => ({ id: c.id, ord: c.ord, title: c.title })); m.screen = 'chapters'; ctx.render() })
      } else { m.screen = 'chapters'; ctx.render() }
    }
  },

  // From the phone page / API: {"open": <fictionId>} jumps into a fiction.
  onMessage(ctx, msg) {
    if (msg.open) { const f = ctx.mem.fictions.find((x) => x.id === Number(msg.open)); if (f) { ctx.open(); void openFiction(ctx, f) } }
    return { screen: ctx.mem.screen, fiction: ctx.mem.fiction?.id ?? null, chapter: ctx.mem.chapter?.id ?? null }
  },

  async phone(ctx) {
    const { url } = cfg(ctx)
    let fictions = ctx.mem.fictions
    try { fictions = (await api(ctx, '/library')).fictions; ctx.mem.fictions = fictions } catch (err) { return `<h1>RoyalRoad</h1><p class="muted">Could not reach the reader service: ${err instanceof Error ? err.message : err}</p>` }
    const rows = fictions.map((f) => `<div class="card"><b>${f.title}</b><div class="muted">${f.author} · ${f.chapters} chapters · ${f.downloaded} downloaded${f.position ? ` · at ch ${f.position.ord + 1}` : ''}</div>
      <div class="row"><button data-open="${f.id}">Read on glasses</button><a class="btn secondary" href="${url}/f/${f.id}" target="_blank">Open on phone ↗</a></div></div>`).join('')
    return `<h1>RoyalRoad</h1><p class="muted">Position is shared between the glasses and <a href="${url}" target="_blank">the web reader</a>.</p>${rows || '<p>Library is empty — add favorites on RoyalRoad and sync on the reader site.</p>'}
      <script>for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => omni.api('/message', { method: 'POST', body: { open: Number(b.dataset.open) } }).then(() => { b.textContent = 'On the glasses ✓' })</script>`
  },
}
