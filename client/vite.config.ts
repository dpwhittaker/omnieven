import { defineConfig } from 'vite'

// The built bundle is served by the Omni server under /app/, so every asset
// URL must be relative to that prefix.
export default defineConfig({
  base: '/app/',
  server: { host: true, port: 5173 },
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true },
})
