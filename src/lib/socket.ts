import { io, type Socket } from 'socket.io-client';
import { logger } from './logger';

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io(window.location.origin, {
      transports: ['websocket'],
      withCredentials: true,
    });

    socket.on('connect', () => logger.info({ socketId: socket?.id }, 'socket connected'));
    socket.on('connect_error', (e) => console.error('socket connect_error', e));
    socket.on('error', (e) => console.error('socket error', e));
    socket.on('disconnect', (reason) => logger.info({ reason: reason }, 'socket disconnected'));
  }
  return socket;
}
