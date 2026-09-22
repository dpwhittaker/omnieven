# Gestures & settings

The dashboard's own gestures are configurable — on the glasses (**Settings**, from the home
contextual menu or the global gesture) or via the API. Config lives in `data/config.json`;
types in [`shared/config.ts`](../shared/config.ts).

```json
{
  "menu": { "apps": "none", "pinned": [], "settings": false },
  "input": { "repeatMs": 150, "waitForRender": true, "maxWaitMs": 2000 },
  "homeApp": "",
  "gestures": {
    "root":   { "double": "exit", "longpress": "blank" },
    "global": { "tap>longpress": "config" },
    "app":    { "double": "home" }
  }
}
```

**`menu`** controls the tap-and-hold contextual menu inside apps: `apps` = which other apps
to list (`none` — just the app's items and Home; `folder` — apps in the same folder;
`all` — everything, up to the 10-item limit), `pinned` = app ids always listed, `settings` =
also show the global Settings item. Changeable on the glasses (Settings → last two rows).

**`input`** debounces gestures so a slow round trip doesn't turn one intent into several: a
gesture that repeats the previous one (same type; same row for list picks) is dropped when it
arrives within `repeatMs`, or — with `waitForRender` — while the screen update the previous
one caused is still being drawn on the glasses (a page rebuild over BLE can take a moment),
never for longer than `maxWaitMs`. A *different* gesture always goes through. Dropped
events appear on `GET /api/events` with `dropped: true` and in the log.

**`homeApp`** names an app that stands in for the home list — the *launcher* pattern (an app
that lists the others with `ctx.apps()` and opens them with `ctx.open(id)`). When set, leaving
an app (the `home` action, `ctx.home()`, the Home menu item, `POST /api/home`) opens that app
instead of the list, and it is on screen at startup. The classic list stays one step away:
the home app's own `ctx.home()` opens it, and navigating within the list (back rows, *Top
level*) is unaffected. Inside the home app, gestures it does not consume follow the `root`
bindings (it *is* the home screen), not the in-app defaults. `""` (the default) is the
built-in list.

```bash
curl -s -H "Authorization: Bearer $T" -X PUT $A/config -H 'content-type: application/json' -d '{"homeApp":"launcher"}'
```

| Scope | Applies |
|---|---|
| `root` | the home list (or the `homeApp` standing in for it), the blank (display-off) screen, and views pushed with `POST /api/show` |
| `global` | everywhere, checked before the current screen (not inside Settings) |
| `app` | inside apps, only for gestures the app did not consume (`onEvent` returned `true`) |

**Gesture keys**: `tap`, `double`, `longpress`, `up`, `down`, or a sequence like
`tap>longpress` / `double>longpress` / `up>down` performed within 1.5 s. On the home list a
tap is a list selection but still counts as `tap` in sequences. The longest matching
sequence wins.

**The Even Hub standard** (what the store reviews for) is the default: on the root screens a
**double-tap opens the system exit dialog** (`exit`). Everything is still yours to rebind —
Settings has a *Reset gestures to the standard* row to go back. Before a server is connected
(no server set up, still on the start screen) the phone app handles the double-tap itself, so
the app can always be left.

**Actions**: `home`, `exit` (system dialog), `quit` (immediate; not accepted by the store as
the root double-tap), `blank` (display off until
the next gesture), `config` (Settings), `open:<appId>`, `next-app`, `prev-app`,
`notify:<text>`, `none` (mask a default).

```bash
curl -H "Authorization: Bearer $T" $A/config
curl -H "Authorization: Bearer $T" -X PUT $A/config -H 'content-type: application/json' \
     -d '{"gestures":{"root":{"double":"open:clock"}}}'   # merge; "none" removes a default
curl -H "Authorization: Bearer $T" -X POST $A/action -d '{"action":"blank"}' -H 'content-type: application/json'
curl -H "Authorization: Bearer $T" -X POST $A/settings                       # open Settings on the glasses
```
