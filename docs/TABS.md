# Writing tabs

A tab is one JavaScript module in `tabs/`. The server watches that folder: save a
file and the glasses update within a second; delete it and it disappears. Errors
(syntax, init, render) are shown on the glasses instead of crashing anything.

```js
// tabs/weather.js
export default {
  title: 'Weather',        // list/menu label (≤32 chars)
  order: 10,               // sort key on the home list (lower first)
  refresh: 60_000,         // optional: re-render every N ms while this tab is on screen
  menu: [                  // optional: extra items in the glasses contextual menu
    { id: 'units', label: 'Toggle °C/°F' },
  ],

  async init(ctx) {        // once per (re)load. ctx.state/ctx.mem survive reloads.
    ctx.state.units ??= 'C'
    ctx.setInterval(() => this.fetch(ctx), 10 * 60_000)   // auto-cleared on reload
    await this.fetch(ctx)
  },

  async fetch(ctx) {
    const r = await ctx.fetch('https://api.example.com/wx')
    ctx.mem.wx = await r.json()
    ctx.render()           // ask the shell to re-render if this tab is active
  },

  render(ctx) {            // return a view (see below)
    if (!ctx.mem.wx) return 'Loading…'
    return `${ctx.mem.wx.temp}°${ctx.state.units}\n${ctx.mem.wx.summary}`
  },

  onEvent(ctx, ev) {       // gestures: tap, double, up, down, longpress, release, select (lists)
    if (ev.type === 'tap') this.fetch(ctx)
    // return true from a 'double' handler to keep the user in the tab
    // (default: double-tap goes back to the home list)
  },
  onMenu(ctx, id) {        // contextual-menu item chosen (id from `menu` above or from view.menu)
    if (id === 'units') { ctx.state.units = ctx.state.units === 'C' ? 'F' : 'C'; ctx.render() }
  },
  onMessage(ctx, msg) {    // POST /api/tabs/weather/message {…} — return value goes back as JSON
    if (msg.city) { ctx.state.city = msg.city; this.fetch(ctx) }
    return { city: ctx.state.city }
  },
  onOpen(ctx) {}, onClose(ctx) {},     // tab became / stopped being the active tab
  onAudio(ctx, pcm) {},                // Buffer of 16 kHz s16le mono PCM, after ctx.audio(true)
  onImu(ctx, {x, y, z}) {},            // after ctx.imu(true, 500)
  onLocation(ctx, loc) {},             // after ctx.location({ once: false, intervalMs: 1000 })
  unload(ctx) {},                      // before a hot reload replaces this module
}
```

Hooks are called with `this` = the module, so helper methods on the object work.

## Views

`render(ctx)` may return any of:

| Return | Meaning |
|---|---|
| `'text'` | one full-screen text container |
| `{ text, textColor?, border?, padding? }` | same, with options |
| `{ list: ['a','b'], … }` | one full-screen native list (tap → `select` event with `index`) |
| `{ containers: [...], menu?: [...] }` | explicit layout |
| `[ ...containers ]` | explicit layout, no menu override |

Container objects (`x, y, w, h` in px on the 576×288 canvas, origin top-left):

```js
{ type: 'text',  name: 'body', x: 0, y: 0, w: 576, h: 288, text: '…',
  capture: true,          // exactly one container per view receives input (auto-picked if omitted)
  textColor: 0..4,        // brightness (4 = default/brightest)
  padding: 0..32, border: { width: 0..5, color: 0..15, radius: 0..10 } }

{ type: 'list',  name: 'items', x, y, w, h, items: ['one', 'two'], capture: true }   // ≤20 items, ≤64 chars each

{ type: 'image', name: 'graph', x, y, w: 20..288, h: 20..144, png: Buffer | base64 | ctx.Canvas }
```

Hard limits (firmware): 12 containers, of which ≤8 text/list and ≤4 image; text ≤1000
chars on a layout change (≤2000 on an in-place update). The renderer clamps and truncates.
The firmware wraps text at the container width and scrolls overflowing text in the capture
container; `\n` is a line break. One font, no size control, left-aligned, 27 px per line.
Only the text content changing → flicker-free in-place update. Anything else (geometry,
list items, menu) → full page rebuild (brief flicker).

Helpers on `ctx.ui`:

- `rows([t1, t2, t3], { capture: 0 })` – equal-height stacked text containers
- `headerBody(header, body)` – dim one-line header + scrolling body
- `wrap(text, widthPx)`, `paginate(text)`, `fit(text, widthPx)`, `measure(text, widthPx)` – firmware-accurate metrics (via `@evenrealities/pretext`)
- `bar(fraction, cells)` – `━━━───` progress bar; `spread(left, right)` – two-column line
- `clock(date)`; `LINE` (27) ; `linesFor(heightPx)`

`ctx.Canvas(w, h)` – greyscale surface for image containers: `rect, frame, line, circle, text (tiny 3×5 font), sparkline, toPng()`.

## Context (`ctx`)

| Member | Purpose |
|---|---|
| `ctx.state` | JSON object persisted to `data/state/<tab>.json` (debounced on `render()`/`save()`) |
| `ctx.mem` | volatile object, survives hot reloads but not restarts |
| `ctx.render()` | re-render if this tab is active |
| `ctx.notify(text, { title?, ms? })` | full-screen toast over whatever is showing; tap to dismiss |
| `ctx.open(id)` / `ctx.home()` / `ctx.exit()` | navigation; `exit` shows the system exit dialog |
| `ctx.setInterval / setTimeout / clear` | timers cleared automatically on reload |
| `ctx.audio(on, 'glasses'|'phone')`, `ctx.imu(on, pace)`, `ctx.location(opts)` | device features → `onAudio` / `onImu` / `onLocation` |
| `ctx.storage.get/set(key, value)` | phone-side key/value store (Even App localStorage) |
| `ctx.device` | last known device info incl. `status.batteryLevel` |
| `ctx.connected` | is any glasses client connected |
| `ctx.fetch` | global `fetch` |
| `ctx.log(...)` | server log (visible via `GET /api/logs` and the SSE stream) |

## Events (`onEvent`)

`ev.type` is one of `tap`, `double`, `up`, `down`, `longpress`, `release`, `select`
(`ev.index`, `ev.name` for lists), `menu` (`ev.id`, when no `onMenu`), `enter`, `exit`.
`ev.source` is `glasses-right`, `glasses-left` or `ring` when the firmware reports it.

Reserved by the shell: double-tap = back to home (unless your handler returns `true`);
the contextual menu always contains **Home** and the other tabs after your items.

## Testing without hardware

```bash
node scripts/fake-client.mjs            # prints what would be drawn; type t/d/u/w/s<N>/m<N> + Enter
curl -H "Authorization: Bearer $TOKEN" localhost:7788/api/screen   # text dump of the current page
```

Or point the official simulator at the client: `npx evenhub-simulator http://localhost:7788/app/`
(paste the token in the phone-side form).
