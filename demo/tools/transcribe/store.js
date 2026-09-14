// Sessions live in SQLite (with FTS5 for recall cues) plus one markdown file per
// session in <dataDir>/sessions/ so an assistant can read them directly.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** @typedef {{ id: number, started: number, ended: number | null, source: string, location: string, title: string, summary: string, actions: { text: string, due?: string, done?: boolean }[], terms: { term: string, definition: string }[], people: { name: string, role?: string }[], prep: string, transcript: string }} Session */

export class Store {
  /** @param {string} dir */
  constructor(dir) {
    mkdirSync(join(dir, 'sessions'), { recursive: true })
    this.dir = dir
    this.db = new DatabaseSync(join(dir, 'transcripts.db'))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY, started INTEGER NOT NULL, ended INTEGER, title TEXT DEFAULT '', summary TEXT DEFAULT '',
        actions TEXT DEFAULT '[]', terms TEXT DEFAULT '[]', people TEXT DEFAULT '[]', prep TEXT DEFAULT '', transcript TEXT DEFAULT '');
      CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(session_id UNINDEXED, text);
    `)
    try { this.db.exec("ALTER TABLE sessions ADD COLUMN source TEXT DEFAULT 'glasses'") } catch {}
    try { this.db.exec("ALTER TABLE sessions ADD COLUMN location TEXT DEFAULT ''") } catch {}
  }
  /** @param {any} row @returns {Session} */
  static row(row) {
    return { ...row, actions: JSON.parse(row.actions || '[]'), terms: JSON.parse(row.terms || '[]'), people: JSON.parse(row.people || '[]') }
  }
  /** @param {{ started: number, prep: string, source?: string, location?: string }} s */
  create(s) {
    const r = this.db.prepare('INSERT INTO sessions (started, prep, source, location) VALUES (?, ?, ?, ?)').run(s.started, s.prep, s.source || 'glasses', s.location || '')
    return Number(r.lastInsertRowid)
  }
  /** @param {number} id @param {Partial<Session>} patch */
  update(id, patch) {
    const cols = [], vals = []
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id') continue
      cols.push(`${k} = ?`); vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v)
    }
    if (!cols.length) return
    this.db.prepare(`UPDATE sessions SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id)
  }
  /** Index the finished transcript for recall and write the markdown copy. @param {number} id */
  finish(id) {
    const s = this.get(id)
    if (!s) return
    this.db.prepare('DELETE FROM fts WHERE session_id = ?').run(id)
    this.db.prepare('INSERT INTO fts (session_id, text) VALUES (?, ?)').run(id, `${s.title}\n${s.summary}\n${s.transcript}`)
    const date = new Date(s.started).toISOString().slice(0, 16).replace('T', ' ')
    const slug = (s.title || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    const md = [
      `# ${s.title || 'Untitled session'}`, '', `- date: ${date}`, `- session: ${s.id}`, `- source: ${s.source || 'glasses'}`, s.location ? `- location: ${s.location}` : '', '',
      s.prep ? `## Prep notes\n\n${s.prep}\n` : '',
      `## Summary\n\n${s.summary}\n`,
      s.actions.length ? `## Action items\n\n${s.actions.map((a) => `- [ ] ${a.text}${a.due ? ` (${a.due})` : ''}`).join('\n')}\n` : '',
      s.terms.length ? `## Terms\n\n${s.terms.map((t) => `- **${t.term}** — ${t.definition}`).join('\n')}\n` : '',
      s.people.length ? `## People\n\n${s.people.map((p) => `- ${p.name}${p.role ? ` — ${p.role}` : ''}`).join('\n')}\n` : '',
      `## Transcript\n\n${s.transcript}`,
    ].filter(Boolean).join('\n')
    // the id keeps two sessions with the same title from sharing a file
    const file = `${date.slice(0, 10)}-${slug || 'session'}-${s.id}.md`
    for (const f of readdirSync(join(this.dir, 'sessions'))) {   // rename if the title changed
      if (f !== file && f.endsWith(`-${s.id}.md`)) unlinkSync(join(this.dir, 'sessions', f))
    }
    writeFileSync(join(this.dir, 'sessions', file), md)
  }
  /** An already-imported copy of the same conversation, if any. @param {number} started @param {string} transcript */
  findDuplicate(started, transcript) {
    const rows = this.db.prepare('SELECT * FROM sessions WHERE started BETWEEN ? AND ?').all(started - 60_000, started + 60_000)
    const r = rows.find((x) => String(x.transcript) === transcript)
    return r ? Store.row(r) : null
  }
  /** @param {number} id */
  remove(id) {
    this.db.prepare('DELETE FROM fts WHERE session_id = ?').run(id)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    const dir = join(this.dir, 'sessions')
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const head = readFileSync(join(dir, f), 'utf8').slice(0, 400)
      if (f.endsWith(`-${id}.md`) || head.includes(`\n- session: ${id}\n`)) unlinkSync(join(dir, f))
    }
  }
  /** @param {number} id @returns {Session | null} */
  get(id) { const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id); return r ? Store.row(r) : null }
  /** @param {number} [limit] @returns {Session[]} */
  list(limit = 20) { return this.db.prepare('SELECT * FROM sessions WHERE ended IS NOT NULL ORDER BY started DESC LIMIT ?').all(limit).map(Store.row) }
  /**
   * Recall: sessions whose text matches any of the terms, with a snippet.
   * @param {string[]} terms @param {number} [exclude] @returns {{ id: number, title: string, started: number, snippet: string }[]}
   */
  search(terms, exclude = 0, limit = 3) {
    const q = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')
    if (!q) return []
    try {
      return /** @type {any[]} */ (this.db.prepare(`
        SELECT s.id, s.title, s.started, snippet(fts, 1, '', '', '…', 28) AS snippet
        FROM fts JOIN sessions s ON s.id = fts.session_id
        WHERE fts MATCH ? AND s.id != ? ORDER BY bm25(fts) LIMIT ?`).all(q, exclude, limit))
    } catch { return [] }
  }
  /** Open action items across all sessions (for reminders). */
  openActions(limit = 20) {
    /** @type {{ session: number, title: string, text: string, due?: string }[]} */ const out = []
    for (const s of this.list(50)) for (const a of s.actions) if (!a.done) out.push({ session: s.id, title: s.title, text: a.text, due: a.due })
    return out.slice(0, limit)
  }
}
