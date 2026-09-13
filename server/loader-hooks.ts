// Module resolve hook: every file imported from inside the apps directory
// gets `?m=<mtime>` appended, so editing a helper module that an app imports
// takes effect on the next reload instead of hitting the ESM cache forever.
// The registry's own `?v=<now>` on the entry file is left untouched (it must
// change on every reload even when the entry file itself did not).
// Registered from index.ts via node:module's register().
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let appsDir = ''

export function initialize(data: { appsDir: string }): void {
  appsDir = data.appsDir.replace(/\/+$/, '') + '/'
}

type Resolve = (specifier: string, context: unknown) => Promise<{ url: string; format?: string; shortCircuit?: boolean }> | { url: string; format?: string; shortCircuit?: boolean }

export async function resolve(specifier: string, context: unknown, nextResolve: Resolve) {
  const result = await nextResolve(specifier, context)
  if (!appsDir || !result.url.startsWith('file://')) return result
  const u = new URL(result.url)
  const path = fileURLToPath(u)
  if (!path.startsWith(appsDir) || path.includes('/node_modules/')) return result
  try {
    u.searchParams.set('m', String(statSync(path).mtimeMs))
    return { ...result, url: u.toString() }
  } catch {
    return result
  }
}
