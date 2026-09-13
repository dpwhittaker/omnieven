import { defineConfig } from 'vite'

// The bundle must run from two places: served by the Omni server under /app/
// (QR sideload) and unpacked from an .ehpk on the phone (installed app). Only
// relative asset paths work for both, and `evenhub pack` mishandles asset
// subdirectories, so everything is flattened into the dist root.
// `crossorigin` on the module script makes WKWebView refuse it from local
// files, so it is stripped from the generated HTML.
export default defineConfig({
  base: './',
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true, assetsDir: '' },
  plugins: [{
    name: 'strip-crossorigin',
    transformIndexHtml: (html) => html.replace(/ crossorigin(="[^"]*")?/g, ''),
  }],
})
