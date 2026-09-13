// Mini clock — the time in a corner, nothing else lit. Everything about it is
// adjustable from the glasses (long-press → settings) or via
// PUT /api/apps/miniclock/state:
//   position, style (text | big digits), size, brightness, seconds/12h/date,
//   fade-away after N seconds, and waking when you look up / down (IMU).
// A folder app: helpers live next to index.js; `group` puts it in a home folder.
import { optionRows, settingsRows, settingsSelect } from './settings.js'

/**
 * @typedef {{ position: string, style: 'text'|'digits', size: number, brightness: number,
 *   seconds: boolean, hour12: boolean, date: boolean, fade: number, wake: 'up'|'down'|'both'|'tap',
 *   invert: boolean, threshold: number }} State
 * @typedef {{ ui: { screen: 'clock'|'settings'|'option', index: number }, lastActivity: number,
 *   neutral: {x:number,y:number,z:number}|null, imu: {x:number,y:number,z:number}|null,
 *   imuOn: boolean, wokeBy: string }} Mem
 */

const W = 576, H = 288
const POSITIONS = [
  ['top-left', 'Top left'], ['top', 'Top centre'], ['top-right', 'Top right'],
  ['left', 'Middle left'], ['center', 'Centre'], ['right', 'Middle right'],
  ['bottom-left', 'Bottom left'], ['bottom', 'Bottom centre'], ['bottom-right', 'Bottom right'],
]
const yesNo = [{ value: true, label: 'yes' }, { value: false, label: 'no' }]

/** @type {import('./settings.js').Setting[]} */
const SCHEMA = [
  { key: 'position', label: 'Position', options: POSITIONS.map(([value, label]) => ({ value, label })) },
  { key: 'style', label: 'Style', options: [{ value: 'text', label: 'text (system font)' }, { value: 'digits', label: 'big digits' }] },
  { key: 'size', label: 'Digit size', options: [1, 2, 3, 4, 5, 6, 8].map((v) => ({ value: v, label: `${v}×` })) },
  { key: 'brightness', label: 'Brightness', options: [0, 1, 2, 3, 4].map((v) => ({ value: v, label: ['dimmest', 'dim', 'medium', 'bright', 'brightest'][v] })) },
  { key: 'seconds', label: 'Show seconds', options: yesNo },
  { key: 'hour12', label: '12-hour clock', options: yesNo },
  { key: 'date', label: 'Show date', options: yesNo },
  { key: 'fade', label: 'Fade away after', options: [{ value: 0, label: 'never' }, { value: 5, label: '5 s' }, { value: 15, label: '15 s' }, { value: 60, label: '1 min' }, { value: 300, label: '5 min' }] },
  { key: 'wake', label: 'Wake when looking', options: [{ value: 'up', label: 'up' }, { value: 'down', label: 'down' }, { value: 'both', label: 'up or down' }, { value: 'tap', label: 'tap only (no IMU)' }] },
  { key: 'threshold', label: 'Head tilt needed', options: [{ value: 15, label: 'small (15°)' }, { value: 25, label: 'medium (25°)' }, { value: 40, label: 'large (40°)' }] },
  { key: 'invert', label: 'Invert up/down', options: yesNo },
  { key: 'calibrate', label: 'Calibrate level (look straight ahead, then tap)', action: true },
]

/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function timeString(ctx) {
  const s = ctx.state
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(s.seconds ? { second: '2-digit' } : {}), hour12: s.hour12 })
}
/** Anchor a w×h box on the 576×288 canvas. @param {string} pos @param {number} w @param {number} h */
function anchor(pos, w, h, margin = 4) {
  const x = pos.endsWith('left') ? margin : pos.endsWith('right') ? W - w - margin : Math.round((W - w) / 2)
  const y = pos.startsWith('top') ? margin : pos.startsWith('bottom') ? H - h - margin : Math.round((H - h) / 2)
  return { x: Math.max(0, x), y: Math.max(0, y) }
}
/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx @param {boolean} on */
async function setImu(ctx, on) {
  if (ctx.mem.imuOn === on) return
  ctx.mem.imuOn = on
  try { await ctx.imu(on, 300) } catch (e) { ctx.log(`imu ${on}: ${e}`) }
}
/** @param {import('../../shared/app.ts').AppContext<State, Mem>} ctx */
function wake(ctx, by = 'tap') {
  const wasFaded = !!ctx.state.fade && Date.now() - ctx.mem.lastActivity > ctx.state.fade * 1000
  ctx.mem.lastActivity = Date.now()
  ctx.mem.wokeBy = by
  if (wasFaded) ctx.log(`woke by ${by}`)
  ctx.render()
}

/** @type {import('../../shared/app.ts').OmniApp<State, Mem>} */
export default {
  title: 'Mini clock',
  group: 'Time',
  order: 7,
  refresh: 1000,
  menu: [{ id: 'settings', label: 'Clock settings' }],

  init(ctx) {
    const d = { position: 'top-right', style: 'text', size: 3, brightness: 2, seconds: false, hour12: false, date: false, fade: 0, wake: 'both', invert: false, threshold: 25 }
    for (const [k, v] of Object.entries(d)) if (ctx.state[/** @type {keyof State} */ (k)] === undefined) /** @type {any} */ (ctx.state)[k] = v
    ctx.mem.ui ??= { screen: 'clock', index: 0 }
    ctx.mem.lastActivity = Date.now()
    ctx.mem.neutral ??= null
    ctx.mem.imu ??= null
    ctx.mem.imuOn = false
  },

  onOpen(ctx) {
    ctx.mem.ui.screen = 'clock'
    ctx.mem.lastActivity = Date.now()
    if (ctx.state.fade && ctx.state.wake !== 'tap') void setImu(ctx, true)
  },
  onClose(ctx) { void setImu(ctx, false) },
  unload(ctx) { void setImu(ctx, false) },

  render(ctx) {
    const s = ctx.state, m = ctx.mem
    if (m.ui.screen === 'settings') {
      const imu = m.imu ? `imu ${m.imu.x.toFixed(2)} ${m.imu.y.toFixed(2)} ${m.imu.z.toFixed(2)}${m.neutral ? '' : ' (uncalibrated)'}` : 'imu off'
      return {
        containers: [
          { type: 'text', name: 'header', x: 0, y: 0, w: W, h: 34, padding: 4, textColor: 2, text: `Mini clock settings  ·  ${imu}  ·  double-tap: back` },
          { type: 'list', name: 'settings', x: 0, y: 34, w: W, h: H - 34, capture: true, items: settingsRows(SCHEMA, s) },
        ],
      }
    }
    if (m.ui.screen === 'option') {
      const setting = /** @type {import('./settings.js').OptionSetting} */ (SCHEMA[m.ui.index])
      return {
        containers: [
          { type: 'text', name: 'header', x: 0, y: 0, w: W, h: 34, padding: 4, textColor: 2, text: `${setting.label}  ·  tap to choose` },
          { type: 'list', name: 'options', x: 0, y: 34, w: W, h: H - 34, capture: true, items: optionRows(setting, s) },
        ],
      }
    }

    // Faded: draw nothing (the renderer keeps an invisible capture layer).
    if (s.fade && Date.now() - m.lastActivity > s.fade * 1000) {
      if (s.wake !== 'tap') void setImu(ctx, true)
      return { containers: [] }
    }

    const time = timeString(ctx)
    const dateLine = s.date ? new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : ''
    /** @type {import('../../shared/view.ts').Container[]} */
    const containers = []
    if (s.style === 'digits') {
      const scale = Math.max(1, Math.min(8, s.size))
      const { width, height } = ctx.ui.digitsSize(time, scale)
      const w = Math.max(20, Math.min(288, width + 2)), h = Math.max(20, Math.min(144, height + 2))
      const canvas = new ctx.Canvas(w, h)
      canvas.digits(1, 1, time, [40, 90, 140, 200, 255][s.brightness] ?? 255, scale)
      const boxH = h + (dateLine ? 30 : 0)
      const { x, y } = anchor(s.position, w, boxH)
      containers.push({ type: 'image', name: 'time', x, y, w, h, png: canvas })
      if (dateLine) containers.push({ type: 'text', name: 'date', x, y: y + h, w: Math.max(w, 200), h: 30, padding: 2, textColor: s.brightness, text: dateLine })
    } else {
      const w = Math.min(W, Math.max(ctx.ui.getTextWidth(time), ctx.ui.getTextWidth(dateLine)) + 12)
      const h = dateLine ? 62 : 34
      const { x, y } = anchor(s.position, w, h)
      containers.push({ type: 'text', name: 'time', x, y, w, h, padding: 4, textColor: s.brightness, text: dateLine ? `${time}\n${dateLine}` : time })
    }
    return { containers }
  },

  onEvent(ctx, ev) {
    const m = ctx.mem
    if (m.ui.screen !== 'clock') {
      if (ev.type === 'double') { m.ui.screen = m.ui.screen === 'option' ? 'settings' : 'clock'; wake(ctx); return true }
      if (ev.type === 'select') {
        const r = settingsSelect(SCHEMA, ctx.state, m.ui, ev.index)
        if (r.result === 'action' && r.key === 'calibrate') { m.neutral = m.imu; ctx.notify(m.imu ? 'Level calibrated' : 'No IMU data yet — enable fade + wake first', { ms: 1500 }) }
        if (r.result === 'apply') {
          if (r.key === 'fade' || r.key === 'wake') void setImu(ctx, !!ctx.state.fade && ctx.state.wake !== 'tap')
          ctx.save()
        }
        wake(ctx)
      }
      return true
    }
    if (ev.type === 'longpress') { m.ui.screen = 'settings'; ctx.render(); return true }
    if (ev.type === 'tap' || ev.type === 'up' || ev.type === 'down') { wake(ctx, ev.type); return true }
  },

  onMenu(ctx, id) {
    if (id === 'settings') { ctx.mem.ui.screen = 'settings'; ctx.render() }
  },

  onMessage(ctx, msg) {
    // e.g. {"position":"bottom-left","style":"digits","size":4}
    for (const s of SCHEMA) if (!('action' in s) && msg[s.key] !== undefined) /** @type {any} */ (ctx.state)[s.key] = msg[s.key]
    ctx.save(); wake(ctx, 'message')
    return ctx.state
  },

  // Head pitch: the component of (now − neutral) that moved most, relative to
  // the neutral vector's magnitude (works for accelerometer-style data; the
  // settings header shows the raw values so the threshold can be tuned).
  onImu(ctx, imu) {
    const m = ctx.mem, s = ctx.state
    m.imu = imu
    if (!m.neutral) { m.neutral = imu; ctx.log(`imu neutral set to ${JSON.stringify(imu)}`); return }
    const d = { x: imu.x - m.neutral.x, y: imu.y - m.neutral.y, z: imu.z - m.neutral.z }
    const axis = /** @type {'x'|'y'|'z'} */ (Object.entries(d).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0])
    const mag = Math.hypot(m.neutral.x, m.neutral.y, m.neutral.z) || 1
    const tilt = d[axis] / mag * (s.invert ? -1 : 1)
    const need = Math.sin((s.threshold * Math.PI) / 180)
    const faded = s.fade && Date.now() - m.lastActivity > s.fade * 1000
    if (!faded) return
    if ((s.wake === 'up' || s.wake === 'both') && tilt > need) wake(ctx, `look-up ${axis}`)
    else if ((s.wake === 'down' || s.wake === 'both') && tilt < -need) wake(ctx, `look-down ${axis}`)
  },
}
