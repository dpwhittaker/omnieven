// Gesture sequence recognition. Feeds normalised gestures into a short
// history and reports every binding key (longest sequence first) that the
// latest gesture completes.
import { GESTURE_WINDOW_MS, type GestureBindings, type GestureKey } from '../shared/config.ts'
import type { NormalizedEvent } from '../shared/protocol.ts'

const MAX_SEQ = 4

export class GestureTracker {
  private history: { g: string; at: number }[] = []

  /** Returns candidate keys for this event, e.g. ['tap>longpress', 'longpress'], or [] for non-gestures. */
  feed(ev: NormalizedEvent, now = Date.now()): GestureKey[] {
    const g = ev.type === 'select' ? 'tap' : ev.type
    if (!['tap', 'double', 'longpress', 'up', 'down'].includes(g)) return []
    const last = this.history[this.history.length - 1]
    if (!last || now - last.at > GESTURE_WINDOW_MS) this.history = []
    this.history.push({ g, at: now })
    if (this.history.length > MAX_SEQ) this.history.shift()
    const keys: GestureKey[] = []
    for (let n = this.history.length; n >= 1; n--) keys.push(this.history.slice(-n).map((h) => h.g).join('>'))
    return keys
  }

  /** After a sequence fires, forget it so its tail cannot re-trigger. */
  reset(): void { this.history = [] }
}

/** First binding (longest sequence wins) among the candidate keys. */
export function matchBinding(bindings: GestureBindings, keys: GestureKey[]): { key: GestureKey; action: string } | null {
  for (const key of keys) {
    const action = bindings[key]
    if (action && action !== 'none') return { key, action }
    if (action === 'none') return null
  }
  return null
}
