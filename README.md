# Omni — a server-side rendered dashboard for Even Realities G2 glasses

Omni turns the glasses into a display for **your own server**. The Even Hub app that runs
on the phone is a thin renderer; every screen, every gesture handler and every data
source lives in small JavaScript "tab" modules on the server. Edit a file → the glasses
update within a second. Anything (a script, cron, an AI agent) can push to the display
through the HTTP API.

```
 ┌───────────────────────┐   wss  ┌──────────────────────┐  BLE  ┌──────────┐
 │ Omni server (yours)   │◀──────▶│ Even App WebView     │◀─────▶│ G2 + R1  │
 │  tabs/*.js  hot-reload│        │  omni client (/app/) │       │ 576×288  │
 │  HTTP API + SSE       │        └──────────────────────┘       └──────────┘
 └───────────────────────┘
```

## Quick start

```bash
git clone git@github.com:lettucegoblin/omnieven.git && cd omnieven
npm install                 # also installs client deps
npm run build:client        # builds the glasses client into client/dist
PUBLIC_URL=https://omni.example.com npm start
```

The server prints a **setup URL** (with token) and a QR code. On the phone: Even app →
Even Hub → Developer Mode → **Scan QR**. The QR is just the client URL with the token, so
the phone-side form is pre-filled; tap *Save & connect* and the home list appears on the
glasses.

`PUBLIC_URL` must be what the phone can reach: a public HTTPS host (recommended — run
behind Traefik/Caddy/nginx, or `docker compose --profile tls up -d` with `DOMAIN` set),
a Tailscale address, or a LAN `http://192.168.x.x:7788` for testing.

### Docker (droplet / VPS)

```bash
cp .env.example .env    # set PUBLIC_URL and DOMAIN
docker compose --profile tls up -d --build
docker compose logs omni | head -30      # token + QR
```

`tabs/` is bind-mounted, so editing tabs on the host still hot-reloads inside the container.

## Using it

- **Home**: native list of tabs — swipe to move, tap to open, double-tap for the system
  exit dialog.
- **In a tab**: gestures go to the tab; double-tap returns home; the glasses contextual
  menu (tap-and-hold) lists the tab's own actions, *Home*, and the other tabs.
- **Notifications**: `POST /api/notify {"text": "…"}` shows a toast over anything.

Included tabs: Clock, Stopwatch, System monitor (with a sparkline image), Hacker News,
Notes (an inbox fed by the API). See [`docs/TABS.md`](docs/TABS.md) to write your own — a
tab can be as small as:

```js
export default { title: 'Hello', render: () => 'Hello, glasses!' }
```

## HTTP API

All routes take `Authorization: Bearer <token>` (or `?token=`).

| Route | What |
|---|---|
| `GET /api/status` | connections, active tab, tabs, last event |
| `GET /api/screen` | text dump + container layout of what is on the glasses right now |
| `GET /api/events` | SSE stream: gestures, renders, navigation, logs, location |
| `GET /api/logs` | recent server log |
| `POST /api/notify` `{text, title?, ms?}` | toast |
| `POST /api/show` `{view}` | show an ad-hoc view (any `render()` return value) until the user goes home |
| `POST /api/home`, `POST /api/exit`, `POST /api/render` | navigation |
| `GET /api/tabs`, `POST /api/tabs/:id/open`, `POST /api/tabs/:id/reload` | tabs |
| `POST /api/tabs/:id/message` `{…}` | delivered to the tab's `onMessage`, returns its result |
| `GET/PUT /api/tabs/:id/state` | read / merge a tab's persisted state |
| `POST /api/audio {on}`, `/api/imu {on,pace}`, `/api/location {once}` | device features |
| `POST /api/cmd {op,args}` | raw client command (escape hatch) |
| `POST /api/reload`, `POST /api/client/reload` | reload all tabs / reload the WebView |

## Layout

```
server/   index.js (http+ws)  shell.js (home/tabs/menu/toasts)  tabs.js (loader, hot reload)
          renderer.js (view → containers, diffing)  connection.js (per-client cmd queue)
          ui.js (text metrics helpers)  png.js (Canvas + PNG encoder)  api.js  setup.js
client/   Vite + TS Even Hub app (thin renderer + phone settings form), served at /app/
tabs/     your dashboard (hot-reloaded)
scripts/  fake-client.mjs (headless glasses for testing)  dev-server.sh
docs/     TABS.md (tab API)  PROTOCOL.md (wire format)
```

## Permanent install (private build)

The QR sideload ("prototype mode") only lives while the Even app keeps the dev session; for
an app that stays installed:

```bash
PUBLIC_URL=https://omni.example.com npm run pack     # → omni.ehpk
```

`pack` does four things: bumps the patch version in `package.json` (the Even app refuses to
reinstall a build unless its version is higher than the installed one — `--no-bump` to skip),
writes `client/app.json` with the network whitelist set to your `PUBLIC_URL`, rebuilds the
client with that server's WebSocket URL baked in as the default, and packs `client/dist`.

Then either download it from the setup page (**⬇ Download omni.ehpk**, or
`GET /omni.ehpk?token=…`) or copy it off the box, upload it at hub.evenrealities.com →
*Private builds*, and install on the phone from **Me → Apps → Private builds**. On first
launch paste the token into the app's form and tap *Save & connect*; the URL and token are
kept in the Even app's storage, so later launches connect on their own.

Bundle notes (learned the hard way): the client is built with relative, flattened asset
paths and no `crossorigin` attribute — absolute `/app/assets/…` URLs load fine in a browser
but never execute from an installed package, leaving the phone page stuck on "Starting…".

## Notes on the platform

- Canvas 576×288, 4-bit green. ≤12 containers (≤8 text/list, ≤4 image), one input-capturing
  container, one font, 27 px lines, ~450 chars per full screen.
- Text-only changes are applied in place (no flicker); layout changes rebuild the page.
- Android may suspend the WebView in the background; the client reconnects and the server
  re-sends the current page, so state is never lost (it lives on the server).
- Connection profile (`omni.url`, `omni.token`) is stored through the Even App storage
  bridge as plain strings; the client verifies the write by reading it back and logs
  `profile saved` in the phone-side log.
- Dev sideload and the installed app are separate app identities with separate storage:
  each needs the token entered once.
