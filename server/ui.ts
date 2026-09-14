// Text layout helpers for apps. Measurements come from @evenrealities/pretext,
// which replicates the firmware's LVGL font metrics, so wrapping and
// truncation match what the glasses actually draw.
import { getTextWidth, measureTextWrap, pxTruncate } from '@evenrealities/pretext'
import { SCREEN } from './renderer.ts'
import type { TextContainer } from '../shared/view.ts'
export { digitsSize } from './png.ts'

export const LINE = SCREEN.lineHeight
export { getTextWidth, pxTruncate }

/** Pixel width → how many text lines fit in `heightPx`. */
export function linesFor(heightPx: number, padding = 0): number { return Math.max(1, Math.floor((heightPx - 2 * padding) / LINE)) }

/** Wrap `text` to `widthPx` and return the resulting lines (firmware rules). */
export function wrap(text: string, widthPx: number): string[] {
  const out: string[] = []
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
export function paginate(text: string, { widthPx = SCREEN.width - 8, lines = linesFor(SCREEN.height, 4) } = {}): string[] {
  const all = wrap(text, widthPx)
  const pages: string[] = []
  for (let i = 0; i < all.length; i += lines) pages.push(all.slice(i, i + lines).join('\n'))
  return pages.length ? pages : ['']
}

/** Fit a single line into `widthPx`, adding an ellipsis when needed. */
export function fit(text: string | number, widthPx: number): string { return pxTruncate(String(text ?? ''), widthPx) }

/** Measure wrapped height in px. */
export function measure(text: string, widthPx: number) { return measureTextWrap(String(text ?? ''), widthPx) }

/** Progress bar built from block characters the firmware font has. */
export function bar(fraction: number, cells = 20, fill = '━', empty = '─'): string {
  const n = Math.round(Math.max(0, Math.min(1, fraction)) * cells)
  return fill.repeat(n) + empty.repeat(cells - n)
}

/** Rendered width of a single line of text in px. */
export function width(text: string | number): number { return getTextWidth(String(text ?? '')) }

/**
 * Pad a single line with leading spaces so it sits centred or at the right
 * edge of `widthPx` (the firmware only left-aligns). Text wider than the box
 * is cut with an ellipsis.
 */
export function align(text: string | number, widthPx: number, how: 'left' | 'center' | 'right'): string {
  const t = pxTruncate(String(text ?? ''), widthPx)
  if (how === 'left') return t
  const space = getTextWidth(' ') || 6
  const gap = widthPx - getTextWidth(t)
  let n = Math.max(0, Math.floor((how === 'right' ? gap : gap / 2) / space))
  // advances don't add up exactly; never let the padded line exceed the box
  while (n > 0 && getTextWidth(' '.repeat(n) + t) > widthPx) n--
  return ' '.repeat(n) + t
}

/** Two-column line: left text, right text pushed to `widthPx` using spaces. */
export function spread(left: string | number, right: string | number, widthPx = SCREEN.width - 8): string {
  left = String(left ?? ''); right = String(right ?? '')
  const space = getTextWidth(' ') || 6
  let gap = widthPx - getTextWidth(left) - getTextWidth(right)
  if (gap < space) return `${left} ${right}`
  return left + ' '.repeat(Math.floor(gap / space)) + right
}

/** Stack N rows of full-width text containers (equal heights). */
export function rows(texts: string[], { capture = 0, padding = 4, gap = 0 } = {}): TextContainer[] {
  const h = Math.floor((SCREEN.height - gap * (texts.length - 1)) / texts.length)
  return texts.map((text, i) => ({
    type: 'text', name: `row${i + 1}`, x: 0, y: i * (h + gap), w: SCREEN.width, h,
    text, padding, capture: i === capture,
  }))
}

/** Header line + body area. Body is the capture container (scrolls). */
export function headerBody(header: string, body: string, { headerHeight = 36, bodyOpts = {} as Partial<TextContainer> } = {}): TextContainer[] {
  return [
    { type: 'text', name: 'header', x: 0, y: 0, w: SCREEN.width, h: headerHeight, text: header, padding: 4, textColor: 2 },
    { type: 'text', name: 'body', x: 0, y: headerHeight, w: SCREEN.width, h: SCREEN.height - headerHeight, text: body, padding: 4, capture: true, ...bodyOpts },
  ]
}

export function clock(date = new Date(), { seconds = false, hour12 = false, tz = undefined as string | undefined, locale = undefined as string | undefined } = {}): string {
  return date.toLocaleTimeString(locale || [], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12, timeZone: tz })
}
