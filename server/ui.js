// Text layout helpers for tabs. Measurements come from @evenrealities/pretext,
// which replicates the firmware's LVGL font metrics, so wrapping and
// truncation match what the glasses actually draw.
import { getTextWidth, measureTextWrap, pxTruncate } from '@evenrealities/pretext'
import { SCREEN } from './renderer.js'

export const LINE = SCREEN.lineHeight
export { getTextWidth, pxTruncate }

/** Pixel width → how many text lines fit in `heightPx`. */
export function linesFor(heightPx, padding = 0) { return Math.max(1, Math.floor((heightPx - 2 * padding) / LINE)) }

/** Wrap `text` to `widthPx` and return the resulting lines (firmware rules). */
export function wrap(text, widthPx) {
  const out = []
  for (const para of String(text ?? '').split('\n')) {
    if (!para) { out.push(''); continue }
    const words = para.split(/(\s+)/)
    let line = ''
    for (const w of words) {
      const cand = line + w
      if (getTextWidth(cand) <= widthPx || !line) {
        line = cand
        // A single word wider than the box: hard-break it.
        while (getTextWidth(line) > widthPx && line.length > 1) {
          let cut = line.length - 1
          while (cut > 1 && getTextWidth(line.slice(0, cut)) > widthPx) cut--
          out.push(line.slice(0, cut))
          line = line.slice(cut)
        }
      } else {
        out.push(line.trimEnd())
        line = w.trimStart()
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

/** Split long text into screen-sized pages of wrapped lines. */
export function paginate(text, { widthPx = SCREEN.width - 8, lines = linesFor(SCREEN.height, 4) } = {}) {
  const all = wrap(text, widthPx)
  const pages = []
  for (let i = 0; i < all.length; i += lines) pages.push(all.slice(i, i + lines).join('\n'))
  return pages.length ? pages : ['']
}

/** Fit a single line into `widthPx`, adding an ellipsis when needed. */
export function fit(text, widthPx) { return pxTruncate(String(text ?? ''), widthPx) }

/** Measure wrapped height in px. */
export function measure(text, widthPx) { return measureTextWrap(String(text ?? ''), widthPx) }

/** Progress bar built from block characters the firmware font has. */
export function bar(fraction, cells = 20, fill = '━', empty = '─') {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * cells)
  return fill.repeat(n) + empty.repeat(cells - n)
}

/** Two-column line: left text, right text pushed to `widthPx` using spaces. */
export function spread(left, right, widthPx = SCREEN.width - 8) {
  left = String(left ?? ''); right = String(right ?? '')
  const space = getTextWidth(' ') || 6
  let gap = widthPx - getTextWidth(left) - getTextWidth(right)
  if (gap < space) return `${left} ${right}`
  return left + ' '.repeat(Math.floor(gap / space)) + right
}

/** Stack N rows of full-width text containers (equal heights). */
export function rows(texts, { capture = 0, padding = 4, gap = 0 } = {}) {
  const h = Math.floor((SCREEN.height - gap * (texts.length - 1)) / texts.length)
  return texts.map((text, i) => ({
    type: 'text', name: `row${i + 1}`, x: 0, y: i * (h + gap), w: SCREEN.width, h,
    text, padding, capture: i === capture,
  }))
}

/** Header line + body area. Body is the capture container (scrolls). */
export function headerBody(header, body, { headerHeight = 36, bodyOpts = {} } = {}) {
  return [
    { type: 'text', name: 'header', x: 0, y: 0, w: SCREEN.width, h: headerHeight, text: header, padding: 4, textColor: 2 },
    { type: 'text', name: 'body', x: 0, y: headerHeight, w: SCREEN.width, h: SCREEN.height - headerHeight, text: body, padding: 4, capture: true, ...bodyOpts },
  ]
}

export function clock(date = new Date(), { seconds = false, hour12 = false } = {}) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12 })
}
