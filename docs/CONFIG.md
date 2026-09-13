# Gestures & settings

The dashboard's own gestures are configurable — on the glasses (**Settings**, from the home
contextual menu or the global gesture) or via the API. Config lives in `data/config.json`;
types in [`shared/config.ts`](../shared/config.ts).

```json
{
  "gestures": {
    "root":   { "double": "exit", "longpress": "blank" },
    "global": { "tap>longpress": "config" },
    "app":    { "double": "home" }
  }
}
```

| Scope | Applies |
|---|---|
| `root` | the home list, the blank (display-off) screen, and views pushed with `POST /api/show` |
| `global` | everywhere, checked before the current screen (not inside Settings) |
| `app` | inside apps, only for gestures the app did not consume (`onEvent` returned `true`) |

**Gesture keys**: `tap`, `double`, `longpress`, `up`, `down`, or a sequence like
`tap>longpress` / `double>longpress` / `up>down` performed within 1.5 s. On the home list a
tap is a list selection but still counts as `tap` in sequences. The longest matching
sequence wins.

**Actions**: `home`, `exit` (system dialog), `quit` (immediate), `blank` (display off until
the next gesture), `config` (Settings), `open:<appId>`, `next-app`, `prev-app`,
`notify:<text>`, `none` (mask a default).

```bash
curl -H "Authorization: Bearer $T" $A/config
curl -H "Authorization: Bearer $T" -X PUT $A/config -H 'content-type: application/json' \
     -d '{"gestures":{"root":{"double":"open:miniclock"}}}'   # merge; "none" removes a default
curl -H "Authorization: Bearer $T" -X POST $A/action -d '{"action":"blank"}' -H 'content-type: application/json'
curl -H "Authorization: Bearer $T" -X POST $A/settings                       # open Settings on the glasses
```
