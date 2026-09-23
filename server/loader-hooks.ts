// Module resolve hook: every file an app imports gets `?m=<mtime>` appended, so
// editing a helper module takes effect on the next reload instead of hitting
// the ESM cache forever. "Imported by an app" is read off the importer: the
// registry loads each entry as `<file>?v=<now>`, this hook tags what that file
// imports with `?m=…`, and so on down the graph. No list of app folders is
// needed, so it covers every root, including ones registered while the server
// runs. Left alone: node_modules (dependencies, not the user's code) and Omni's
// own server/ and shared/ (`keep`), which must stay single instances.
// Registered from index.ts via node:module's register().
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let keep: string[] = []

export function initialize(data: { keep?: string[] }): void {
  keep = (data.keep || []).map((d) => d.replace(/\/+$/, '') + '/')
}

type Resolve = (specifier: string, context: unknown) => Promise<{ url: string; format?: string; shortCircuit?: boolean }> | { url: string; format?: string; shortCircuit?: boolean }

/** Is the importer part of an app's module graph (entry `?v=` or helper `?m=`)? */
function fromApp(parentURL: string | undefined): boolean {
  if (!parentURL || !parentURL.startsWith('file://')) return false
  const q = new URL(parentURL).searchParams
  return q.has('v') || q.has('m')
}

export async function resolve(specifier: string, context: { parentURL?: string }, nextResolve: Resolve) {
  const result = await nextResolve(specifier, context)
  if (!fromApp(context.parentURL) || !result.url.startsWith('file://')) return result
  const u = new URL(result.url)
  const path = fileURLToPath(u)
  if (path.includes('/node_modules/') || keep.some((d) => path.startsWith(d))) return result
  try {
    u.searchParams.set('m', String(statSync(path).mtimeMs))
    return { ...result, url: u.toString() }
  } catch {
    return result
  }
}
