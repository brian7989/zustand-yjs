/** Minimal type declarations for y-websocket test utilities. */
declare module "y-websocket/bin/utils" {
  import type { Server } from "http";
  export function setupWSConnection(
    conn: import("ws").WebSocket,
    req: import("http").IncomingMessage,
  ): void;
}
