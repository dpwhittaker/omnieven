# Wire protocol (server ⇄ glasses client)

Defined once in [`shared/protocol.ts`](../shared/protocol.ts); the server (`server/`), the
glasses client (`client/`) and apps all import it, and `npm run typecheck` fails if either side
drifts (the client's command switch is exhaustive over `CmdOp`).

WebSocket at `/ws?token=…`. JSON text frames; binary frames are raw PCM audio (16 kHz,
s16le, mono) from the client while the mic is on.

## Client → server
| frame | when |
|---|---|
| `{t:'hello', token, client:{version,sdk}, device, user, launchSource, pageCreated}` | on connect; the server answers by rendering the current view |
| `{t:'event', ev}` | every `onEvenHubEvent` envelope (list/text/sys/menu); normalised server-side |
| `{t:'device', status}` / `{t:'location', loc}` / `{t:'launch', source}` | bridge callbacks |
| `{t:'result', id, ok, value?, error?}` | reply to a command |
| `{t:'log', level, msg}` | client console relay |
| `{t:'api', id, method, path, body?}` | HTTP API call tunnelled over the socket (`path` relative to `/api`); answered with `{t:'api', id, status, body}`. The installed bundle runs from a non-http origin in the Even App's WebView where cross-origin `fetch()` fails, so the phone companion uses this. |

## Server → client (`{t:'cmd', id, op, args}`)
| op | effect |
|---|---|
| `page` | `createStartUpPageContainer` on first use, then `rebuildPageContainer` |
| `text` | `textContainerUpgrade` (in-place, flicker-free) |
| `image` | `updateImageRawData` with base64 PNG/JPEG bytes |
| `audio {on, source}` / `imu {on, pace}` / `location {once|on,…}` | device features |
| `storage.get {key}` / `storage.set {key, value}` | Even App localStorage (the client keeps its own profile under `omni.url` / `omni.token`) |
| `shutdown {mode}` | `shutDownPageContainer` (1 = system dialog, 0 = immediate) |
| `reload {url?}` | reload the WebView — at `url` when given (the server passes the client URL with its build tag; a plain reload replays the WebView's cache) |
| `call {method, params?}` | `bridge.callEvenApp` — any Even App method by name; `POST /api/cmd {"op":"call","args":{"method":"getGlassesInfo"}}` |

Commands run strictly one at a time on the client (the SDK shares one BLE link) with an
8 s timeout each. The server serialises per connection and coalesces renders, keeping only
the newest requested view. Several clients (glasses + simulator) can be connected at once;
each gets its own diff state.
