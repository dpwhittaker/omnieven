// The wire contract lives in shared/protocol.ts (one file for server, client
// and apps). This module only adds the client's own constants.
export type { ClientFrame, ServerFrame, Cmd, CmdOp, CmdArgs, HelloFrame } from '../../shared/protocol.ts'
export const CLIENT_VERSION = '0.2.0'
