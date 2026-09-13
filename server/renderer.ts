// Turns the declarative "view" an app returns into Even Hub page containers,
// enforcing the firmware limits, and diffs successive views so that a pure
// text change becomes a flicker-free textContainerUpgrade instead of a full
// rebuild.
import { createHash } from 'node:crypto'
import type { CmdArgs, CmdOp, ImageObject, ListObject, PagePayload, TextObject } from '../shared/protocol.ts'
import type { Container, ExplicitView, ImageContainer, ListContainer, MenuItem, TextContainer, View } from '../shared/view.ts'

export const SCREEN = { width: 576, height: 288, lineHeight: 27 } as const
// Firmware limits. Text sizes are UTF-8 *bytes* (the simulator's changelog:
// "text container bytes limit to 999", "list item text size maximum 63 bytes");
// one oversized string makes the whole page rebuild fail on the glasses.
const LIMITS = {
  containers: 12, textOrList: 8, images: 4,
  textPageBytes: 999, textUpgradeBytes: 1999, listItems: 20, listItemBytes: 63,
  nameChars: 16, menuItems: 10, menuBytes: 32,
}

const clamp = (n: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(n) || 0))
const trunc = (s: unknown, n: number) => { const str = String(s ?? ''); return str.length > n ? str.slice(0, n) : str }
function truncBytes(s: unknown, n: number): string {
  const str = String(s ?? '')
  if (Buffer.byteLength(str, 'utf8') <= n) return str
  // Cut on a code point boundary without producing a dangling surrogate.
  let out = ''
  let bytes = 0
  for (const ch of str) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (bytes + b > n) break
    out += ch; bytes += b
  }
  return out
}

export interface CompiledImage { containerID: number; containerName: string; png: string; hash: string }
export interface CompiledText { containerName: string; content: string; textColor?: number }
export interface Compiled {
  page: PagePayload
  images: CompiledImage[]
  texts: Map<number, CompiledText>
  /** everything except text content and image pixels */
  structureKey: string
  textDump: string
}
export type Op = { [K in CmdOp]: { op: K; args: CmdArgs[K] } }[CmdOp]

/**
 * Accepts the shorthand forms apps may return and produces the canonical
 * `{containers, menu}` shape.
 */
export function canonicalView(view: View): { containers: Container[]; menu: MenuItem[] } {
  if (view == null) view = ''
  if (typeof view === 'string' || typeof view === 'number') view = { text: String(view) }
  if (Array.isArray(view)) view = { containers: view }
  if ('containers' in view) return { containers: view.containers, menu: view.menu || [] }
  const full = { x: 0, y: 0, w: SCREEN.width, h: SCREEN.height, capture: true }
  if ('list' in view) {
    const { list, menu, ...rest } = view
    return { containers: [{ type: 'list', ...full, items: list, ...rest } as ListContainer], menu: menu || [] }
  }
  const { text, menu, ...rest } = view
  return { containers: [{ type: 'text', ...full, text: text ?? '', padding: 4, ...rest } as TextContainer], menu: menu || [] }
}

function kindOf(c: Container): 'text' | 'list' | 'image' {
  if (c.type) return c.type
  if ('items' in c) return 'list'
  if ('png' in c) return 'image'
  return 'text'
}

/** Canonical view → compiled page + images + text map. */
export function compile(view: View, { forUpgrade = false } = {}): Compiled {
  const { containers, menu } = canonicalView(view)
  const textObject: TextObject[] = [], listObject: ListObject[] = [], imageObject: ImageObject[] = []
  const images: CompiledImage[] = []
  const texts = new Map<number, CompiledText>()
  const names = new Set<string>()
  let captureSet = false
  let id = 0

  const uniqueName = (base: string | undefined, fallback: string) => {
    let n = trunc(base || fallback, LIMITS.nameChars)
    let i = 2
    while (names.has(n)) n = trunc(`${base || fallback}${i++}`, LIMITS.nameChars)
    names.add(n)
    return n
  }
  const geometry = (c: TextContainer | ListContainer) => ({
    xPosition: clamp(c.x, 0, SCREEN.width), yPosition: clamp(c.y, 0, SCREEN.height),
    width: clamp(c.w ?? SCREEN.width, 0, SCREEN.width), height: clamp(c.h ?? SCREEN.height, 0, SCREEN.height),
  })
  const decoration = (c: TextContainer | ListContainer) => ({
    borderWidth: clamp(c.border?.width ?? 0, 0, 5),
    borderColor: clamp(c.border?.color ?? 0, 0, 15),
    borderRadius: clamp(c.border?.radius ?? 0, 0, 10),
    paddingLength: clamp(c.padding ?? 0, 0, 32),
  })

  for (const c of containers) {
    if (!c || typeof c !== 'object') continue
    const kind = kindOf(c)
    if (kind === 'image') {
      const ic = c as ImageContainer
      if (imageObject.length >= LIMITS.images) continue
      if (id >= LIMITS.containers) break
      const w = clamp(ic.w ?? 288, 20, 288), h = clamp(ic.h ?? 144, 20, 144)
      const containerID = ++id
      const containerName = uniqueName(ic.name, `img${containerID}`)
      imageObject.push({
        xPosition: clamp(ic.x, 0, SCREEN.width), yPosition: clamp(ic.y, 0, SCREEN.height),
        width: w, height: h, containerID, containerName, zOrderIndex: containerID,
      })
      let src: unknown = ic.png
      if (src && typeof src === 'object' && 'toPng' in src && typeof (src as any).toPng === 'function') src = (src as any).toPng()
      const b64 = Buffer.isBuffer(src) ? src.toString('base64')
        : src instanceof Uint8Array ? Buffer.from(src).toString('base64')
        : typeof src === 'string' ? src : null
      if (b64) images.push({ containerID, containerName, png: b64, hash: createHash('sha1').update(b64).digest('hex') })
      continue
    }
    if (textObject.length + listObject.length >= LIMITS.textOrList) continue
    if (id >= LIMITS.containers) break
    const containerID = ++id
    const capture: 0 | 1 = (c as TextContainer | ListContainer).capture && !captureSet ? 1 : 0
    if (capture) captureSet = true
    if (kind === 'list') {
      const lc = c as ListContainer
      const raw = (lc.items || []).map((it) => typeof it === 'string' ? it : it?.label ?? String(it))
      const items = raw.slice(0, LIMITS.listItems).map((s) => truncBytes(s, LIMITS.listItemBytes) || ' ')
      if (!items.length) items.push(' ')
      const containerName = uniqueName(lc.name, `list${containerID}`)
      listObject.push({
        ...geometry(lc), ...decoration(lc), containerID, containerName, zOrderIndex: containerID,
        isEventCapture: capture,
        itemContainer: {
          itemCount: items.length, itemWidth: clamp(lc.itemWidth ?? 0, 0, SCREEN.width),
          isItemSelectBorderEn: lc.selectBorder === false ? 0 : 1, itemName: items,
        },
      })
    } else {
      const tc = c as TextContainer
      const containerName = uniqueName(tc.name, `text${containerID}`)
      const limit = forUpgrade ? LIMITS.textUpgradeBytes : LIMITS.textPageBytes
      const content = truncBytes(tc.text ?? '', limit) || ' '
      const entry: TextObject = {
        ...geometry(tc), ...decoration(tc), containerID, containerName, zOrderIndex: containerID,
        isEventCapture: capture, content,
      }
      if (tc.textColor != null) entry.textColor = clamp(tc.textColor, 0, 4)
      textObject.push(entry)
      texts.set(containerID, { containerName, content, textColor: entry.textColor })
    }
  }

  // Exactly one capture container is mandatory; fall back to the first list,
  // then first text, then an invisible full-screen text layer at the back.
  if (!captureSet) {
    if (listObject[0]) listObject[0].isEventCapture = 1
    else if (textObject[0]) textObject[0].isEventCapture = 1
    else if (id < LIMITS.containers) {
      const containerID = ++id
      const containerName = uniqueName('', 'events')
      textObject.push({
        xPosition: 0, yPosition: 0, width: SCREEN.width, height: SCREEN.height,
        borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0,
        containerID, containerName, zOrderIndex: 0, isEventCapture: 1, content: ' ',
      })
      texts.set(containerID, { containerName, content: ' ' })
    }
  }

  const page: PagePayload = { containerTotalNum: id, textObject, listObject, imageObject }
  const menuItems = (menu || []).slice(0, LIMITS.menuItems)
    .map((m) => (typeof m === 'string' ? { id: m, label: m } : m))
    .filter((m): m is { id: string | number; label?: string } => !!m && m.id != null)
    // ids here are already numeric (assigned by the shell); string ids are dropped
    .filter((m) => Number.isInteger(m.id) && (m.id as number) > 0)
    .map((m) => ({ itemID: m.id as number, itemName: truncBytes(m.label ?? String(m.id), LIMITS.menuBytes) || '-' }))
  if (menuItems.length) page.menuObject = { menuItems }

  const structureKey = JSON.stringify({
    t: textObject.map(({ content: _c, textColor: _tc, ...rest }) => rest),
    l: listObject, i: imageObject, m: page.menuObject ?? null,
  })
  const textDump = [
    ...textObject.map((t) => t.content.trim()).filter(Boolean),
    ...listObject.map((l) => l.itemContainer.itemName.map((s, i) => `${i + 1}. ${s}`).join('\n')),
  ].join('\n---\n')

  return { page, images, texts, structureKey, textDump }
}

/**
 * Diff a compiled view against the last committed one and return the client
 * commands needed. `null` committed means the page must be (re)built.
 */
export function diff(committed: Compiled | null, next: Compiled): Op[] {
  const ops: Op[] = []
  if (!committed || committed.structureKey !== next.structureKey) {
    ops.push({ op: 'page', args: next.page })
    for (const im of next.images) ops.push({ op: 'image', args: { containerID: im.containerID, containerName: im.containerName, png: im.png } })
    return ops
  }
  for (const [cid, t] of next.texts) {
    const prev = committed.texts.get(cid)
    if (!prev || prev.content !== t.content || prev.textColor !== t.textColor) {
      const args: CmdArgs['text'] = { containerID: cid, containerName: t.containerName, content: t.content }
      if (t.textColor != null) args.textColor = t.textColor
      ops.push({ op: 'text', args })
    }
  }
  const prevImages = new Map(committed.images.map((im) => [im.containerID, im.hash]))
  for (const im of next.images) {
    if (prevImages.get(im.containerID) !== im.hash) {
      ops.push({ op: 'image', args: { containerID: im.containerID, containerName: im.containerName, png: im.png } })
    }
  }
  return ops
}
