import { io, type Socket } from 'socket.io-client';
import { logger } from './logger';

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io(window.location.origin, {
      // Start with polling (works everywhere), then upgrade to websocket.
      // 'websocket-only' hangs on many mobile browsers / LAN setups.
      transports: ['polling', 'websocket'],
      upgrade: true,
      withCredentials: true,

      // Aggressive reconnection for mobile (app switch / sleep / wifi drop)
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,

      // Shorter timeouts so we detect dead connections faster
      timeout: 10_000,
    });

    socket.on('connect', () => {
      logger.info({ socketId: socket?.id }, 'socket connected');
    });
    socket.on('connect_error', (e) => {
      logger.error({ error: e.message }, 'socket connect_error');
    });
    socket.on('disconnect', (reason) => {
      logger.warn({ reason }, 'socket disconnected');
    });
    socket.on('reconnect', (attempt: number) => {
      logger.info({ attempt }, 'socket reconnected');
    });
    socket.on('reconnect_attempt', (attempt: number) => {
      logger.info({ attempt }, 'socket reconnect attempt');
    });
  }
  return socket;
}
