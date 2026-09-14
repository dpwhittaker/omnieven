#!/usr/bin/env node
// Brain map: turn new session transcripts into a linked knowledge vault using
// Claude Code headless (tools enabled, confined to the Transcribe data folder).
//
//   node apps/tools/transcribe/brain-map.mjs            # process sessions not yet folded in
//   node apps/tools/transcribe/brain-map.mjs --all      # rebuild consideration over every session
//   node apps/tools/transcribe/brain-map.mjs --dry-run  # show what would be processed
//
// Env: OMNI_DATA_DIR (default ./data), CLAUDE_CLI (default `claude`), BRAIN_MAP_MODEL (default sonnet).
// Writes data/apps/transcribe/knowledge/ and a .brain-map.json marker of processed sessions.

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(process.env.OMNI_DATA_DIR || 'data')
const APP = join(DATA, 'apps', 'transcribe')
const SESSIONS = join(APP, 'sessions')
const VAULT = join(APP, 'knowledge')
const MARKER = join(APP, '.brain-map.json')
const CLI = process.env.CLAUDE_CLI || 'claude'
const MODEL = process.env.BRAIN_MAP_MODEL || 'sonnet'
const args = new Set(process.argv.slice(2))

mkdirSync(VAULT, { recursive: true })
if (!existsSync(join(VAULT, 'CLAUDE.md'))) copyFileSync(join(here, 'vault', 'CLAUDE.md'), join(VAULT, 'CLAUDE.md'))
const marker = existsSync(MARKER) ? JSON.parse(readFileSync(MARKER, 'utf8')) : { done: [], runs: [] }
const files = existsSync(SESSIONS) ? readdirSync(SESSIONS).filter((f) => f.endsWith('.md')).sort() : []
const todo = args.has('--all') ? files : files.filter((f) => !marker.done.includes(f))
if (!todo.length) { console.log('brain-map: nothing new'); process.exit(0) }
console.log(`brain-map: ${todo.length} session file(s):\n  ${todo.join('\n  ')}`)
if (args.has('--dry-run')) process.exit(0)

const profile = existsSync(join(DATA, 'profile.md')) ? readFileSync(join(DATA, 'profile.md'), 'utf8') : ''
const prompt = `You maintain the knowledge vault in ./knowledge (read ./knowledge/CLAUDE.md first and follow it exactly).
${profile ? `\nThe owner of this vault:\n${profile}\n` : ''}
Fold these new session files into the vault (they are in ./sessions/):
${todo.map((f) => `- sessions/${f}`).join('\n')}

Steps:
1. Read ./knowledge/CLAUDE.md, then ./knowledge/index.md and ./knowledge/timeline.md if they exist, so you know what is already covered.
2. Read each listed session file in full (summary, action items, terms, people, transcript).
3. Update or create notes under ./knowledge/ (people/, tools/, terms/, projects/, decisions.md, open-items.md, timeline.md, index.md) per the conventions. Search for existing notes before creating new ones; merge aliases. Cite session ids.
4. Finish by making sure index.md links to every section and reflects the owner's current focus.
Only write inside ./knowledge/. When done, print one line per note created or updated.`

const started = Date.now()
const child = spawn(CLI, ['-p', prompt, '--model', MODEL, '--output-format', 'text',
  '--allowedTools', 'Read,Write,Edit,MultiEdit,Glob,Grep,LS', '--permission-mode', 'acceptEdits'],
  { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CLAUDECODE: '' } })
let out = ''
child.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
child.stderr.on('data', (d) => process.stderr.write(d))
const timer = setTimeout(() => { console.error('brain-map: timed out after 25 min'); child.kill() }, 25 * 60_000)
child.on('close', (code) => {
  clearTimeout(timer)
  const secs = Math.round((Date.now() - started) / 1000)
  if (code === 0) {
    marker.done = [...new Set([...marker.done, ...todo])]
    marker.runs.push({ at: new Date().toISOString(), files: todo.length, secs })
    marker.runs = marker.runs.slice(-30)
    writeFileSync(MARKER, JSON.stringify(marker, null, 2))
    console.log(`brain-map: done in ${secs}s`)
  } else console.error(`brain-map: claude exited ${code} after ${secs}s`)
  process.exit(code ?? 1)
})
