// Small LLM adapter. Routing by tier:
//   fast  (cues)      GEMINI_API_KEY → Gemini Flash-Lite (~1 s) · else ANTHROPIC_API_KEY → Haiku · else `claude -p --model haiku`
//   smart (summaries) ANTHROPIC_API_KEY → Sonnet · else the local `claude` CLI (Claude Code headless; ~5–10 s, no key needed;
//                     CLAUDE_CLI=/path/to/claude if it is not on the service's PATH)

import { spawn } from 'node:child_process'

const API_MODELS = { fast: 'claude-haiku-4-5-20251001', smart: 'claude-sonnet-5' }
const CLI_MODELS = { fast: 'haiku', smart: 'sonnet' }
const GEMINI_DEFAULT = 'gemini-3.5-flash-lite'

/**
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch, log?: (m: string) => void }} host
 * @param {{ system: string, prompt: string, model?: 'fast' | 'smart', maxTokens?: number, timeoutMs?: number }} req
 * @returns {Promise<string>}
 */
export async function ask(host, req) {
  const model = req.model || 'fast'
  const timeoutMs = req.timeoutMs ?? 25_000
  if (model === 'fast' && host.env.GEMINI_API_KEY) {
    const name = host.env.GEMINI_MODEL || GEMINI_DEFAULT
    const r = await host.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': host.env.GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? 600, temperature: 0.1, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`)
    /** @type {any} */ const j = await r.json()
    return (j.candidates?.[0]?.content?.parts || []).map((/** @type {any} */ p) => p.text || '').join('')
  }
  if (host.env.ANTHROPIC_API_KEY) {
    const r = await host.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': host.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: API_MODELS[model], max_tokens: req.maxTokens ?? 600, system: req.system, messages: [{ role: 'user', content: req.prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
    /** @type {any} */ const j = await r.json()
    return (j.content || []).map((/** @type {any} */ c) => c.text || '').join('')
  }
  return new Promise((resolve, reject) => {
    const p = spawn(host.env.CLAUDE_CLI || 'claude', ['-p', '--model', CLI_MODELS[model], '--output-format', 'text', '--system-prompt', req.system], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDECODE: '' } })
    let out = '', err = ''
    const t = setTimeout(() => { p.kill(); reject(new Error('claude CLI timed out')) }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => { clearTimeout(t); reject(e) })
    p.on('close', (code) => { clearTimeout(t); if (code === 0) resolve(out.trim()); else reject(new Error(`claude CLI exit ${code}: ${err.slice(0, 200)}`)) })
    p.stdin.end(req.prompt)
  })
}

/** Parse the JSON object in a model reply (tolerates code fences and prose around it). @param {string} text */
export function parseJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e < s) return null
  try { return JSON.parse(text.slice(s, e + 1)) } catch { return null }
}
