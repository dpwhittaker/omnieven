// What an app's render() returns. The server's renderer compiles this into
// Even Hub containers, enforcing the firmware limits.

export interface Border { width?: number; color?: number; radius?: number }

interface ContainerBase {
  /** unique per view, ≤16 chars; auto-generated when omitted */
  name?: string
  x?: number; y?: number; w?: number; h?: number
  /** exactly one container per view receives input; auto-picked when omitted */
  capture?: boolean
}
export interface TextContainer extends ContainerBase {
  type?: 'text'
  text?: string
  /** brightness 0..4 (4 = default) */
  textColor?: number
  padding?: number
  border?: Border
}
export interface ListContainer extends ContainerBase {
  type: 'list'
  /** ≤20 items, ≤64 chars each */
  items: (string | { label: string })[]
  itemWidth?: number
  selectBorder?: boolean
  padding?: number
  border?: Border
}
export interface ImageContainer {
  type: 'image'
  name?: string
  x?: number; y?: number
  /** 20..288 */ w?: number
  /** 20..144 */ h?: number
  /** PNG/JPEG bytes (Buffer), base64 string, or a Canvas (server-side) */
  png?: Uint8Array | string | { toPng(): Uint8Array }
}
export type Container = TextContainer | ListContainer | ImageContainer

/**
 * An app's own contextual-menu entries; string ids are echoed to
 * onMenu/onEvent. (Numeric ids are assigned by the shell when composing the
 * final menu and are not for apps to use.)
 */
export type MenuItem = string | { id: string | number; label?: string }

export interface ExplicitView { containers: Container[]; menu?: MenuItem[] }
export interface TextView extends Omit<TextContainer, 'type'> { text: string; menu?: MenuItem[] }
export interface ListView extends Omit<ListContainer, 'type' | 'items'> { list: (string | { label: string })[]; menu?: MenuItem[] }

/** Anything render() may return. */
export type View = string | number | Container[] | ExplicitView | TextView | ListView | null | undefined
