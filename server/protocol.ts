// Normalisation of raw Even Hub events into the small vocabulary apps deal
// with. The wire types themselves live in shared/protocol.ts.
import type { EvenHubEvent, EventSource, NormalizedEvent } from '../shared/protocol.ts'

// OsEventTypeList (PB ordinals). Zero-valued fields are omitted on the wire,
// so a missing eventType means CLICK.
export const OS = {
  CLICK: 0, SCROLL_TOP: 1, SCROLL_BOTTOM: 2, DOUBLE_CLICK: 3,
  FOREGROUND_ENTER: 4, FOREGROUND_EXIT: 5, ABNORMAL_EXIT: 6, SYSTEM_EXIT: 7,
  IMU: 8, LONG_PRESS: 9, LONG_PRESS_RELEASE: 10,
} as const

const SOURCE: Record<number, EventSource> = { 1: 'glasses-right', 2: 'ring', 3: 'glasses-left' }

const TYPE_NAMES: Record<number, NormalizedEvent['type']> = {
  [OS.CLICK]: 'tap', [OS.DOUBLE_CLICK]: 'double',
  [OS.SCROLL_TOP]: 'up', [OS.SCROLL_BOTTOM]: 'down',
  [OS.LONG_PRESS]: 'longpress', [OS.LONG_PRESS_RELEASE]: 'release',
  [OS.FOREGROUND_ENTER]: 'enter', [OS.FOREGROUND_EXIT]: 'exit',
  [OS.ABNORMAL_EXIT]: 'abnormal-exit', [OS.SYSTEM_EXIT]: 'system-exit',
  [OS.IMU]: 'imu',
}

/**
 * Clicks arrive as sysEvent, scrolls as textEvent, list picks as listEvent —
 * but firmware versions differ, so every envelope is checked.
 */
export function normalizeEvent(ev: EvenHubEvent | null | undefined): NormalizedEvent {
  if (!ev || typeof ev !== 'object') return { type: 'unknown' }
  if (ev.menuItemClickEvent) {
    return { type: 'menu', itemId: Number(ev.menuItemClickEvent.itemID ?? 0) }
  }
  if (ev.listEvent) {
    const l = ev.listEvent
    const et = l.eventType ?? OS.CLICK
    if (et === OS.CLICK) {
      return { type: 'select', index: Number(l.currentSelectItemIndex ?? 0), name: l.currentSelectItemName ?? '', container: l.containerName }
    }
    return { ...({ type: TYPE_NAMES[et] || 'unknown' } as NormalizedEvent), container: l.containerName } as NormalizedEvent
  }
  if (ev.textEvent) {
    const et = ev.textEvent.eventType ?? OS.CLICK
    return { ...({ type: TYPE_NAMES[et] || 'unknown' } as NormalizedEvent), container: ev.textEvent.containerName } as NormalizedEvent
  }
  if (ev.sysEvent) {
    const s = ev.sysEvent
    const et = s.eventType ?? OS.CLICK
    if (et === OS.IMU) return { type: 'imu', imu: { x: s.imuData?.x ?? 0, y: s.imuData?.y ?? 0, z: s.imuData?.z ?? 0 } }
    const out = { type: TYPE_NAMES[et] || 'unknown', source: SOURCE[s.eventSource ?? 0] || 'glasses' } as NormalizedEvent & { reason?: number }
    if (s.systemExitReasonCode != null) out.reason = s.systemExitReasonCode
    return out
  }
  return { type: 'unknown' }
}
