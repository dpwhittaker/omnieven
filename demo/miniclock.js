// Mini clock — just the time in the top-right corner, nothing else lit.
// A good target for a root gesture: PUT /api/config
//   {"gestures":{"root":{"double":"open:miniclock"}}}
// or bind it on the glasses via Settings.

/** @type {import('../shared/app.ts').OmniApp} */
export default {
  title: 'Mini clock',
  order: 7,
  refresh: 1000,
  render: () => ({
    containers: [
      { type: 'text', name: 'time', x: 456, y: 0, w: 120, h: 34, padding: 4, textColor: 2,
        text: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    ],
  }),
}
