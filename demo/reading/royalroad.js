// RoyalRoad — read your library on the glasses, position shared with the web
// reader (royalroad service: https://github.com/lettucegoblin/royalroad).
//   library → tap a fiction → resumes where you left off (web or glasses)
//   'Scrolling' setting:
//     by step — text box; tap: next page · swipe down / up: move by the 'Scroll step' (page … 1 line)
//     smooth  — the firmware's own list scrolling (like menus): 20 lines at a time scroll natively;
//               tap a line to continue reading from it (the next 20 lines), menu: back a screen
//   double-tap: back to the library
//   menu: Next chapter · Previous chapter · Chapters… · Library
//   settings: lines per page, reading-area width, horizontal/vertical placement of
//   the reading area (e.g. a narrow column on the right, or one line at the bottom),
//   header on/off, brightness
// Needs ROYALROAD_URL and ROYALROAD_TOKEN in Omni's .env.

/** @typedef {{ id: number, title: string, author: string, chapters: number, downloaded: number, position: { chapter_id: number, paragraph: number, ord: number, title: string } | null }} Fiction */
/** @typedef {{ id: number, fictionId: number, ord: number, total: number, title: string, paragraphs: string[], prev: number | null, next: number | null }} Chapter */
/** @typedef {{ text: string, para: number }} Line */
/** @typedef {{ lines: number, brightness: number, width: number, halign: 'left'|'center'|'right', valign: 'top'|'center'|'bottom', header: boolean, step: 'page'|'half'|'3'|'2'|'1', scrolling: 'step'|'smooth' }} State */
/** @typedef {{ screen: 'library'|'reader'|'chapters', fictions: Fiction[], fiction: Fiction | null, chapter: Chapter | null,
 *   lines: Line[], top: number, loading: string, error: string, cache: Record<number, Chapter>, chapterList: { id: number, ord: number, title: string }[],
 *   chapterWindow: number, saveTimer: any }} Mem */

const W = 576, H = 288, HEADER = 34, PAD = 4, LINE = 27
/** list items are capped by the firmware (bytes) and per list (rows) */
const ITEM_BYTES = 63, LIST_ROWS = 20

/**
 * Where the reading area sits on the screen, from the settings: width and
 * alignment place a `lines`-tall box; the header (if shown) stays on top.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx
 */
function layout(ctx) {
  const s = ctx.state
  const top = s.header ? HEADER : 0
  const lines = Math.min(s.lines, Math.floor((H - top - 2 * PAD) / LINE))
  const w = Math.min(W, s.width), h = lines * LINE + 2 * PAD
  const x = s.halign === 'left' ? 0 : s.halign === 'right' ? W - w : Math.round((W - w) / 2)
  const y = s.valign === 'top' ? top : s.valign === 'bottom' ? H - h : top + Math.round((H - top - h) / 2)
  return { x, y, w, h, lines, top, textWidth: w - 2 * PAD - 8 }
}

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
 * Wrap the chapter into screen lines, each tagged with the paragraph it belongs
 * to (so the position can be saved by paragraph). A blank line separates
 * paragraphs; it carries the index of the paragraph that follows it.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {string[]} paragraphs
 */
function flow(ctx, paragraphs) {
  const { textWidth } = layout(ctx)
  const smooth = ctx.state.scrolling === 'smooth'
  /** @type {Line[]} */ const lines = []
  paragraphs.forEach((p, para) => {
    if (lines.length) lines.push({ text: '', para })
    for (const text of smooth ? wrapItems(ctx, p, textWidth) : ctx.ui.wrap(p, textWidth)) lines.push({ text, para })
  })
  return lines.length ? lines : [{ text: '(empty chapter)', para: 0 }]
}

/**
 * Word-wrap for list rows: each line must fit the width *and* stay within the
 * firmware's 63-byte item limit (curly quotes are 3 bytes each).
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {string} text @param {number} widthPx
 */
function wrapItems(ctx, text, widthPx) {
  const bytes = (/** @type {string} */ t) => Buffer.byteLength(t, 'utf8')
  const fits = (/** @type {string} */ t) => bytes(t) <= ITEM_BYTES && ctx.ui.wrap(t, widthPx).length === 1
  /** @type {string[]} */ const out = []
  let line = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const cand = line ? `${line} ${w}` : w
    if (fits(cand)) { line = cand; continue }
    if (line) out.push(line)
    line = w
    while (!fits(line)) {   // a single over-long word: hard-break it
      let cut = line.length - 1
      while (cut > 1 && !fits(line.slice(0, cut))) cut--
      out.push(line.slice(0, cut)); line = line.slice(cut)
    }
  }
  if (line) out.push(line)
  return out
}

/** Lines the reading box shows at once. @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
const pageLines = (ctx) => layout(ctx).lines
/** Highest valid top line (the last page is filled from the end). @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
const maxTop = (ctx) => Math.max(0, ctx.mem.lines.length - pageLines(ctx))
/** How many lines a swipe moves, from the 'step' setting. @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function stepLines(ctx) {
  const n = pageLines(ctx), st = ctx.state.step
  return st === 'page' ? n : st === 'half' ? Math.max(1, Math.floor(n / 2)) : Math.min(n, Number(st) || 1)
}
/**
 * Top line for a paragraph: the first line of it, else the last line before it.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {number} para
 */
function topForParagraph(ctx, para) {
  const m = ctx.mem
  if (para >= Number.MAX_SAFE_INTEGER) return maxTop(ctx)
  let i = m.lines.findIndex((l) => l.para === para && l.text !== '')
  if (i < 0) i = m.lines.findLastIndex((l) => l.para <= para)
  return Math.min(Math.max(0, i), maxTop(ctx))
}
/**
 * Move the window by `delta` lines (clamped). Whole-page moves skip a blank
 * separator that would otherwise waste the first line.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {number} delta
 */
function scroll(ctx, delta) {
  const m = ctx.mem
  let top = Math.min(maxTop(ctx), Math.max(0, m.top + delta))
  if (Math.abs(delta) >= pageLines(ctx) && top < maxTop(ctx) && m.lines[top]?.text === '') top++
  if (top === m.top) return false
  m.top = top
  return true
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
    m.lines = flow(ctx, ch.paragraphs)
    m.top = topForParagraph(ctx, paragraph)
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
  const chapterId = m.chapter.id, paragraph = m.lines[m.top]?.para ?? 0
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

/** @type {{ key: keyof State, label: string, options: { value: any, label: string }[] }[]} */
const SETTINGS = [
  { key: 'lines', label: 'Lines per page', options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: v, label: `${v}` })) },
  { key: 'width', label: 'Reading width', options: [[576, 'full'], [480, 'wide'], [384, 'two thirds'], [288, 'half'], [192, 'third']].map(([v, l]) => ({ value: v, label: `${l} (${v}px)` })) },
  { key: 'halign', label: 'Horizontal position', options: ['left', 'center', 'right'].map((v) => ({ value: v, label: v })) },
  { key: 'valign', label: 'Vertical position', options: ['top', 'center', 'bottom'].map((v) => ({ value: v, label: v })) },
  { key: 'scrolling', label: 'Scrolling', options: [{ value: 'step', label: 'by step (swipe moves the text)' }, { value: 'smooth', label: 'smooth (native list scrolling)' }] },
  { key: 'step', label: 'Scroll step (swipes)', options: [['page', 'a page'], ['half', 'half a page'], ['3', '3 lines'], ['2', '2 lines'], ['1', '1 line']].map(([v, l]) => ({ value: v, label: l })) },
  { key: 'header', label: 'Header line', options: [{ value: true, label: 'show' }, { value: false, label: 'hide' }] },
  { key: 'brightness', label: 'Text brightness', options: [1, 2, 3, 4].map((v) => ({ value: v, label: ['', 'dim', 'medium', 'bright', 'brightest'][v] })) },
]

/** Re-flow the open chapter after a layout change, staying on the same paragraph.
 * @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function reflow(ctx) {
  const m = ctx.mem
  if (!m.chapter) return
  const para = m.lines[m.top]?.para ?? 0
  m.lines = flow(ctx, m.chapter.paragraphs)
  m.top = topForParagraph(ctx, para)
}

/** @type {import('../../shared/app.ts').OmniApp<State, Mem>} */
export default {
  title: 'RoyalRoad',
  order: 1,
  settings: SETTINGS,

  init(ctx) {
    ctx.state.lines ??= 8
    ctx.state.brightness ??= 4
    ctx.state.width ??= W
    ctx.state.halign ??= 'left'
    ctx.state.valign ??= 'top'
    ctx.state.header ??= true
    ctx.state.step ??= 'page'
    ctx.state.scrolling ??= 'step'
    delete (/** @type {any} */ (ctx.state)).dimOld
    ctx.mem.screen = 'library'
    ctx.mem.fictions ??= []
    ctx.mem.cache ??= {}
    ctx.mem.lines ??= []
    ctx.mem.top ??= 0
    ctx.mem.chapterList ??= []
    ctx.mem.loading = ''; ctx.mem.error = ''
    ctx.mem.chapterWindow = 0
  },
  onOpen(ctx) { if (ctx.mem.screen === 'library') void loadLibrary(ctx) },
  onSettingsChange(ctx, key) {
    // anything that changes the box re-flows the chapter, keeping the current paragraph
    if (['lines', 'width', 'header', 'scrolling'].includes(key)) reflow(ctx)
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
      const smooth = s.scrolling === 'smooth'
      const box = layout(ctx)
      const end = Math.min(m.lines.length, m.top + (smooth ? LIST_ROWS : box.lines))
      const last = smooth ? end >= m.lines.length : m.top >= maxTop(ctx)
      const pct = `${Math.round((end / m.lines.length) * 100)}%`
      const hint = last ? (m.chapter.next ? (smooth ? `${pct} · tap last line: next chapter` : 'tap: next chapter') : 'the end (so far)') : smooth ? `${pct} · tap a line to continue` : pct
      /** @type {import('../../shared/view.ts').Container} */
      let body
      if (smooth) {
        // a native list: the firmware scrolls these rows itself; blank rows keep paragraph gaps
        const items = m.lines.slice(m.top, m.top + LIST_ROWS).map((l) => l.text || ' ')
        body = { type: 'list', name: 'body', x: box.x, y: box.y, w: box.w, h: box.h, padding: PAD, capture: true, selectBorder: false, items }
      } else body = { type: 'text', name: 'body', x: box.x, y: box.y, w: box.w, h: box.h, padding: PAD, capture: true, textColor: s.brightness, text: m.lines.slice(m.top, end).map((l) => l.text).join('\n') }
      return {
        containers: [
          ...(s.header ? [header(`${ctx.ui.fit(m.chapter.title, 330)}  ·  ch ${m.chapter.ord + 1}/${m.chapter.total}  ·  ${hint}`)] : []),
          body,
        ],
        menu: [...(smooth ? [{ id: 'backscreen', label: 'Back a screen' }] : []), { id: 'next', label: 'Next chapter' }, { id: 'prev', label: 'Previous chapter' }, { id: 'chapters', label: 'Chapters…' }, { id: 'library', label: 'Library' }],
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
    if (ctx.state.scrolling === 'smooth') {
      // the firmware scrolls the rows; a tap on a row continues from it (that row becomes the first)
      if (ev.type === 'select' || ev.type === 'tap') {
        const i = ev.type === 'select' ? ev.index : 0
        const shown = Math.min(LIST_ROWS, m.lines.length - m.top)
        const last = m.top + shown >= m.lines.length
        if (last && (i >= shown - 1 || shown <= 1)) { if (m.chapter.next) void openChapter(ctx, m.chapter.next, 0).then(() => savePosition(ctx)); return true }
        // row 0 (or a plain tap) = a screenful; otherwise the tapped row
        const delta = i > 0 ? i : Math.max(1, layout(ctx).lines - 1)
        m.top = Math.min(m.top + delta, Math.max(0, m.lines.length - 1))
        if (m.lines[m.top]?.text === '' && m.top < m.lines.length - 1) m.top++   // don't start on a paragraph gap
        savePosition(ctx); ctx.render(); return true
      }
      return true   // swipes are handled by the firmware
    }
    if (ev.type === 'tap' || ev.type === 'down') {
      // tap = a page, swipe = the configured step; past the end → next chapter
      if (scroll(ctx, ev.type === 'tap' ? pageLines(ctx) : stepLines(ctx))) { savePosition(ctx); ctx.render() }
      else if (m.chapter.next) void openChapter(ctx, m.chapter.next, 0).then(() => savePosition(ctx))
      return true
    }
    if (ev.type === 'up') {
      if (scroll(ctx, -stepLines(ctx))) { savePosition(ctx); ctx.render() }
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
    if (id === 'backscreen') { m.top = Math.max(0, m.top - Math.max(1, layout(ctx).lines - 1)); savePosition(ctx); return ctx.render() }
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
    // the same keys as the settings schema, e.g. {"lines":1,"valign":"bottom"}
    let changed = false
    for (const st of SETTINGS) if (msg[st.key] !== undefined && st.options.some((o) => o.value === msg[st.key])) { /** @type {any} */ (ctx.state)[st.key] = msg[st.key]; changed = true }
    if (changed) { ctx.save(); reflow(ctx); ctx.render() }
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
