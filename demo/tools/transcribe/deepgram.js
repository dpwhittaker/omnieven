// Deepgram streaming speech-to-text over WebSocket (Node ≥ 22 has a global WebSocket).
// Input: 16 kHz s16le mono PCM frames from the glasses mic. Output: interim and
// final transcript segments with the speaker index when diarization is on.

const URL_ = 'wss://api.deepgram.com/v1/listen'
const KEEPALIVE_MS = 5000

/**
 * @param {{ key: string, language?: string, onSegment: (seg: { text: string, final: boolean, speaker: number | null, speechFinal: boolean }) => void,
 *   onError: (msg: string) => void, onClose?: () => void, log?: (msg: string) => void }} opts
 */
export function openStream(opts) {
  const params = new URLSearchParams({
    model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1',
    interim_results: 'true', smart_format: 'true', punctuate: 'true', diarize: 'true',
    endpointing: '300', utterance_end_ms: '1200', language: opts.language || 'en',
  })
  // auth via subprotocol (works with the standard constructor, browser or Node)
  const ws = new WebSocket(`${URL_}?${params}`, ['token', opts.key])
  let open = false, closed = false
  /** @type {Uint8Array[]} */ const queue = []
  let lastSent = Date.now()
  const keep = setInterval(() => {
    if (open && !closed && Date.now() - lastSent > KEEPALIVE_MS - 500) { try { ws.send(JSON.stringify({ type: 'KeepAlive' })) } catch {} }
  }, KEEPALIVE_MS)

  ws.addEventListener('open', () => { open = true; for (const q of queue) ws.send(q); queue.length = 0 })
  ws.addEventListener('message', (ev) => {
    let msg
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    if (msg.type !== 'Results') return
    const alt = msg.channel?.alternatives?.[0]
    const text = (alt?.transcript || '').trim()
    if (!text) return
    const speaker = alt?.words?.length ? (alt.words[0].speaker ?? null) : null
    opts.onSegment({ text, final: !!msg.is_final, speaker, speechFinal: !!msg.speech_final })
  })
  ws.addEventListener('error', () => { if (!closed) opts.onError('Deepgram socket error') })
  ws.addEventListener('close', (ev) => {
    clearInterval(keep)
    if (!closed && ev.code !== 1000) opts.onError(`Deepgram closed (${ev.code} ${ev.reason || ''})`.trim())
    closed = true
    opts.onClose?.()
  })

  return {
    /** @param {Uint8Array} pcm */
    send(pcm) {
      if (closed) return
      lastSent = Date.now()
      if (open) ws.send(pcm); else if (queue.length < 200) queue.push(pcm)
    },
    close() {
      if (closed) return
      closed = true
      clearInterval(keep)
      try { if (open) ws.send(JSON.stringify({ type: 'CloseStream' })) } catch {}
      setTimeout(() => { try { ws.close(1000) } catch {} }, 500)
    },
    get open() { return open && !closed },
  }
}
