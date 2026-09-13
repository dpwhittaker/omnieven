// Turns the declarative "view" a tab returns into Even Hub page containers,
// enforcing the firmware limits, and diffs successive views so that a pure
// text change becomes a flicker-free textContainerUpgrade instead of a full
// rebuild.
import { createHash } from 'node:crypto'
import { Canvas } from './png.js'

export const SCREEN = { width: 576, height: 288, lineHeight: 27 }
const LIMITS = {
  containers: 12, textOrList: 8, images: 4,
  textPage: 1000, textUpgrade: 2000, listItems: 20, listItemChars: 64,
  nameChars: 16, menuItems: 10, menuBytes: 32,
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0))
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) : s }
function truncBytes(s, n) {
  s = String(s ?? '')
  while (Buffer.byteLength(s, 'utf8') > n) s = s.slice(0, -1)
  return s
}

/**
 * Accepts the shorthand forms tabs are allowed to return and produces the
 * canonical `{containers, menu}` shape.
 *   'text'                       → one full-screen text container
 *   {text, ...textOpts}          → one full-screen text container
 *   {list: [...], ...listOpts}   → one full-screen list container
 *   {containers: [...], menu}    → explicit
 */
export function canonicalView(view) {
  if (view == null) view = ''
  if (typeof view === 'string' || typeof view === 'number') view = { text: String(view) }
  if (Array.isArray(view)) view = { containers: view }
  if (view.containers) return { containers: view.containers, menu: view.menu || [] }
  const full = { x: 0, y: 0, w: SCREEN.width, h: SCREEN.height, capture: true }
  if (view.list) {
    const { list, menu, ...rest } = view
    return { containers: [{ type: 'list', ...full, items: list, ...rest }], menu: menu || [] }
  }
  const { text, menu, ...rest } = view
  return { containers: [{ type: 'text', ...full, text: text ?? '', padding: 4, ...rest }], menu: menu || [] }
}

/**
 * Canonical view → { page, images, texts, structureKey, textDump }.
 *   page:  the CreateStartUpPageContainer / RebuildPageContainer payload
 *   images: [{containerID, containerName, png (base64), hash}]
 *   texts: Map(containerID → {containerName, content, textColor})
 */
export function compile(view, { forUpgrade = false } = {}) {
  const { containers, menu } = canonicalView(view)
  const textObject = [], listObject = [], imageObject = [], images = [], texts = new Map()
  const names = new Set()
  let captureSet = false
  let id = 0

  const uniqueName = (base, fallback) => {
    let n = trunc(base || fallback, LIMITS.nameChars)
    let i = 2
    while (names.has(n)) n = trunc(`${base || fallback}${i++}`, LIMITS.nameChars)
    names.add(n)
    return n
  }
  const geometry = (c) => ({
    xPosition: clamp(c.x, 0, SCREEN.width), yPosition: clamp(c.y, 0, SCREEN.height),
    width: clamp(c.w ?? SCREEN.width, 0, SCREEN.width), height: clamp(c.h ?? SCREEN.height, 0, SCREEN.height),
  })
  const decoration = (c) => ({
    borderWidth: clamp(c.border?.width ?? c.borderWidth ?? 0, 0, 5),
    borderColor: clamp(c.border?.color ?? c.borderColor ?? 0, 0, 15),
    borderRadius: clamp(c.border?.radius ?? c.borderRadius ?? 0, 0, 10),
    paddingLength: clamp(c.padding ?? c.paddingLength ?? 0, 0, 32),
  })

  for (const c of containers) {
    if (!c || typeof c !== 'object') continue
    const type = c.type || (c.items || c.list ? 'list' : c.png || c.canvas || c.image ? 'image' : 'text')
    if (type === 'image') {
      if (imageObject.length >= LIMITS.images) continue
      if (id >= LIMITS.containers) break
      const w = clamp(c.w ?? 288, 20, 288), h = clamp(c.h ?? 144, 20, 144)
      const containerID = ++id
      const containerName = uniqueName(c.name, `img${containerID}`)
      imageObject.push({
        xPosition: clamp(c.x, 0, SCREEN.width), yPosition: clamp(c.y, 0, SCREEN.height),
        width: w, height: h, containerID, containerName, zOrderIndex: containerID,
      })
      let src = c.png ?? c.canvas ?? c.image
      if (src instanceof Canvas) src = src.toPng()
      let b64 = Buffer.isBuffer(src) ? src.toString('base64') : typeof src === 'string' ? src : null
      if (b64) {
        images.push({ containerID, containerName, png: b64, hash: createHash('sha1').update(b64).digest('hex') })
      }
      continue
    }
    if (textObject.length + listObject.length >= LIMITS.textOrList) continue
    if (id >= LIMITS.containers) break
    const containerID = ++id
    const capture = !!c.capture && !captureSet ? 1 : 0
    if (capture) captureSet = true
    if (type === 'list') {
      const raw = (c.items || c.list || []).map((it) => typeof it === 'string' ? it : it?.label ?? String(it))
      const items = raw.slice(0, LIMITS.listItems).map((s) => trunc(s, LIMITS.listItemChars) || ' ')
      if (!items.length) items.push(' ')
      const containerName = uniqueName(c.name, `list${containerID}`)
      listObject.push({
        ...geometry(c), ...decoration(c), containerID, containerName, zOrderIndex: containerID,
        isEventCapture: capture,
        itemContainer: {
          itemCount: items.length, itemWidth: clamp(c.itemWidth ?? 0, 0, SCREEN.width),
          isItemSelectBorderEn: c.selectBorder === false ? 0 : 1, itemName: items,
        },
      })
    } else {
      const containerName = uniqueName(c.name, `text${containerID}`)
      const limit = forUpgrade ? LIMITS.textUpgrade : LIMITS.textPage
      const content = trunc(c.text ?? c.content ?? '', limit) || ' '
      const entry = {
        ...geometry(c), ...decoration(c), containerID, containerName, zOrderIndex: containerID,
        isEventCapture: capture, content,
      }
      if (c.textColor != null) entry.textColor = clamp(c.textColor, 0, 4)
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

  const page = { containerTotalNum: id, textObject, listObject, imageObject }
  const menuItems = (menu || []).slice(0, LIMITS.menuItems)
    .filter((m) => m && Number.isInteger(m.id) && m.id > 0)
    .map((m) => ({ itemID: m.id, itemName: truncBytes(m.label ?? String(m.id), LIMITS.menuBytes) || '-' }))
  if (menuItems.length) page.menuObject = { menuItems }

  // Anything that is not text content or image pixels changes the layout.
  const structureKey = JSON.stringify({
    t: textObject.map(({ content, textColor, ...rest }) => rest),
    l: listObject, i: imageObject, m: page.menuObject ?? null,
  })
  const textDump = [
    ...textObject.map((t) => t.content.trim()).filter(Boolean),
    ...listObject.map((l) => l.itemContainer.itemName.map((s, i) => `${i + 1}. ${s}`).join('\n')),
  ].join('\n---\n')

  return { page, images, texts, structureKey, textDump }
}

/**
 * Diff a compiled view against the last committed one and return the list of
 * client commands needed. `null` committed means the page must be (re)built.
 */
export function diff(committed, next) {
  const ops = []
  if (!committed || committed.structureKey !== next.structureKey) {
    ops.push({ op: 'page', args: next.page })
    for (const im of next.images) ops.push({ op: 'image', args: { containerID: im.containerID, containerName: im.containerName, png: im.png } })
    return ops
  }
  for (const [cid, t] of next.texts) {
    const prev = committed.texts.get(cid)
    if (!prev || prev.content !== t.content || prev.textColor !== t.textColor) {
      const args = { containerID: cid, containerName: t.containerName, content: t.content }
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
