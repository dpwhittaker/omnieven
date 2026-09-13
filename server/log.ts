// Ring-buffered logger; the API exposes the buffer so a remote agent can read
// what happened without shell access to the box.
export interface LogEntry { ts: number; tag: string; msg: string; extra?: unknown }

const MAX = 500
const buffer: LogEntry[] = []
const listeners = new Set<(e: LogEntry) => void>()

export function log(tag: string, msg: unknown, extra?: unknown): void {
  const entry: LogEntry = { ts: Date.now(), tag, msg: String(msg), ...(extra !== undefined ? { extra } : {}) }
  buffer.push(entry)
  if (buffer.length > MAX) buffer.shift()
  const line = `${new Date(entry.ts).toISOString()} [${tag}] ${entry.msg}`
  if (tag === 'error') console.error(line); else console.log(line)
  for (const fn of listeners) { try { fn(entry) } catch {} }
}
export function recentLogs(n = 100): LogEntry[] { return buffer.slice(-n) }
export function onLog(fn: (e: LogEntry) => void): () => void { listeners.add(fn); return () => listeners.delete(fn) }
