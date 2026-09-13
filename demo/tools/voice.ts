// Voice memo — a TypeScript app (Node runs .ts natively) showing the mic:
// tap to record from the glasses mic, tap again to stop; the PCM is saved as
// a WAV in the app's data dir and a live level meter is drawn while recording.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OmniApp } from '../../shared/app.ts'

interface Mem { recording: boolean; chunks: Buffer[]; level: number; startedAt: number; lastFile?: string; files: string[] }

const RATE = 16000
function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

export default {
  title: 'Voice memo',
  order: 6,
  refresh: 250,

  init(ctx) {
    ctx.mem.recording = false
    ctx.mem.chunks = []
    ctx.mem.level = 0
    ctx.mem.files ??= []
  },

  render(ctx) {
    const m = ctx.mem
    const secs = m.recording ? ((Date.now() - m.startedAt) / 1000).toFixed(1) : '0.0'
    const meter = m.recording ? ctx.ui.bar(m.level, 24, '█', '·') : ctx.ui.bar(0, 24, '█', '·')
    return {
      containers: [
        { type: 'text', name: 'main', x: 0, y: 0, w: 576, h: 200, padding: 8, capture: true, text: [
          m.recording ? `● REC  ${secs}s` : 'Voice memo',
          '',
          meter,
          '',
          m.recording ? 'tap: stop & save' : 'tap: start recording (glasses mic)',
          m.lastFile ? `saved: ${m.lastFile}` : '',
        ].join('\n') },
        { type: 'text', name: 'hint', x: 0, y: 210, w: 576, h: 70, padding: 8, textColor: 1,
          text: `${m.files.length} memo(s) in data/apps/voice  ·  double-tap: home` },
      ],
    }
  },

  async onEvent(ctx, ev) {
    if (ev.type !== 'tap') return
    const m = ctx.mem
    if (!m.recording) {
      m.chunks = []; m.level = 0; m.startedAt = Date.now()
      const ok = await ctx.audio(true, 'glasses')
      m.recording = Array.isArray(ok) ? ok.some(Boolean) : !!ok
      if (!m.recording) ctx.notify('Mic did not start', { ms: 2000 })
    } else {
      await ctx.audio(false)
      m.recording = false
      const pcm = Buffer.concat(m.chunks)
      if (pcm.length) {
        const name = `memo-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`
        writeFileSync(join(ctx.dataDir, name), wav(pcm))
        m.lastFile = name
        m.files.push(name)
        ctx.log(`saved ${name} (${(pcm.length / RATE / 2).toFixed(1)}s)`)
      }
    }
    ctx.render()
  },

  onAudio(ctx, pcm) {
    const m = ctx.mem
    if (!m.recording) return
    const buf = Buffer.from(pcm)
    m.chunks.push(buf)
    let sum = 0
    for (let i = 0; i + 1 < buf.length; i += 2) { const v = buf.readInt16LE(i) / 32768; sum += v * v }
    const rms = Math.sqrt(sum / Math.max(1, buf.length / 2))
    m.level = Math.min(1, rms * 4)
  },

  onClose(ctx) { if (ctx.mem.recording) { void ctx.audio(false); ctx.mem.recording = false } },
} satisfies OmniApp<{}, Mem>
