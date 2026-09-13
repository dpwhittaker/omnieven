// The smallest possible app. Delete this file and it disappears from the
// glasses; edit it and the change shows up within a second.

/** @type {import('../../shared/app.ts').OmniApp} */
export default {
  title: 'Hello',
  order: 0,
  render: () => 'Hello, glasses!\n\nEdit apps/examples/hello.js and save.\nDouble-tap to go home.',
}
