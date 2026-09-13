// Omni glasses client. Deliberately dumb: it owns no UI logic. It relays
// every glasses/phone event to the Omni server over a WebSocket and executes
// the render commands the server sends back through the Even Hub SDK.
//
// The phone-side page (index.html) is a small settings form: server URL and
// token, persisted through the Even App's storage bridge.

import {
  waitForEvenAppBridge,
  AudioInputSource,
  ImageRawDataUpdate,
  OsEventTypeList,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { OmniSocket } from './ws'
import { CLIENT_VERSION, type ServerFrame } from './protocol'

const PROFILE_KEY = 'omni.profile.v1'
const CALL_TIMEOUT_MS = 8000

type Profile = { url: string; token: string }

// ── phone UI ─────────────────────────────────────────────────────────
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const elUrl = $<HTMLInputElement>('url')
const elToken = $<HTMLInputElement>('token')
const elStatus = $<HTMLDivElement>('status')
const elLog = $<HTMLPreElement>('log')
const elSave = $<HTMLButtonElement>('save')
const elDisconnect = $<HTMLButtonElement>('disconnect')

const logLines: string[] = []
function log(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
  const line = `${new Date().toLocaleTimeString()} ${msg}`
  logLines.push(line)
  if (logLines.length > 80) logLines.shift()
  elLog.textContent = logLines.join('\n')
  elLog.scrollTop = elLog.scrollHeight
  ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(msg)
  sock.send({ t: 'log', level, msg })
}
function setStatus(text: string, cls: 'ok' | 'bad' | 'wait') {
  elStatus.textContent = text
  elStatus.className = `status ${cls}`
}

// Default server = wherever this page was served from (the Omni server hosts
// the client), so a sideloaded install needs only the token.
function defaultUrl(): string {
  const loc = window.location
  if (!/^https?:$/.test(loc.protocol)) return ''
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`
}
function tokenFromQuery(): string {
  const p = new URLSearchParams(window.location.search)
  return p.get('token') || ''
}

// ── bridge + socket ──────────────────────────────────────────────────
let bridge: EvenAppBridge | null = null
let pageCreated = false
let launchSource: string | null = null
let audioOn = false
let cmdChain: Promise<unknown> = Promise.resolve()

const sock = new OmniSocket({
  onOpen: () => {
    setStatus('Connected', 'ok')
    log('socket open')
    void sendHello()
  },
  onClose: (reason) => {
    setStatus(`Disconnected (${reason || 'closed'}) – retrying`, 'wait')
  },
  onJson: (frame: ServerFrame) => {
    if (frame.t === 'ping') { sock.send({ t: 'pong' }); return }
    if (frame.t === 'welcome') { log(`server ${frame.serverVersion}`); return }
    if (frame.t === 'error') { log(`server error: ${frame.msg}`, 'error'); return }
    if (frame.t === 'cmd') {
      // Bridge calls must never overlap: the SDK shares one BLE link.
      cmdChain = cmdChain.then(() => runCmd(frame.id, frame.op, frame.args)).catch(() => {})
    }
  },
})

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), CALL_TIMEOUT_MS)),
  ])
}

async function sendHello() {
  const profile = currentProfile()
  let device: unknown = null
  let user: unknown = null
  try { device = await withTimeout(bridge!.getDeviceInfo(), 'getDeviceInfo') } catch (e) { log(`getDeviceInfo: ${e}`, 'warn') }
  try { user = await withTimeout(bridge!.getUserInfo(), 'getUserInfo') } catch (e) { log(`getUserInfo: ${e}`, 'warn') }
  sock.send({
    t: 'hello',
    token: profile.token,
    client: { version: CLIENT_VERSION, sdk: '0.0.15' },
    device, user, launchSource, pageCreated,
  })
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function runCmd(id: number, op: string, args: any) {
  const reply = (ok: boolean, value?: unknown, error?: string) => sock.send({ t: 'result', id, ok, value, error })
  if (!bridge) { reply(false, undefined, 'bridge not ready'); return }
  try {
    switch (op) {
      case 'page': {
        if (!pageCreated) {
          const r = await withTimeout(bridge.createStartUpPageContainer(args), 'createStartUpPageContainer')
          pageCreated = r === 0
          reply(r === 0, r, r === 0 ? undefined : `create result ${r}`)
        } else {
          const ok = await withTimeout(bridge.rebuildPageContainer(args), 'rebuildPageContainer')
          reply(!!ok, ok, ok ? undefined : 'rebuild returned false')
        }
        return
      }
      case 'text': {
        const ok = await withTimeout(bridge.textContainerUpgrade(args), 'textContainerUpgrade')
        reply(!!ok, ok, ok ? undefined : 'upgrade returned false')
        return
      }
      case 'image': {
        const r = await withTimeout(bridge.updateImageRawData(new ImageRawDataUpdate({
          containerID: args.containerID,
          containerName: args.containerName,
          imageData: b64ToBytes(args.png),
        })), 'updateImageRawData')
        reply(r === 'success', r, r === 'success' ? undefined : `image result ${r}`)
        return
      }
      case 'audio': {
        const src = args.source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses
        const ok = await withTimeout(bridge.audioControl(!!args.on, src), 'audioControl')
        audioOn = !!args.on && !!ok
        reply(!!ok, ok)
        return
      }
      case 'imu': {
        const ok = await withTimeout(bridge.imuControl(!!args.on, args.pace), 'imuControl')
        reply(!!ok, ok)
        return
      }
      case 'location': {
        if (args.once) {
          const loc = await withTimeout(bridge.getAppLocation(args), 'getAppLocation')
          reply(true, loc)
        } else if (args.on) {
          const ok = await withTimeout(bridge.startAppLocationUpdates(args), 'startAppLocationUpdates')
          reply(!!ok, ok)
        } else {
          const ok = await withTimeout(bridge.stopAppLocationUpdates(), 'stopAppLocationUpdates')
          reply(!!ok, ok)
        }
        return
      }
      case 'storage.get': {
        const v = await withTimeout(bridge.getLocalStorage(String(args.key)), 'getLocalStorage')
        reply(true, v)
        return
      }
      case 'storage.set': {
        const ok = await withTimeout(bridge.setLocalStorage(String(args.key), String(args.value)), 'setLocalStorage')
        reply(!!ok, ok)
        return
      }
      case 'shutdown': {
        const ok = await withTimeout(bridge.shutDownPageContainer(args?.mode ?? 1), 'shutDownPageContainer')
        if (args?.mode === 0) pageCreated = false
        reply(!!ok, ok)
        return
      }
      case 'reload': {
        reply(true)
        setTimeout(() => window.location.reload(), 200)
        return
      }
      default:
        reply(false, undefined, `unknown op ${op}`)
    }
  } catch (err) {
    log(`${op} failed: ${(err as Error).message}`, 'error')
    reply(false, undefined, (err as Error).message)
  }
}

// ── event relay ──────────────────────────────────────────────────────
function relayEvent(ev: EvenHubEvent) {
  if (ev.audioEvent) {
    // PCM 16 kHz s16le mono. Binary frame; the server knows the format.
    const pcm = (ev.audioEvent as any).audioPcm as Uint8Array | undefined
    if (pcm && audioOn) sock.sendBinary(pcm)
    return
  }
  const sys = ev.sysEvent
  if (sys) {
    const type = sys.eventType ?? OsEventTypeList.CLICK_EVENT
    if (type === OsEventTypeList.SYSTEM_EXIT_EVENT || type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      // The glasses page is gone; the next 'page' must be a create again.
      pageCreated = false
      audioOn = false
    }
    if (type === OsEventTypeList.IMU_DATA_REPORT) {
      sock.send({ t: 'event', ev: { sysEvent: { eventType: type, imuData: sys.imuData } } })
      return
    }
  }
  sock.send({ t: 'event', ev })
}

// ── profile ──────────────────────────────────────────────────────────
function currentProfile(): Profile {
  return { url: elUrl.value.trim(), token: elToken.value.trim() }
}

async function loadProfile(): Promise<Profile> {
  let saved: Profile | null = null
  try {
    const raw = await withTimeout(bridge!.getLocalStorage(PROFILE_KEY), 'getLocalStorage')
    if (raw) saved = JSON.parse(raw)
  } catch (e) { log(`profile load: ${e}`, 'warn') }
  const url = saved?.url || defaultUrl()
  const token = tokenFromQuery() || saved?.token || ''
  return { url, token }
}

async function saveProfile(p: Profile) {
  try { await withTimeout(bridge!.setLocalStorage(PROFILE_KEY, JSON.stringify(p)), 'setLocalStorage') }
  catch (e) { log(`profile save: ${e}`, 'warn') }
}

function connectWith(p: Profile) {
  if (!p.url) { setStatus('Enter the server URL', 'bad'); return }
  if (!p.token) { setStatus('Enter the token', 'bad'); return }
  setStatus(`Connecting to ${p.url}`, 'wait')
  const u = new URL(p.url)
  u.searchParams.set('token', p.token)
  sock.disconnect()
  sock.connect(u.toString())
}

// ── boot ─────────────────────────────────────────────────────────────
async function boot() {
  setStatus('Waiting for Even App bridge…', 'wait')
  try {
    bridge = await waitForEvenAppBridge()
  } catch (err) {
    setStatus('Not running inside the Even App', 'bad')
    log(String(err), 'error')
    return
  }
  bridge.onLaunchSource((src) => { launchSource = src; sock.send({ t: 'launch', source: src }) })
  bridge.onDeviceStatusChanged((status) => sock.send({ t: 'device', status }))
  bridge.onAppLocationChanged((loc) => sock.send({ t: 'location', loc }))
  bridge.onEvenHubEvent(relayEvent)

  const profile = await loadProfile()
  elUrl.value = profile.url
  elToken.value = profile.token
  if (tokenFromQuery() && profile.url) await saveProfile(profile)

  elSave.onclick = async () => {
    const p = currentProfile()
    await saveProfile(p)
    connectWith(p)
  }
  elDisconnect.onclick = () => { sock.disconnect(); setStatus('Disconnected', 'bad') }

  if (profile.url && profile.token) connectWith(profile)
  else setStatus('Enter server URL and token, then Save', 'wait')
}

void boot()
