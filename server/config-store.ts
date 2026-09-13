// Persisted shell configuration (data/config.json) with defaults merged in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type Action, type GestureBindings, type OmniConfig } from '../shared/config.ts'
import { DATA_DIR } from './config.ts'
import { log } from './log.ts'

const FILE = join(DATA_DIR, 'config.json')

function cleanBindings(b: unknown): GestureBindings {
  const out: GestureBindings = {}
  if (!b || typeof b !== 'object') return out
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (typeof v === 'string' && /^[a-z]+(>[a-z]+)*$/.test(k)) out[k] = v
  }
  return out
}

export function loadConfig(): OmniConfig {
  let saved: Partial<OmniConfig> = {}
  if (existsSync(FILE)) {
    try { saved = JSON.parse(readFileSync(FILE, 'utf8')) } catch (err) { log('warn', `config.json unreadable: ${(err as Error).message}`) }
  }
  const g = saved.gestures || ({} as Partial<OmniConfig['gestures']>)
  return {
    gestures: {
      root: { ...DEFAULT_CONFIG.gestures.root, ...cleanBindings(g.root) },
      global: { ...DEFAULT_CONFIG.gestures.global, ...cleanBindings(g.global) },
      app: { ...DEFAULT_CONFIG.gestures.app, ...cleanBindings(g.app) },
    },
  }
}

export function saveConfig(cfg: OmniConfig): void {
  writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n')
}

/** Merge a partial update (from the API or Settings) into the current config. */
export function mergeConfig(cfg: OmniConfig, patch: Partial<OmniConfig>): OmniConfig {
  const g: Partial<OmniConfig['gestures']> = patch.gestures || {}
  return {
    gestures: {
      root: { ...cfg.gestures.root, ...cleanBindings(g.root) },
      global: { ...cfg.gestures.global, ...cleanBindings(g.global) },
      app: { ...cfg.gestures.app, ...cleanBindings(g.app) },
    },
  }
}

export function isKnownAction(a: Action): boolean {
  return /^(home|exit|quit|blank|config|next-app|prev-app|none|open:[\w.-]+|notify:.*)$/.test(a)
}
