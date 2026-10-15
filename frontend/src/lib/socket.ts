import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { API_BASE, getToken } from '@/lib/http';

let socket: Socket | null = null;

/** One shared realtime connection (messages, typing, calls, channel posts). */
export function connectSocket(): Socket {
  if (socket) return socket;
  socket = io(API_BASE || undefined, {
    auth: (cb) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
