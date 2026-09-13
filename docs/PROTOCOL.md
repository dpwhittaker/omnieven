# Wire protocol (server ⇄ glasses client)

WebSocket at `/ws?token=…`. JSON text frames; binary frames are raw PCM audio
(16 kHz, s16le, mono) from the client while the mic is on.

## Client → server
| frame | when |
|---|---|
| `{t:'hello', token, client:{version,sdk}, device, user, launchSource, pageCreated}` | on connect; server replies by rendering the current view |
| `{t:'event', ev}` | every `onEvenHubEvent` envelope (list/text/sys/menu). Server normalises it. |
| `{t:'device', status}` | `onDeviceStatusChanged` |
| `{t:'location', loc}` | `onAppLocationChanged` |
| `{t:'launch', source}` | `onLaunchSource` |
| `{t:'result', id, ok, value?, error?}` | reply to a command |
| `{t:'log', level, msg}` | client console relay |

## Server → client
| frame | effect |
|---|---|
| `{t:'cmd', id, op:'page', args}` | `createStartUpPageContainer` on first use, else `rebuildPageContainer` |
| `{t:'cmd', id, op:'text', args}` | `textContainerUpgrade` |
| `{t:'cmd', id, op:'image', args:{containerID, containerName, png}}` | `updateImageRawData` (PNG bytes, base64) |
| `op:'audio' {on, source}` / `op:'imu' {on, pace}` / `op:'location' {once|on,…}` | device features |
| `op:'storage.get' {key}` / `op:'storage.set' {key,value}` | Even App localStorage |
| `op:'shutdown' {mode}` | `shutDownPageContainer` (1 = system dialog) |
| `op:'reload'` | reload the WebView |
| `{t:'ping'}` | keepalive |

Commands are executed strictly one at a time on the client (the SDK shares one BLE
link) and each is wrapped in an 8 s timeout. The server likewise serialises per
connection and coalesces renders, keeping only the newest requested view.
