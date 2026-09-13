// Shell configuration: which gesture does what on the dashboard's own
// screens. Persisted in data/config.json, editable on the glasses (Settings)
// or through GET/PUT /api/config.

/**
 * A gesture key is a single gesture or a `>`-separated sequence performed
 * within GESTURE_WINDOW_MS of each other, e.g. 'double', 'tap>longpress'.
 * `tap` also matches a list selection (`select`) so sequences work on the
 * home list. 'release' never takes part in sequences.
 */
export type Gesture = 'tap' | 'double' | 'longpress' | 'up' | 'down'
export type GestureKey = string

/**
 * Actions:
 *   home          back to the home list
 *   exit          system exit dialog
 *   quit          leave immediately, no dialog
 *   blank         display off (blank screen) until the next gesture
 *   config        open the on-glasses Settings screen
 *   open:<id>     switch to an app
 *   next-app / prev-app   cycle through the home list
 *   notify:<text> flash a toast
 *   none          explicitly do nothing (masks a default)
 */
export type Action = string

export interface GestureBindings { [gesture: GestureKey]: Action }

export interface OmniConfig {
  gestures: {
    /** home list, blank screen and API-pushed views — not inside apps */
    root: GestureBindings
    /** everywhere, checked before the current screen sees the gesture */
    global: GestureBindings
    /** inside apps, only when the app did not consume the gesture (onEvent returned true) */
    app: GestureBindings
  }
}

export const GESTURE_WINDOW_MS = 1500

export const DEFAULT_CONFIG: OmniConfig = {
  gestures: {
    root: { double: 'exit', longpress: 'blank' },
    global: { 'tap>longpress': 'config' },
    app: { double: 'home' },
  },
}

/** Gesture keys offered by the Settings screen (any string works via the API). */
export const GESTURE_CHOICES: GestureKey[] = [
  'tap', 'double', 'longpress', 'up', 'down',
  'tap>longpress', 'double>longpress', 'longpress>tap', 'up>down', 'down>up', 'tap>tap>tap',
]
export const ACTION_CHOICES: { id: Action; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'exit', label: 'Exit (dialog)' },
  { id: 'quit', label: 'Quit immediately' },
  { id: 'blank', label: 'Display off' },
  { id: 'config', label: 'Settings' },
  { id: 'open:', label: 'Open app…' },
  { id: 'next-app', label: 'Next app' },
  { id: 'prev-app', label: 'Previous app' },
  { id: 'none', label: 'Nothing / unbind' },
]
