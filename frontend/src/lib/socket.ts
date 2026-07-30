import { io, type Socket } from "socket.io-client";
import { getToken } from "./session";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Single shared connection reused by every component that listens for
// real-time events (docs/11-documentation-api.md §13), rather than one
// socket per component.
let socket: Socket | null = null;

export function getSocket(): Socket | null {
  const token = getToken();
  if (!token) return null;

  if (!socket) {
    socket = io(SOCKET_URL, { auth: { token }, autoConnect: false });
  } else {
    socket.auth = { token };
  }

  if (!socket.connected) socket.connect();
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
