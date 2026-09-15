// Clock — one app, three looks, every knob adjustable from the glasses
// (tap-and-hold → "Clock settings") or via PUT /api/apps/clock/state:
//   style  full   (time, date, battery — the whole screen)
//          small  (just the time in a corner, system font)
//          digits (big bitmap digits, sizable — the glasses have one font size,
//                  so bigger text has to be drawn as an image)
//   position, brightness, seconds / 12-hour / date, fade-away after N seconds,
//   and waking when you look up / down (IMU, with calibration + invert).
// The settings screens are rendered by the shell from the `settings` schema.

/**
 * @typedef {{ style: 'full'|'small'|'digits', position: string, size: number, brightness: number,
 *   seconds: boolean, hour12: boolean, date: boolean, fade: number, wake: 'up'|'down'|'both'|'tap',
 *   invert: boolean, threshold: number }} State
 * @typedef {{ lastActivity: number, neutral: {x:number,y:number,z:number}|null,
 *   imu: {x:number,y:number,z:number}|null, imuOn: boolean }} Mem
 */

const W = 576, H = 288
const POSITIONS = [
  ['top-left', 'Top left'], ['top', 'Top centre'], ['top-right', 'Top right'],
  ['left', 'Middle left'], ['center', 'Centre'], ['right', 'Middle right'],
  ['bottom-left', 'Bottom left'], ['bottom', 'Bottom centre'], ['bottom-right', 'Bottom right'],
]
const yesNo = [{ value: true, label: 'yes' }, { value: false, label: 'no' }]

/** @type {State} */
/**
 * Only values the settings schema offers (or a value of the default's type,
 * for keys without options) are accepted — a bad value would persist and
 * break render() until fixed.
 * @param {import('../../../shared/app.ts').AppContext<any, any>} ctx @param {string} k @param {unknown} v
 */
function validSetting(ctx, k, v) {
  /** @type {any[]} */ const schema = /** @type {any} */ (app).settings || []
  const opt = schema.find((o) => o.key === k)
  if (opt && Array.isArray(opt.options)) return opt.options.some((/** @type {any} */ o) => o.value === v)
  return typeof v === typeof /** @type {any} */ (DEFAULTS)[k]
}
const DEFAULTS = { style: 'full', position: 'top-right', size: 3, brightness: 3, seconds: true, hour12: false, date: true, fade: 0, wake: 'both', invert: false, threshold: 25 }

/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
function timeString(ctx) {
  const s = ctx.state
  // phone's time zone (ctx.tz), not the server's
  return new Date().toLocaleTimeString(ctx.locale, { hour: '2-digit', minute: '2-digit', ...(s.seconds ? { second: '2-digit' } : {}), hour12: s.hour12, timeZone: ctx.tz })
}
/** @param {string} pos @param {number} w @param {number} h */
function anchor(pos, w, h, margin = 4) {
  const x = pos.endsWith('left') ? margin : pos.endsWith('right') ? W - w - margin : Math.round((W - w) / 2)
  const y = pos.startsWith('top') ? margin : pos.startsWith('bottom') ? H - h - margin : Math.round((H - h) / 2)
  return { x: Math.max(0, x), y: Math.max(0, y) }
}
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx @param {boolean} on */
async function setImu(ctx, on) {
  if (ctx.mem.imuOn === on) return
  ctx.mem.imuOn = on
  try { await ctx.imu(on, 300) } catch (e) { ctx.log(`imu ${on}: ${e}`) }
}
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
const wantsImu = (ctx) => !!ctx.state.fade && ctx.state.wake !== 'tap'
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
const isFaded = (ctx) => !!ctx.state.fade && Date.now() - ctx.mem.lastActivity > ctx.state.fade * 1000
/** @param {import('../../../shared/app.ts').AppContext<State, Mem>} ctx */
function wake(ctx, by = 'tap') {
  if (isFaded(ctx)) ctx.log(`woke by ${by}`)
  ctx.mem.lastActivity = Date.now()
  ctx.render()
}

/** @type {import('../../../shared/app.ts').OmniApp<State, Mem>} */
const app = {
  title: 'Clock',
  order: 1,
  refresh: 1000,

  settings: [
    { key: 'style', label: 'Style', options: [{ value: 'full', label: 'full screen' }, { value: 'small', label: 'small (corner)' }, { value: 'digits', label: 'big digits' }] },
    { key: 'position', label: 'Position (small / digits)', options: POSITIONS.map(([value, label]) => ({ value, label })) },
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
  ],

  init(ctx) {
    for (const [k, v] of Object.entries(DEFAULTS)) if (ctx.state[/** @type {keyof State} */ (k)] === undefined) /** @type {any} */ (ctx.state)[k] = v
    ctx.mem.lastActivity = Date.now()
    ctx.mem.neutral ??= null
    ctx.mem.imu ??= null
    ctx.mem.imuOn = false
  },
  onOpen(ctx) { ctx.mem.lastActivity = Date.now(); if (wantsImu(ctx)) void setImu(ctx, true) },
  onClose(ctx) { void setImu(ctx, false) },
  unload(ctx) { void setImu(ctx, false) },

  onSettingsChange(ctx, key) {
    if (key === 'fade' || key === 'wake') void setImu(ctx, wantsImu(ctx))
    wake(ctx, 'settings')
  },
  onSettingsAction(ctx, key) {
    if (key === 'calibrate') {
      ctx.mem.neutral = ctx.mem.imu
      ctx.notify(ctx.mem.imu ? 'Level calibrated' : 'No IMU data yet — set a fade time and a look-up/down wake first', { ms: 2000 })
    }
  },
  settingsStatus(ctx) {
    const m = ctx.mem
    return m.imu ? `imu ${m.imu.x.toFixed(2)} ${m.imu.y.toFixed(2)} ${m.imu.z.toFixed(2)}${m.neutral ? '' : ' (uncalibrated)'}` : 'imu off'
  },

  render(ctx) {
    const s = ctx.state
    if (isFaded(ctx)) { if (wantsImu(ctx)) void setImu(ctx, true); return { containers: [] } }

    const time = timeString(ctx)
    const dateLine = s.date ? new Date().toLocaleDateString(ctx.locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: ctx.tz }) : ''

    if (s.style === 'full') {
      const batt = ctx.device?.status?.batteryLevel
      const long = s.date ? new Date().toLocaleDateString(ctx.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: ctx.tz }) : ''
      return {
        containers: ctx.ui.rows([
          `\n${time}`,
          long,
          ctx.ui.spread('tap-and-hold: clock settings', batt != null ? `glasses ${batt}%` : ''),
        ], { capture: 0 }).map((c) => ({ ...c, textColor: s.brightness })),
      }
    }

    /** @type {import('../../../shared/view.ts').Container[]} */
    const containers = []
    if (s.style === 'digits') {
      const scale = Math.max(1, Math.min(8, s.size))
      const { width, height } = ctx.ui.digitsSize(time, scale)
      const w = Math.max(20, Math.min(288, width + 2)), h = Math.max(20, Math.min(144, height + 2))
      const canvas = new ctx.Canvas(w, h)
      canvas.digits(1, 1, time, [40, 90, 140, 200, 255][s.brightness] ?? 255, scale)
      const { x, y } = anchor(s.position, w, h + (dateLine ? 30 : 0))
      containers.push({ type: 'image', name: 'time', x, y, w, h, png: canvas })
      if (dateLine) containers.push({ type: 'text', name: 'date', x, y: y + h, w: Math.max(w, 200), h: 31, padding: 2, textColor: s.brightness, text: dateLine })
    } else {
      const w = Math.min(W, Math.max(ctx.ui.getTextWidth(time), ctx.ui.getTextWidth(dateLine)) + 12)
      const h = dateLine ? 62 : 35
      const { x, y } = anchor(s.position, w, h)
      containers.push({ type: 'text', name: 'time', x, y, w, h, padding: 4, textColor: s.brightness, text: dateLine ? `${time}\n${dateLine}` : time })
    }
    return { containers }
  },

  onEvent(ctx, ev) {
    if (ev.type === 'tap' || ev.type === 'up' || ev.type === 'down') { wake(ctx, ev.type); return true }
  },

  onMessage(ctx, msg) {
    for (const k of Object.keys(DEFAULTS)) if (msg[k] !== undefined && validSetting(ctx, k, msg[k])) /** @type {any} */ (ctx.state)[k] = msg[k]
    ctx.save(); void setImu(ctx, wantsImu(ctx)); wake(ctx, 'message')
    return ctx.state
  },

  // Head pitch: the component of (now − neutral) that moved most, relative to
  // the neutral vector's magnitude (the G2 reports a unit gravity vector).
  onImu(ctx, imu) {
    const m = ctx.mem, s = ctx.state
    m.imu = imu
    if (!m.neutral) { m.neutral = imu; ctx.log(`imu neutral set to ${JSON.stringify(imu)}`); return }
    if (!isFaded(ctx)) return
    const d = { x: imu.x - m.neutral.x, y: imu.y - m.neutral.y, z: imu.z - m.neutral.z }
    const axis = /** @type {'x'|'y'|'z'} */ (Object.entries(d).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0][0])
    const mag = Math.hypot(m.neutral.x, m.neutral.y, m.neutral.z) || 1
    const tilt = d[axis] / mag * (s.invert ? -1 : 1)
    const need = Math.sin((s.threshold * Math.PI) / 180)
    if ((s.wake === 'up' || s.wake === 'both') && tilt > need) wake(ctx, `look-up ${axis}`)
    else if ((s.wake === 'down' || s.wake === 'both') && tilt < -need) wake(ctx, `look-down ${axis}`)
  },
}
export default app
