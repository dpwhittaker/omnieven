// Ring-buffered logger; the API exposes the buffer so a remote agent can read
// what happened without shell access to the box.
const MAX = 500
const buffer = []
const listeners = new Set()

export function log(tag, msg, extra) {
  const entry = { ts: Date.now(), tag, msg: String(msg), ...(extra ? { extra } : {}) }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.shift()
  const line = `${new Date(entry.ts).toISOString()} [${tag}] ${entry.msg}`
  if (tag === 'error') console.error(line); else console.log(line)
  for (const fn of listeners) { try { fn(entry) } catch {} }
}
export function recentLogs(n = 100) { return buffer.slice(-n) }
export function onLog(fn) { listeners.add(fn); return () => listeners.delete(fn) }
