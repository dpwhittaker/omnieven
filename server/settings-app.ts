// Built-in Settings screen: rebind shell gestures from the glasses.
// List-driven: tap selects, double-tap goes back one level, double-tap at
// the top level closes Settings. Registered by the shell as a hidden app.
import type { OmniApp } from '../shared/app.ts'
import { ACTION_CHOICES, GESTURE_CHOICES, type Action, type OmniConfig } from '../shared/config.ts'

type Scope = keyof OmniConfig['gestures']
const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: 'root', label: 'Home screen gestures', hint: 'on the home list / blank screen' },
  { id: 'global', label: 'Global gestures', hint: 'everywhere, before apps' },
  { id: 'app', label: 'In-app defaults', hint: 'when an app ignores the gesture' },
]

/** What the shell hands the settings app. */
export interface SettingsHost {
  config(): OmniConfig
  setBinding(scope: Scope, gesture: string, action: Action | null): void
  setMenu(patch: Partial<OmniConfig['menu']>): void
  apps(): { id: string; title: string; group: string }[]
  close(): void
}

interface Mem { level: 'scopes' | 'bindings' | 'gesture' | 'action' | 'app' | 'menu-apps'; scope: Scope; gesture: string }

const MENU_APPS: { value: OmniConfig['menu']['apps']; label: string }[] = [
  { value: 'none', label: 'none (just the app\'s own items + Home)' },
  { value: 'folder', label: 'apps in the same folder' },
  { value: 'all', label: 'all apps (up to the 10-item limit)' },
]

export function makeSettingsApp(host: SettingsHost): OmniApp<{}, Mem> {
  const back = (m: Mem): boolean => {
    if (m.level === 'scopes') { host.close(); return true }
    m.level = m.level === 'app' ? 'action' : m.level === 'action' || m.level === 'gesture' ? 'bindings' : 'scopes'
    return true
  }
  return {
    title: 'Settings',
    hidden: true,
    init(ctx) { ctx.mem.level = 'scopes'; ctx.mem.scope = 'root'; ctx.mem.gesture = '' },
    onOpen(ctx) { ctx.mem.level = 'scopes' },

    render(ctx) {
      const m = ctx.mem
      const cfg = host.config()
      const header = (t: string) => ({ type: 'text' as const, name: 'header', x: 0, y: 0, w: 576, h: 36, padding: 4, textColor: 2, text: t })
      const list = (items: string[]) => ({ type: 'list' as const, name: 'list', x: 0, y: 36, w: 576, h: 252, items, capture: true })
      switch (m.level) {
        case 'scopes':
          return { containers: [header('Settings  ·  tap: open  ·  double-tap: close'), list([
            ...SCOPES.map((s) => `${s.label}  (${s.hint})`),
            `Menu shows other apps:  ${MENU_APPS.find((o) => o.value === cfg.menu.apps)?.label.split(' (')[0]}`,
            `Menu shows Settings item:  ${cfg.menu.settings ? 'yes' : 'no'}`,
          ])] }
        case 'menu-apps':
          return { containers: [header('Which other apps appear in an app\'s tap-and-hold menu?'), list(MENU_APPS.map((o) => `${o.value === cfg.menu.apps ? '● ' : '○ '}${o.label}`))] }
        case 'bindings': {
          const b = cfg.gestures[m.scope]
          const rows = Object.entries(b).map(([g, a]) => `${g}  →  ${a}`)
          return { containers: [header(`${SCOPES.find((s) => s.id === m.scope)?.label}  ·  double-tap: back`), list([...rows, '+ add a gesture'])] }
        }
        case 'gesture':
          return { containers: [header('Which gesture?  (sequences within 1.5 s)'), list(GESTURE_CHOICES)] }
        case 'action':
          return { containers: [header(`${m.scope}: "${m.gesture}" does…`), list(ACTION_CHOICES.map((a) => a.label))] }
        case 'app':
          return { containers: [header(`"${m.gesture}" opens which app?`), list(host.apps().map((a) => (a.group ? `${a.group} / ` : '') + a.title))] }
      }
    },

    onEvent(ctx, ev) {
      const m = ctx.mem
      if (ev.type === 'double') return back(m)
      if (ev.type !== 'select') return
      const cfg = host.config()
      switch (m.level) {
        case 'scopes':
          if (ev.index < SCOPES.length) { m.scope = SCOPES[ev.index].id; m.level = 'bindings' }
          else if (ev.index === SCOPES.length) m.level = 'menu-apps'
          else host.setMenu({ settings: !cfg.menu.settings })
          break
        case 'menu-apps': {
          const o = MENU_APPS[ev.index]
          if (o) host.setMenu({ apps: o.value })
          m.level = 'scopes'
          break
        }
        case 'bindings': {
          const keys = Object.keys(cfg.gestures[m.scope])
          if (ev.index < keys.length) { m.gesture = keys[ev.index]; m.level = 'action' }
          else m.level = 'gesture'
          break
        }
        case 'gesture':
          m.gesture = GESTURE_CHOICES[ev.index] ?? 'double'; m.level = 'action'; break
        case 'action': {
          const a = ACTION_CHOICES[ev.index]
          if (!a) break
          if (a.id === 'open:') { m.level = 'app'; break }
          host.setBinding(m.scope, m.gesture, a.id === 'none' ? null : a.id)
          m.level = 'bindings'
          break
        }
        case 'app': {
          const app = host.apps()[ev.index]
          if (app) host.setBinding(m.scope, m.gesture, `open:${app.id}`)
          m.level = 'bindings'
          break
        }
      }
      ctx.render()
    },
  }
}
