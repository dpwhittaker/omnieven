// Generic in-app settings screens driven by a schema. An app keeps
// `mem.ui = { screen, index }` and calls these from render/onEvent.
// Reusable: copy this file next to any app that wants list-based options.

/**
 * @typedef {{ key: string, label: string, options: { value: any, label: string }[] }} OptionSetting
 * @typedef {{ key: string, label: string, action: true }} ActionSetting
 * @typedef {OptionSetting | ActionSetting} Setting
 */

/**
 * Rows for the top-level settings list: "Label: current value".
 * @param {Setting[]} schema
 * @param {Record<string, any>} state
 */
export function settingsRows(schema, state) {
  return schema.map((s) => {
    if ('action' in s) return `${s.label} ›`
    const cur = s.options.find((o) => o.value === state[s.key])
    return `${s.label}:  ${cur ? cur.label : String(state[s.key] ?? '—')}`
  })
}

/**
 * Rows for one setting's option list, current choice marked.
 * @param {OptionSetting} setting
 * @param {Record<string, any>} state
 */
export function optionRows(setting, state) {
  return setting.options.map((o) => `${o.value === state[setting.key] ? '● ' : '○ '}${o.label}`)
}

/**
 * Handle a `select` in the settings UI. Returns 'apply' when a value was
 * written, 'action' when an action item was chosen (caller runs it), or null.
 * @param {Setting[]} schema
 * @param {Record<string, any>} state
 * @param {{ screen: string, index: number }} ui
 * @param {number} selectedIndex
 * @returns {{ result: 'apply' | 'action' | null, key?: string }}
 */
export function settingsSelect(schema, state, ui, selectedIndex) {
  if (ui.screen === 'settings') {
    const s = schema[selectedIndex]
    if (!s) return { result: null }
    if ('action' in s) return { result: 'action', key: s.key }
    ui.screen = 'option'; ui.index = selectedIndex
    return { result: null }
  }
  const s = schema[ui.index]
  if (!s || 'action' in s) { ui.screen = 'settings'; return { result: null } }
  const o = s.options[selectedIndex]
  if (o) state[s.key] = o.value
  ui.screen = 'settings'
  return { result: 'apply', key: s.key }
}
