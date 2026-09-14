// Transcribe — live captions on the glasses (Deepgram), saved sessions with an
// AI title/summary/action items, prep notes, and mid-conversation cues drawn
// from your prep notes and past sessions (definitions, recall, to-do suggestions
// that go straight to Todoist).
//
//   idle    tap: start · menu: Sessions, Clear prep notes
//   live    captions scroll; a cue appears in the dim box at the bottom
//           tap: stop · swipe up: accept the suggested to-do (adds to Todoist) · swipe down: dismiss cue
//   review  tap: next page · menu: Add all to-dos to Todoist, Add to-do N…, Back
//   phone   prep notes editor, session history with summaries and transcripts
// Needs DEEPGRAM_API_KEY in .env. Summaries/cues use ANTHROPIC_API_KEY if set,
// else the local `claude` CLI. Who-you-are context: data/profile.md.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openStream } from './deepgram.js'
import { ask, parseJson } from './llm.js'
import { Store } from './store.js'

/** @typedef {{ prep: string, cues: boolean, todos: boolean, lines: number }} State */
/** @typedef {{ type: 'definition'|'recall'|'prep'|'answer'|'person'|'todo'|'reminder', text: string, source?: string, todo?: { text: string, due?: string }, shownAt: number }} Cue */
/** @typedef {{ screen: 'idle'|'live'|'review'|'sessions', store: Store | null, stream: ReturnType<typeof openStream> | null, sessionId: number,
 *   finals: { t: number, speaker: number | null, text: string }[], interim: string, startedAt: number, error: string, status: string,
 *   cue: Cue | null, cueBusy: boolean, lastCueAt: number, lastCueWords: number, tick: any, keepTick: any,
 *   review: import('./store.js').Session | null, page: number, sessions: import('./store.js').Session[], summarizing: boolean, cueHistory?: string[] }} Mem */

const W = 576, H = 288, HEADER = 36, PAD = 4, LINE = 27
const CUE_EVERY_MS = 12_000, CUE_MIN_WORDS = 12, CUE_TTL_MS = 18_000, CUE_LINES = 2
const CAPTION_KEEP = 600   // chars of finished text kept on screen (Deepgram gives us the rest)

/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
function store(ctx) { return (ctx.mem.store ??= new Store(ctx.dataDir)) }
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
function profile(ctx) {
  const f = join(ctx.dataDir, '..', '..', 'profile.md')   // data/profile.md
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}
/** @param {Mem} m */
const transcript = (m) => m.finals.map((f) => f.text).join(' ')
const words = (/** @type {string} */ s) => (s.match(/\S+/g) || []).length
const stamp = (/** @type {number} */ ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

// ── live session ─────────────────────────────────────────────────────
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
async function start(ctx) {
  const m = ctx.mem
  if (!ctx.env.DEEPGRAM_API_KEY) { m.error = 'DEEPGRAM_API_KEY not set in .env'; ctx.render(); return }
  m.finals = []; m.interim = ''; m.error = ''; m.cue = null; m.lastCueAt = Date.now(); m.lastCueWords = 0
  m.startedAt = Date.now()
  m.sessionId = store(ctx).create({ started: m.startedAt, prep: ctx.state.prep || '' })
  m.status = 'connecting…'
  m.screen = 'live'; ctx.render()
  m.stream = openStream({
    key: ctx.env.DEEPGRAM_API_KEY,
    log: (t) => ctx.log(t),
    onSegment: (seg) => {
      if (seg.final) { m.finals.push({ t: Date.now() - m.startedAt, speaker: seg.speaker, text: seg.text }); m.interim = '' }
      else m.interim = seg.text
      m.status = ''
      ctx.render()
    },
    onError: (msg) => { m.error = msg; ctx.log(msg); ctx.render() },
  })
  const ok = await ctx.audio(true, 'glasses')
  if (!(Array.isArray(ok) ? ok.some(Boolean) : ok)) { m.error = 'Mic did not start'; await stop(ctx, false); return }
  m.status = 'listening'
  m.tick = ctx.setInterval(() => tick(ctx), 3000)
  ctx.render()
}

/** @param {import("../../../shared/app.ts").AppContext<State, Mem>} ctx @param {boolean} [keep] */
async function stop(ctx, keep = true) {
  const m = ctx.mem
  if (m.tick) { ctx.clear(m.tick); m.tick = null }
  try { await ctx.audio(false) } catch {}
  m.stream?.close(); m.stream = null
  const text = transcript(m)
  const s = store(ctx)
  s.update(m.sessionId, { ended: Date.now(), transcript: text })
  if (!keep || words(text) < 5) {
    s.update(m.sessionId, { title: 'Empty session' }); s.finish(m.sessionId)
    m.screen = 'idle'; ctx.render(); return
  }
  m.summarizing = true; m.screen = 'review'; m.review = s.get(m.sessionId); m.page = 0; ctx.render()
  await summarize(ctx, m.sessionId, text, ctx.state.prep || '')
  s.finish(m.sessionId)
  m.review = s.get(m.sessionId); m.summarizing = false; m.page = 0
  ctx.render()
}

/**
 * Title / summary / action items / terms / people for a finished transcript (smart tier).
 * @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx @param {number} id @param {string} text @param {string} prep
 */
async function summarize(ctx, id, text, prep) {
  const s = store(ctx)
  try {
    const raw = await ask(ctx, {
      model: 'smart', maxTokens: 1200,
      system: `You write concise notes after a conversation. ${profile(ctx) ? `About the user:\n${profile(ctx)}` : ''}\nReply with JSON only.`,
      prompt: `Transcript (speakers numbered when known; the user is usually speaker 0):\n\n${text.slice(0, 24000)}\n\n${prep ? `The user's prep notes for this conversation:\n${prep}\n\n` : ''}Return JSON: {"title": "≤8 words", "summary": "≤120 words, plain prose, what was discussed and decided", "action_items": [{"text": "concrete action, ≤12 words", "due": "optional natural-language date"}], "terms": [{"term": "…", "definition": "≤20 words"}], "people": [{"name": "…", "role": "…"}]}. Only include real action items for the user.`,
    })
    /** @type {any} */ const j = parseJson(raw) || {}
    s.update(id, {
      title: String(j.title || 'Untitled session').slice(0, 80), summary: String(j.summary || ''),
      actions: Array.isArray(j.action_items) ? j.action_items.filter((/** @type {any} */ a) => a && a.text).map((/** @type {any} */ a) => ({ text: String(a.text), due: a.due ? String(a.due) : undefined })) : [],
      terms: Array.isArray(j.terms) ? j.terms.filter((/** @type {any} */ t) => t && t.term).map((/** @type {any} */ t) => ({ term: String(t.term), definition: String(t.definition || '') })) : [],
      people: Array.isArray(j.people) ? j.people.filter((/** @type {any} */ p) => p && p.name).map((/** @type {any} */ p) => ({ name: String(p.name), role: p.role ? String(p.role) : undefined })) : [],
    })
  } catch (err) {
    ctx.log(`summary failed: ${err instanceof Error ? err.message : err}`)
    const started = s.get(id)?.started ?? Date.now()
    s.update(id, { title: `Session ${new Date(started).toLocaleString(ctx.locale, { timeZone: ctx.tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, summary: '(summary failed — transcript saved)' })
  }
}

/**
 * Import a Conversate export (Even app → conversation → Share → TXT):
 *   line 1 "<title> - Transcriptions", line 2 "07:25 PM 09/01/2026", line 3 location,
 *   then "[HH:MM:SS]" + text blocks. No speaker labels.
 * @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx @param {string} text @param {string} [filename]
 */
async function importConversate(ctx, text, filename = '') {
  const lines = text.replace(/\r/g, '').split('\n')
  const titleLine = (lines[0] || '').trim()
  const title = titleLine.replace(/\s*-\s*Transcriptions?\s*$/i, '').trim() || filename.replace(/\.txt$/i, '').replace(/_/g, ' ') || 'Imported conversation'
  const dm = (lines[1] || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s+(\d{2})\/(\d{2})\/(\d{4})/i)
  const location = /^[A-Za-z].*,/.test(lines[2] || '') ? lines[2].trim() : ''
  /** @type {{ t: number, text: string }[]} */ const segs = []
  let cur = -1
  for (const raw of lines.slice(dm ? 3 : 0)) {
    const l = raw.trim()
    const ts = l.match(/^\[(\d{2}):(\d{2}):(\d{2})\]$/)
    if (ts) { cur = (+ts[1] * 3600 + +ts[2] * 60 + +ts[3]) * 1000; continue }
    if (!l || /^Generated by A/i.test(l) || cur < 0) continue
    segs.push({ t: cur, text: l })
  }
  if (!segs.length) throw new Error('no "[HH:MM:SS]" transcript lines found')
  // absolute start: the header date in the phone's time zone; the first timestamp gives the seconds
  let started = Date.now()
  if (dm) {
    const y = +dm[6], mo = +dm[4], d = +dm[5]
    const first = segs[0].t
    // build the local wall-clock instant for that zone
    const guess = Date.UTC(y, mo - 1, d, Math.floor(first / 3600000), Math.floor((first % 3600000) / 60000), Math.floor((first % 60000) / 1000))
    const offset = tzOffsetMs(ctx.tz, guess)
    started = guess - offset
  }
  const base = segs[0].t
  const transcript = segs.map((x) => x.text).join(' ')
  const s = store(ctx)
  const id = s.create({ started, prep: '', source: 'conversate', location })
  s.update(id, { ended: started + (segs[segs.length - 1].t - base), transcript, title })
  await summarize(ctx, id, transcript, '')
  const after = s.get(id)
  if (after && (!after.title || after.title === 'Untitled session')) s.update(id, { title })
  s.finish(id)
  ctx.log(`imported conversate "${title}" (${segs.length} lines)`)
  return s.get(id)
}
/** Offset of an IANA zone at an instant, in ms (positive east of UTC). @param {string} tz @param {number} atUtcMs */
function tzOffsetMs(tz, atUtcMs) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(atUtcMs))
  const g = (/** @type {string} */ t) => Number(p.find((x) => x.type === t)?.value)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - atUtcMs
}

// ── cues ─────────────────────────────────────────────────────────────
/** Words worth searching past sessions for: names and longer terms from recent speech. @param {string} text */
function keyTerms(text) {
  const stop = new Set(['about', 'there', 'their', 'would', 'could', 'should', 'because', 'really', 'думаю', 'something', 'anything', 'everything', 'people', 'things', 'think', 'going', 'right', 'actually', 'basically', 'probably', 'through', 'before', 'after', 'where', 'which', 'while', 'those', 'these', 'other', 'still', 'thing', 'maybe', 'wanted', 'trying', 'talking', 'looking', 'yeah'])
  const seen = new Set()
  /** @type {string[]} */ const out = []
  for (const w of text.match(/[A-Za-z][A-Za-z0-9'-]{3,}/g) || []) {
    const lw = w.toLowerCase().replace(/'s$/, '')
    if (stop.has(lw) || seen.has(lw)) continue
    if (/^[A-Z]/.test(w) || lw.length >= 6) { seen.add(lw); out.push(lw) }
  }
  return out.slice(-10)
}

/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
function tick(ctx) {
  const m = ctx.mem
  if (m.screen !== 'live') return
  const now = Date.now()
  if (m.cue && now - m.cue.shownAt > CUE_TTL_MS) { m.cue = null; ctx.render() }
  if (!ctx.state.cues || m.cueBusy || now - m.lastCueAt < CUE_EVERY_MS) return
  const total = words(transcript(m))
  if (total - m.lastCueWords < CUE_MIN_WORDS) return
  m.cueBusy = true; m.lastCueAt = now; m.lastCueWords = total
  void makeCue(ctx).catch((err) => ctx.log(`cue failed: ${err instanceof Error ? err.message : err}`)).finally(() => { m.cueBusy = false })
}

/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
async function makeCue(ctx) {
  const m = ctx.mem
  const recent = m.finals.filter((f) => Date.now() - m.startedAt - f.t < 75_000).map((f) => `${f.speaker != null ? `[${f.speaker}] ` : ''}${f.text}`).join('\n')
  if (!recent) return
  const s = store(ctx)
  const hits = s.search(keyTerms(recent), m.sessionId)
  const openTodos = s.openActions(8)
  const past = hits.map((h) => `- ${new Date(h.started).toISOString().slice(0, 10)} "${h.title}": ${h.snippet}`).join('\n')
  const system = `You whisper one short cue into someone's smart glasses during a live conversation. ${profile(ctx) ? `About them:\n${profile(ctx)}\n` : ''}
Rules: reply with JSON only. Offer a cue ONLY if it genuinely helps right now; otherwise {"type":"none"}.
Types: "definition" (a term/acronym just came up that they may need explained), "recall" (something relevant from a past conversation — cite its date), "prep" (a point from their prep notes that fits now), "answer" (a factual question was asked that the material answers), "person" (who a mentioned person is, from past sessions), "todo" (a concrete task for the user emerged — phrase it as an action), "reminder" (an open action item of theirs is relevant).
"text" ≤ 110 characters, plain, no preamble. For "todo" also give {"todo":{"text":"…","due":"optional"}}. Don't repeat a cue already given. Prefer "none" over noise.
Never invent facts, numbers, names or sources: "answer", "recall" and "person" may only state what is literally in the prep notes or past-conversation excerpts below (quote the date for recall). If the material doesn't contain it, use "definition" for general knowledge you are sure of, or "none".`
  const prompt = `${ctx.state.prep ? `Prep notes:\n${ctx.state.prep}\n\n` : ''}${past ? `From past conversations:\n${past}\n\n` : ''}${openTodos.length ? `Their open action items:\n${openTodos.map((t) => `- ${t.text}${t.due ? ` (${t.due})` : ''}`).join('\n')}\n\n` : ''}Recent cues already shown: ${m.cueHistory?.slice(-4).join(' | ') || 'none'}\n\nLast ~minute of the conversation (speaker numbers in brackets, 0 is usually the user):\n${recent}\n\nJSON:`
  const raw = await ask(ctx, { model: 'fast', maxTokens: 200, timeoutMs: 15_000, system, prompt })
  const j = parseJson(raw)
  if (!j || !j.type || j.type === 'none' || !j.text || m.screen !== 'live') return
  if (j.type === 'todo' && !ctx.state.todos) return
  m.cue = { type: j.type, text: String(j.text).slice(0, 140), source: j.source ? String(j.source) : undefined, todo: j.todo && j.todo.text ? { text: String(j.todo.text), due: j.todo.due ? String(j.todo.due) : undefined } : (j.type === 'todo' ? { text: String(j.text) } : undefined), shownAt: Date.now() }
  ;(m.cueHistory ??= []).push(m.cue.text)
  ctx.render()
}

/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx @param {{ text: string, due?: string }} todo */
async function addTodo(ctx, todo) {
  try {
    await ctx.message('todoist', { add: todo.text, due: todo.due })
  } catch (err) { ctx.notify(`Todoist: ${err instanceof Error ? err.message : err}`, { ms: 2500 }) }
}

// ── app ──────────────────────────────────────────────────────────────
/** @type {import('../../../shared/app.ts').OmniApp<State, Mem>} */
export default {
  title: 'Transcribe',
  settings: [
    { key: 'cues', label: 'Cues during conversation', options: [{ value: true, label: 'on' }, { value: false, label: 'off' }] },
    { key: 'todos', label: 'Suggest to-dos', options: [{ value: true, label: 'on (swipe up to add)' }, { value: false, label: 'off' }] },
    { key: 'lines', label: 'Caption lines', options: [4, 5, 6].map((v) => ({ value: v, label: `${v}` })) },
  ],
  init(ctx) {
    ctx.state.prep ??= ''; ctx.state.cues ??= true; ctx.state.todos ??= true; ctx.state.lines ??= 6
    const m = ctx.mem
    m.screen = 'idle'; m.finals ??= []; m.interim = ''; m.error = ''; m.status = ''; m.cue = null; m.cueBusy = false
    m.lastCueAt = 0; m.lastCueWords = 0; m.review = null; m.page = 0; m.sessions = []; m.summarizing = false
  },
  onClose(ctx) { if (ctx.mem.screen === 'live') void stop(ctx) },
  unload(ctx) { ctx.mem.stream?.close() },

  render(ctx) {
    const m = ctx.mem, s = ctx.state
    const header = (/** @type {string} */ t) => ({ type: /** @type {const} */ ('text'), name: 'header', x: 0, y: 0, w: W, h: HEADER, padding: PAD, textColor: 2, text: ctx.ui.fit(t, W - 16) })
    if (m.error && m.screen !== 'live') return { text: `Transcribe\n\n${m.error}\n\ntap: back` }

    if (m.screen === 'live') {
      const lines = Math.min(s.lines, Math.floor((H - HEADER - (CUE_LINES * LINE + 2 * PAD) - 2 * PAD) / LINE))
      const text = `${transcript(m).slice(-CAPTION_KEEP)} ${m.interim}`.trim()
      const wrapped = ctx.ui.wrap(text, W - 16)
      const captions = wrapped.slice(-lines).join('\n') || (m.status || '…')
      const elapsed = stamp(Date.now() - m.startedAt)
      const cueText = m.cue ? `${m.cue.type === 'todo' ? 'to-do?  ' : m.cue.type === 'recall' ? '↺ ' : m.cue.type === 'definition' ? '≡ ' : m.cue.type === 'reminder' ? '! ' : ''}${m.cue.text}${m.cue.todo ? '   (swipe up: add to Todoist)' : ''}` : ''
      const capH = lines * LINE + 2 * PAD
      return {
        containers: [
          header(`● ${elapsed}  ·  ${words(transcript(m))} words${m.error ? `  ·  ${m.error}` : m.status ? `  ·  ${m.status}` : ''}  ·  tap: stop`),
          { type: 'text', name: 'captions', x: 0, y: HEADER, w: W, h: capH, padding: PAD, capture: true, text: captions },
          { type: 'text', name: 'cue', x: 0, y: HEADER + capH, w: W, h: CUE_LINES * LINE + 2 * PAD, padding: PAD, textColor: 3, text: ctx.ui.wrap(cueText, W - 16).slice(0, CUE_LINES).join('\n') },
        ],
        menu: [...(m.cue?.todo ? [{ id: 'add-cue', label: 'Add to-do to Todoist' }] : []), { id: 'stop', label: 'Stop & summarize' }, { id: 'discard', label: 'Stop without saving' }],
      }
    }

    if (m.screen === 'review' && m.review) {
      const r = m.review
      if (m.summarizing) return { containers: [header('Summarizing…'), { type: 'text', name: 'body', x: 0, y: HEADER, w: W, h: H - HEADER, padding: PAD, capture: true, text: `${words(r.transcript)} words saved.\n\nWriting the title, summary and action items…` }] }
      const body = `${r.summary}${r.actions.length ? `\n\nAction items:\n${r.actions.map((a, i) => `${i + 1}. ${a.text}${a.due ? ` (${a.due})` : ''}`).join('\n')}` : ''}${r.terms.length ? `\n\nTerms:\n${r.terms.map((t) => `${t.term}: ${t.definition}`).join('\n')}` : ''}`
      const pages = ctx.ui.paginate(body, { widthPx: W - 16, lines: Math.floor((H - HEADER - 2 * PAD) / LINE) })
      const page = Math.min(m.page, pages.length - 1)
      return {
        containers: [header(`${r.title}  ·  ${page + 1}/${pages.length}  ·  tap: next  ·  double-tap: back`),
          { type: 'text', name: 'body', x: 0, y: HEADER, w: W, h: H - HEADER, padding: PAD, capture: true, text: pages[page] }],
        menu: [
          ...(r.actions.length ? [{ id: 'todo-all', label: `Add ${r.actions.length} to-do${r.actions.length > 1 ? 's' : ''} to Todoist` }] : []),
          ...r.actions.slice(0, 5).map((a, i) => ({ id: `todo-${i}`, label: ctx.ui.fit(`+ ${a.text}`, 190) })),
          { id: 'sessions', label: 'Sessions' }, { id: 'back', label: 'Back' },
        ],
      }
    }

    if (m.screen === 'sessions') {
      const items = m.sessions.map((x) => ctx.ui.fit(`${new Date(x.started).toLocaleDateString(ctx.locale, { month: 'short', day: 'numeric', timeZone: ctx.tz })}  ${x.title || 'Untitled'}`, 540))
      return { containers: [header(`Sessions  ·  ${m.sessions.length}  ·  tap: open  ·  double-tap: back`),
        items.length ? { type: 'list', name: 'sessions', x: 0, y: HEADER, w: W, h: H - HEADER, capture: true, items: items.slice(0, 20) }
          : { type: 'text', name: 'body', x: 0, y: HEADER, w: W, h: H - HEADER, padding: PAD, capture: true, text: 'No sessions yet.' }] }
    }

    // idle
    const prep = s.prep ? ctx.ui.wrap(s.prep, W - 16).slice(0, 5).join('\n') : 'No prep notes — write some on the phone (people, agenda, things to ask).'
    return {
      containers: [header(`Transcribe  ·  tap: start  ·  cues ${s.cues ? 'on' : 'off'}`),
        { type: 'text', name: 'body', x: 0, y: HEADER, w: W, h: H - HEADER, padding: PAD, capture: true, text: `Prep notes:\n${prep}` }],
      menu: [{ id: 'start', label: 'Start' }, { id: 'sessions', label: 'Sessions' }, ...(s.prep ? [{ id: 'clear-prep', label: 'Clear prep notes' }] : [])],
    }
  },

  onEvent(ctx, ev) {
    const m = ctx.mem
    if (m.error && m.screen !== 'live') { if (ev.type === 'tap' || ev.type === 'double') { m.error = ''; m.screen = 'idle'; ctx.render(); return true } return }
    switch (m.screen) {
      case 'idle':
        if (ev.type === 'tap') { void start(ctx); return true }
        return
      case 'live':
        if (ev.type === 'tap') { void stop(ctx); return true }
        if (ev.type === 'up') { if (m.cue?.todo) { const t = m.cue.todo; m.cue = null; void addTodo(ctx, t); ctx.render() } return true }
        if (ev.type === 'down') { m.cue = null; ctx.render(); return true }
        if (ev.type === 'double') { void stop(ctx); return true }   // stop, then the shell's double goes home next time
        return
      case 'review':
        if (ev.type === 'tap') { m.page++; ctx.render(); return true }
        if (ev.type === 'up') { m.page = Math.max(0, m.page - 1); ctx.render(); return true }
        if (ev.type === 'double') { m.screen = 'idle'; ctx.render(); return true }
        return
      case 'sessions':
        if (ev.type === 'select') { const x = m.sessions[ev.index]; if (x) { m.review = x; m.page = 0; m.screen = 'review'; ctx.render() } return true }
        if (ev.type === 'double') { m.screen = 'idle'; ctx.render(); return true }
        return
    }
  },

  onMenu(ctx, id) {
    const m = ctx.mem
    if (id === 'start') return void start(ctx)
    if (id === 'stop') return void stop(ctx)
    if (id === 'discard') return void stop(ctx, false)
    if (id === 'add-cue' && m.cue?.todo) { const t = m.cue.todo; m.cue = null; ctx.render(); return void addTodo(ctx, t) }
    if (id === 'sessions') { m.sessions = store(ctx).list(20); m.screen = 'sessions'; return ctx.render() }
    if (id === 'back') { m.screen = 'idle'; return ctx.render() }
    if (id === 'clear-prep') { ctx.state.prep = ''; ctx.save(); return ctx.render() }
    if (id === 'todo-all' && m.review) { for (const a of m.review.actions) void addTodo(ctx, a); return }
    if (id.startsWith('todo-') && m.review) { const a = m.review.actions[Number(id.slice(5))]; if (a) void addTodo(ctx, a) }
  },

  onAudio(ctx, pcm) { ctx.mem.stream?.send(pcm) },

  onMessage(ctx, msg) {
    if (typeof msg.prep === 'string') { ctx.state.prep = msg.prep.slice(0, 4000); ctx.save(); ctx.render() }
    if (msg.start && ctx.mem.screen === 'idle') { ctx.open(); void start(ctx) }
    if (msg.stop && ctx.mem.screen === 'live') void stop(ctx)
    return { screen: ctx.mem.screen, words: words(transcript(ctx.mem)), prep: ctx.state.prep }
  },

  http(ctx, req) {
    const s = store(ctx)
    if (req.path === '/sessions') return { sessions: s.list(50).map((x) => ({ id: x.id, started: x.started, title: x.title, summary: x.summary, actions: x.actions })) }
    if (req.path.startsWith('/session/')) { const x = s.get(Number(req.path.slice(9))); return x ? { session: x } : { status: 404, json: { error: 'no such session' } } }
    if (req.path === '/prep' && req.method === 'POST') { const b = /** @type {any} */ (req.body); ctx.state.prep = String(b?.prep ?? '').slice(0, 4000); ctx.save(); ctx.render(); return { ok: true } }
    if (req.path === '/todo' && req.method === 'POST') { const b = /** @type {any} */ (req.body); if (b?.text) void addTodo(ctx, { text: String(b.text), due: b.due }); return { ok: true } }
    if (req.path === '/live') return { screen: ctx.mem.screen, text: transcript(ctx.mem), interim: ctx.mem.interim, cue: ctx.mem.cue }
    if (req.path === '/resummarize' && req.method === 'POST') {
      const id = Number(req.query.id || /** @type {any} */ (req.body)?.id)
      const x = s.get(id)
      if (!x) return { status: 404, json: { error: 'no such session' } }
      return summarize(ctx, id, x.transcript, x.prep).then(() => { s.finish(id); const y = s.get(id); return { ok: true, title: y?.title, summary: y?.summary, actions: y?.actions } })
    }
    if (req.path === '/import' && req.method === 'POST') {
      const b = /** @type {any} */ (req.body)
      const text = typeof b === 'string' ? b : String(b?.text ?? '')
      const name = req.query.name || (typeof b === 'object' && b ? String(b.name || '') : '')
      if (!text.trim()) return { status: 400, json: { error: 'text required (raw body or {"name","text"})' } }
      return importConversate(ctx, text, name).then((x) => ({ ok: true, session: x && { id: x.id, title: x.title, started: x.started, summary: x.summary, actions: x.actions } }))
        .catch((err) => ({ status: 400, json: { error: err instanceof Error ? err.message : String(err) } }))
    }
  },

  phone(ctx) {
    const m = ctx.mem
    const esc = (/** @type {string} */ t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c)
    const sessions = store(ctx).list(30)
    const cards = sessions.map((x) => `<details class="card"><summary><b>${esc(x.title || 'Untitled')}</b> <small class="muted">${new Date(x.started).toLocaleString(ctx.locale, { timeZone: ctx.tz })} · ${words(x.transcript)} words</small></summary>
      <p>${esc(x.summary)}</p>
      ${x.actions.length ? `<ul class="rows">${x.actions.map((a) => `<li><span>${esc(a.text)}${a.due ? ` <small class="muted">· ${esc(a.due)}</small>` : ''}</span><button data-todo="${esc(a.text)}" data-due="${esc(a.due || '')}">→ Todoist</button></li>`).join('')}</ul>` : ''}
      ${x.terms.length ? `<p class="muted">${x.terms.map((t) => `<b>${esc(t.term)}</b> — ${esc(t.definition)}`).join('<br>')}</p>` : ''}
      <details><summary class="muted">Transcript${x.source && x.source !== 'glasses' ? ` (${esc(x.source)})` : ''}</summary><pre>${esc(x.transcript)}</pre></details></details>`).join('')
    return `<h1>Transcribe <small class="muted">${m.screen === 'live' ? '● recording' : `${sessions.length} sessions`}</small></h1>
      <div class="card"><b>Prep notes for the next conversation</b>
        <p class="muted">Who you're meeting, the agenda, numbers and questions. Cues draw on these.</p>
        <textarea id="prep" rows="6" style="width:100%">${esc(ctx.state.prep)}</textarea>
        <div class="row" style="margin-top:8px"><button id="save-prep" class="primary">Save prep notes</button>${m.screen === 'idle' ? '<button id="start">Start on the glasses</button>' : m.screen === 'live' ? '<button id="stop">Stop</button>' : ''}</div>
      </div>
      <div class="card"><b>Import from Conversate</b>
        <p class="muted">In the Even app open a conversation → Share → TXT, then pick the file(s) here. Each becomes a session with a summary, searchable for cues.</p>
        <input type="file" id="import" accept=".txt,text/plain" multiple /> <span id="import-status" class="muted"></span>
      </div>
      ${cards || '<p class="muted">No sessions yet — tap the glasses to start one.</p>'}
      <script>
        document.getElementById('import').onchange = async (e) => {
          const st = document.getElementById('import-status'); const files = [...e.target.files]; let n = 0
          for (const f of files) { st.textContent = 'importing ' + f.name + '…'; try { await omni.api('/import', { method: 'POST', body: { name: f.name, text: await f.text() } }); n++ } catch (err) { st.textContent = 'failed: ' + f.name + ' — ' + err; return } }
          st.textContent = 'imported ' + n; setTimeout(omni.reload, 800)
        }
        document.getElementById('save-prep').onclick = () => omni.api('/prep', { method: 'POST', body: { prep: document.getElementById('prep').value } }).then(() => omni.reload())
        const st = document.getElementById('start'); if (st) st.onclick = () => omni.api('/message', { method: 'POST', body: { start: true } }).then(() => omni.reload())
        const sp = document.getElementById('stop'); if (sp) sp.onclick = () => omni.api('/message', { method: 'POST', body: { stop: true } }).then(() => setTimeout(omni.reload, 4000))
        for (const b of document.querySelectorAll('[data-todo]')) b.onclick = () => omni.api('/todo', { method: 'POST', body: { text: b.dataset.todo, due: b.dataset.due || undefined } }).then(() => { b.textContent = 'added ✓' })
      </script>`
  },
}
