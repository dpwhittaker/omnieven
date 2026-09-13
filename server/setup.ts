// The setup page: QR for sideloading, the token, and a live status panel.
import QRCode from 'qrcode'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PUBLIC_URL, ROOT, TOKEN, VERSION, wsUrl } from './config.ts'

export async function setupPage(): Promise<string> {
  const appUrl = `${PUBLIC_URL}/app/?token=${encodeURIComponent(TOKEN)}`
  const plainUrl = `${PUBLIC_URL}/app/`
  const qr = await QRCode.toString(appUrl, { type: 'svg', margin: 1, width: 260 })
  const api = `${PUBLIC_URL}/api`
  const ehpkFile = join(ROOT, 'omni.ehpk')
  const ehpk = existsSync(ehpkFile) ? statSync(ehpkFile).size : 0
  const ehpkAt = ehpk ? statSync(ehpkFile).mtimeMs : 0
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Omni setup</title>
<style>
 body{margin:0;background:#161616;color:#e5e5e5;font:15px/1.5 -apple-system,system-ui,sans-serif}
 main{max-width:900px;margin:0 auto;padding:28px 20px;display:grid;gap:22px}
 h1{margin:0;font-size:24px} h2{font-size:16px;margin:0 0 8px;color:#9ff0c0}
 .card{background:#222;border-radius:12px;padding:18px}
 code,pre{background:#111;border-radius:6px;padding:2px 6px;font:13px ui-monospace,Menlo,monospace;color:#c8f5d8}
 pre{padding:12px;overflow:auto;white-space:pre-wrap}
 .qr{display:flex;gap:20px;align-items:center;flex-wrap:wrap}.qr svg{background:#fff;border-radius:8px;padding:6px;width:260px;height:260px}
 ol{margin:0;padding-left:20px} li{margin:4px 0}
 #status{font:13px ui-monospace,Menlo,monospace;white-space:pre-wrap;color:#bbb}
 .warn{color:#f0dc9f}
</style></head><body><main>
<h1>Omni <small style="color:#888;font-size:13px">v${VERSION}</small></h1>
<div class="card"><h2>1. Load the app on your phone (Developer Mode)</h2>
<div class="qr">${qr}<div>
<ol>
<li>Even app → <b>Even Hub</b> tab → enable <b>Developer Mode</b> (Me → Developer).</li>
<li>Tap <b>Scan QR</b> and scan this code. The URL is<br><code>${esc(plainUrl)}</code></li>
<li>The token is pre-filled through the QR; otherwise paste it: <code>${esc(TOKEN)}</code></li>
<li>Tap <b>Save &amp; connect</b>. The dashboard appears on the glasses.</li>
</ol>
<p class="warn">The page must be reachable from the phone (public HTTPS, Tailscale, or same Wi-Fi). Set <code>PUBLIC_URL</code> to whatever the phone will use.</p>
</div></div></div>
<div class="card"><h2>2. Permanent install (optional)</h2>
<p>The QR sideload above is "prototype mode". For an app that stays installed: <code>npm run pack</code> on the server bumps the version (the Even app only reinstalls a higher version), writes <code>client/app.json</code> whitelisting <code>${esc(PUBLIC_URL)}</code>, bakes the server URL into the bundle and produces <code>omni.ehpk</code>.</p>
<p>${ehpk ? `<a href="/omni.ehpk?token=${encodeURIComponent(TOKEN)}" style="color:#9ff0c0;font-weight:600">⬇ Download omni.ehpk</a> (${Math.round(ehpk / 1024)} KB, packed ${esc(new Date(ehpkAt).toLocaleString())})` : '<span class="warn">Not packed yet — run <code>npm run pack</code> on the server.</span>'}
— upload it at <a href="https://hub.evenrealities.com" style="color:#9ff0c0">hub.evenrealities.com</a> → Private builds, then install from the phone: Me → Apps → Private builds. The installed app connects to <code>${esc(wsUrl())}</code>; paste the token once in its settings form.</p></div>
<div class="card"><h2>3. Drive it</h2>
<pre>T=${esc(TOKEN)}; A=${esc(api)}
curl -s -H "Authorization: Bearer $T" $A/status
curl -s -H "Authorization: Bearer $T" -X POST $A/notify -d '{"text":"hello from curl"}' -H 'content-type: application/json'
curl -s -H "Authorization: Bearer $T" -X POST $A/show -d '{"text":"Any text.\\nRight now."}' -H 'content-type: application/json'
curl -s -H "Authorization: Bearer $T" $A/screen        # what is on the glasses
curl -N -H "Authorization: Bearer $T" $A/events        # live SSE of gestures/logs</pre>
<p>Drop a file in <code>apps/</code> and it shows up on the glasses immediately. See <code>docs/APPS.md</code>.</p></div>
<div class="card"><h2>Live status</h2><div id="status">loading…</div></div>
</main>
<script>
const T=${JSON.stringify(TOKEN)};
async function tick(){try{const r=await fetch('/api/status',{headers:{Authorization:'Bearer '+T}});const s=await r.json();
document.getElementById('status').textContent=
 'connections: '+s.connections.length+(s.connections.length?'  ('+s.connections.map(c=>(c.device&&c.device.model)||'device?').join(', ')+')':'')+
 '\\nactive app: '+(s.active||'home')+'\\napps: '+s.apps.map(t=>t.id+(t.error?' (!)':'')).join(', ')+
 '\\nlast event: '+(s.lastEvent?s.lastEvent.type+' @ '+new Date(s.lastEvent.ts).toLocaleTimeString():'-')+
 '\\nws: ${esc(wsUrl())}'}catch(e){document.getElementById('status').textContent='error '+e}}
tick();setInterval(tick,3000);
</script></body></html>`
}

export function manifest(): Record<string, unknown> {
  const origin = new URL(PUBLIC_URL)
  const https = origin.protocol === 'https:'
  const wl = [PUBLIC_URL, `${https ? 'wss' : 'ws'}://${origin.host}`]
  return {
    package_id: process.env.OMNI_PACKAGE_ID || 'com.omnieven.dashboard',
    edition: '202601',
    name: process.env.OMNI_APP_NAME || 'Omni',
    version: VERSION,
    min_app_version: '2.2.10',
    min_sdk_version: '0.0.15',
    entrypoint: 'index.html',
    permissions: [
      { name: 'network', desc: 'Connects to your own Omni server, which renders the dashboard.', whitelist: wl },
      { name: 'g2-microphone', desc: 'Voice input for apps that ask for it.' },
      { name: 'location', desc: 'Location for apps that ask for it (weather, maps).' },
    ],
    supported_languages: ['en'],
  }
}
