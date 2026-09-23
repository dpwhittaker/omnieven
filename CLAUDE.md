# Omni — guidance for AI agents working in this repo

Omni is a server-side rendered dashboard for Even Realities G2 glasses. You (the agent) will
usually be asked to **add or change an app** or to **put something on the glasses**. Read
`docs/APPS.md` before writing an app; `shared/app.ts` is the exact contract.

## The one-minute model

- The glasses show whatever the server's *active app* returns from `render(ctx)`. Apps are
  files in `apps/` (git-ignored; the user's own repo). `demo/` is the starter set — never
  edit `demo/` to change what the user sees; edit or add files in `apps/`. Sub-folders of
  `apps/` (or `group: 'Name/Sub'`) become folders on the home screen; a folder with
  `index.js` is a single app with helpers.
- Other projects keep their glasses apps in their own tree: their folder's absolute path
  goes in `data/app-roots` (git-ignored, one per line) and it loads like `apps/`. All roots
  form one merged folder with the same folder/group rules; on an id clash the later line
  wins (and can so override anything, `apps/` included). Saving the file applies it.
  `GET /api/status` lists the roots. See `docs/APPS.md` → "Apps that live in other projects".
- Saving a file in `apps/` hot-reloads it (~1 s). No build, no restart. Errors render on the
  glasses and appear in `GET /api/logs`.
- Views are declarative (`string` | `{text}` | `{list}` | `{containers:[…]}`); the server diffs
  them. Text-only changes are flicker-free; layout changes rebuild the page.
- Gestures reach the app via `onEvent(ctx, ev)` — `tap`, `double`, `up`, `down`, `longpress`,
  `select` (lists). Return `true` to consume one. Double-tap goes home unless consumed (the
  user can rebind this; see `docs/CONFIG.md`).
- `ctx.state` persists (JSON), `ctx.mem` is volatile, `ctx.env` has `.env` secrets.

## Seeing what the user sees

```bash
T=$(cat data/token); A=http://localhost:7788/api          # adjust host for a remote server
curl -s -H "Authorization: Bearer $T" $A/screen             # text dump of the current page
curl -s -H "Authorization: Bearer $T" $A/status             # connections, active app, apps, last event
curl -s -H "Authorization: Bearer $T" $A/logs               # server + phone-client logs
curl -N -H "Authorization: Bearer $T" $A/events             # live SSE: gestures, renders, logs
```

`npm run fake-client -- ws://localhost:7788/ws $T` is a headless glasses: it prints every page
as it would be drawn and takes gestures on stdin (`t` tap, `d` double, `u`/`w` up/down,
`l`/`r` long-press/release, `s<N>` select list item, `m<N>` menu item). Use it to test an app
end-to-end before telling the user it works. `npm run typecheck` must pass.

**Prefer `npm run fake-client -- --sandbox`** whenever real glasses may be connected: the
fake client and the phone otherwise share one session, so every test gesture moves the
user's screen. `--sandbox` starts a private server instance (free port, own data dir and
token, the live `data/config.json` and `data/app-roots` copied in so gestures, `homeApp`
and the app folders match) and kills it when the client exits. It prints the sandbox's API URL and token on
stderr, so `curl …/api/screen` and `/api/logs` work against it too.

For anything the text dump cannot answer (glyph shapes, exact pixel geometry, whether a
page the firmware might reject renders at all), `scripts/simulator.sh` runs the client in the
Even Hub simulator headless against its own throwaway server: `GET :9898/api/screenshot/glasses`
is the real 576×288 framebuffer (RGBA, alpha > 0 = lit), `POST :9898/api/input {"action":"up"}`
drives it. `@evenrealities/pretext` (`ctx.ui.width/wrap/fit`) knows glyph *widths* only.

## Pushing to the glasses directly

```bash
curl -s -H "Authorization: Bearer $T" -X POST $A/notify -H 'content-type: application/json' -d '{"text":"build passed"}'
curl -s -H "Authorization: Bearer $T" -X POST $A/show   -H 'content-type: application/json' -d '{"text":"any view"}'
curl -s -H "Authorization: Bearer $T" -X POST $A/apps/notes/message -H 'content-type: application/json' -d '{"text":"remember this"}'
```

## Writing an app — checklist

1. One file `apps/<id>.js` (JSDoc-typed: `/** @type {import('../shared/app.ts').OmniApp} */`)
   or `apps/<id>.ts` (`satisfies OmniApp<State, Mem>`), or a folder with `index.js`.
2. `title`, `render(ctx)`. Add `refresh` for live data; `init` for fetching/timers
   (`ctx.setInterval` — auto-cleared on reload); `onEvent` for gestures; `menu` + `onMenu`
   for the contextual menu; `onMessage`/`http` to accept pushes from outside.
3. Respect the limits: 576×288 px, ≤8 text/list containers, ≤4 images (20–288 × 20–144),
   ≤1000 chars per text container, lists ≤20 × 64 chars, one capture container. Use
   `ctx.ui.fit/wrap/paginate` for text that may overflow; the capture container scrolls.
4. Keep `render()` pure and fast; do I/O in `init`/timers/handlers and call `ctx.render()`.
   Apps with options: declare a `settings` schema (the shell renders the screens and adds a
   menu item) and accept the same keys in `onMessage`; see `demo/time/clock/index.js`.
   Anything the user should do on the phone (downloads, forms, lists) goes in a `phone(ctx)`
   HTML fragment (helpers `omni.api/url/reload`); see `demo/tools/voice.ts`.
5. Test with the fake client and `GET /api/screen`; then confirm on hardware if available.

## Server changes

`server/` is TypeScript executed directly by Node ≥ 22.18 (type stripping): use `import type`
for types, `.ts` extensions in relative imports, no `enum`/parameter properties. The wire
contract (`shared/protocol.ts`) is shared with the client; changing a `CmdOp` requires
handling it in `client/src/main.ts` (the switch is exhaustive) and rebuilding the client
(`npm run build:client`). A server change needs a restart (`npm start`, or however the
user runs it); an app change does not. A client change needs the rebuild and then
`POST /api/client/reload`: the client URL carries a build tag, because the Even App's
WebView replays a cached copy on a plain reload and never re-asks the server.

## Deployment facts the user may ask about

- Phone must reach `PUBLIC_URL`; the client connects back to `<PUBLIC_URL>/ws`.
- Sideload: Developer Mode → Scan QR (the QR is `<PUBLIC_URL>/app/?token=…`).
- Permanent install: `npm run pack` → `omni.ehpk` (auto version bump; Even only reinstalls a
  higher version) → hub.evenrealities.com private builds.
- Never commit `data/`, `.env`, `client/app.json` or `apps/` to the Omni repo (all
  git-ignored); the user's server hostname and token must not end up in this repository.
