// System monitor for the box the server runs on — demonstrates an image
// container drawn with the built-in Canvas (sparkline of CPU load).
import os from 'node:os'

/** @typedef {{ history: number[], last: {idle: number, total: number}, cpu: number }} Mem */

function cpuSnapshot() {
  let idle = 0, total = 0
  for (const c of os.cpus()) { total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq; idle += c.times.idle }
  return { idle, total }
}

/** @type {import('../shared/app.ts').OmniApp<{}, Mem>} */
export default {
  title: 'System',
  order: 3,
  refresh: 2000,

  init(ctx) {
    ctx.mem.history ??= []
    ctx.mem.last = cpuSnapshot()
    ctx.mem.cpu ??= 0
    ctx.setInterval(() => {
      const now = cpuSnapshot()
      const dTotal = now.total - ctx.mem.last.total, dIdle = now.idle - ctx.mem.last.idle
      ctx.mem.last = now
      ctx.mem.cpu = dTotal > 0 ? 1 - dIdle / dTotal : 0
      ctx.mem.history.push(ctx.mem.cpu)
      if (ctx.mem.history.length > 60) ctx.mem.history.shift()
    }, 2000)
  },

  render(ctx) {
    const mem = 1 - os.freemem() / os.totalmem()
    const [l1, l5, l15] = os.loadavg()
    const up = os.uptime()
    const cpu = ctx.mem.cpu
    const canvas = new ctx.Canvas(280, 100)
    canvas.frame(0, 0, 280, 100, 60)
    canvas.sparkline(ctx.mem.history.length > 1 ? ctx.mem.history : [0, 0], 4, 4, 272, 72, 255)
    canvas.text(6, 86, `CPU ${Math.round(cpu * 100)}%  60S`, 160, 2)
    return {
      containers: [
        { type: 'text', name: 'stats', x: 0, y: 0, w: 290, h: 288, padding: 6, capture: true, text: [
          os.hostname(),
          '',
          `cpu  ${ctx.ui.bar(cpu, 14)} ${String(Math.round(cpu * 100)).padStart(3)}%`,
          `mem  ${ctx.ui.bar(mem, 14)} ${String(Math.round(mem * 100)).padStart(3)}%`,
          `load ${l1.toFixed(2)}  ${l5.toFixed(2)}  ${l15.toFixed(2)}`,
          `up   ${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h ${Math.floor((up % 3600) / 60)}m`,
          `cores ${os.cpus().length}  ·  ${(os.totalmem() / 2 ** 30).toFixed(1)} GB`,
        ].join('\n') },
        { type: 'image', name: 'graph', x: 292, y: 20, w: 280, h: 100, png: canvas },
        { type: 'text', name: 'hint', x: 292, y: 130, w: 284, h: 60, padding: 6, textColor: 1, text: 'cpu history, 2 s samples' },
      ],
    }
  },
}
