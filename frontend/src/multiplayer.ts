import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  skinId: string;
  health: number;
  maxHealth: number;
}

export interface RemoteEnemy {
  id: string;
  type: string;
  x: number;
  y: number;
}

export interface JoinedPayload {
  roomId: string;
  selfId: string;
  players: RemotePlayer[];
  enemies: RemoteEnemy[];
  maxPlayers: number;
  /** Fixed server-side simulation space — positions are reported/received in these units, not local canvas pixels. */
  worldWidth: number;
  worldHeight: number;
}

/** Pure — whether enough time has passed to send another position update. */
export function shouldSendPosition(lastSentAt: number, now: number, minIntervalMs: number): boolean {
  return now - lastSentAt >= minIntervalMs;
}

/**
 * Thin wrapper around the socket.io-client connection for the multiplayer
 * test mode (step 1: networking infra only — no nickname, no anti-cheat).
 * Connects lazily: only used once the player opts into "Multiplayer (teste)",
 * so single-player has zero socket overhead.
 */
export class MultiplayerClient {
  private socket: Socket | null = null;
  private lastSentAt = 0;
  private readonly minSendIntervalMs = 50; // matches the server's ~20 ticks/sec

  connect(
    skinId: string,
    maxHealth: number,
    radius: number,
    onJoined: (payload: JoinedPayload) => void,
    onError?: (message: string) => void,
  ): void {
    // Defensive: a stray double-invocation (e.g. a focused button re-firing
    // on a keypress) must not leave a stale connection behind — that reads
    // as a frozen "ghost" player nobody is updating anymore.
    this.disconnect();

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });
    this.socket = socket;
    socket.on('connect', () => socket.emit('mp:join', { skinId, maxHealth, radius }));
    socket.on('mp:joined', onJoined);
    // Without this, a backend that isn't running just hangs the UI on
    // "Conectando..." forever with no visible signal of what's wrong.
    socket.on('connect_error', err => onError?.(err.message));
  }

  onState(callback: (players: RemotePlayer[], enemies: RemoteEnemy[]) => void): void {
    this.socket?.on('mp:state', (payload: { players: RemotePlayer[]; enemies: RemoteEnemy[] }) =>
      callback(payload.players, payload.enemies),
    );
  }

  onPlayerLeft(callback: (id: string) => void): void {
    this.socket?.on('mp:playerLeft', (payload: { id: string }) => callback(payload.id));
  }

  /**
   * Throttled to at most one send per `minSendIntervalMs`; silently drops the rest.
   * `x`/`y` must already be in world-space units (see `JoinedPayload.worldWidth/worldHeight`),
   * not local canvas pixels — the caller converts.
   */
  sendPosition(x: number, y: number, now: number): void {
    if (!this.socket || !shouldSendPosition(this.lastSentAt, now, this.minSendIntervalMs)) return;
    this.lastSentAt = now;
    this.socket.emit('mp:move', { x, y });
  }

  get selfId(): string | undefined {
    return this.socket?.id;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.lastSentAt = 0;
  }
}
