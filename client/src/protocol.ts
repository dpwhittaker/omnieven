// Wire contract between the Omni server and this glasses client.
// Mirror of server/protocol.js — keep the two in sync.

/** Client -> server */
export type ClientFrame =
  | { t: 'hello'; token: string; client: { version: string; sdk: string }; device: unknown; user: unknown; launchSource: string | null; pageCreated: boolean }
  | { t: 'event'; ev: unknown }
  | { t: 'device'; status: unknown }
  | { t: 'location'; loc: unknown }
  | { t: 'launch'; source: string }
  | { t: 'result'; id: number; ok: boolean; value?: unknown; error?: string }
  | { t: 'log'; level: 'info' | 'warn' | 'error'; msg: string }
  | { t: 'pong' }

/** Server -> client */
export type ServerFrame =
  | { t: 'cmd'; id: number; op: CmdOp; args: any }
  | { t: 'ping' }
  | { t: 'welcome'; serverVersion: string }
  | { t: 'error'; msg: string }

export type CmdOp =
  | 'page'        // create (first time) or rebuild the page: args = {containerTotalNum, textObject, listObject, imageObject, menuObject}
  | 'text'        // in-place text update: args = {containerID, containerName, content, textColor?}
  | 'image'       // args = {containerID, containerName, png: base64}
  | 'audio'       // args = {on: boolean, source?: 'glasses'|'phone'}
  | 'imu'         // args = {on: boolean, pace?: number}
  | 'location'    // args = {on: boolean, intervalMs?, accuracy?} | {once: true}
  | 'storage.get' // args = {key}
  | 'storage.set' // args = {key, value}
  | 'shutdown'    // args = {mode: 0|1}
  | 'reload'      // reload the webview page (after client rebuild)

export const CLIENT_VERSION = '0.1.0'
