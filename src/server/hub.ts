import { randomUUID } from 'node:crypto';
import type { Seat } from '../engine';
import { config } from './config';
import { log, metrics, pseudonym } from './logger';
import { TokenBucket } from './ratelimit';
import { buildSnapshot } from './snapshot';
import { type Room, bumpPresence, getRoom, withRoom } from './state';
import { t } from './text';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export interface Connection {
  id: string;
  roomId: string;
  membershipId: string;
  seat: Seat;
  socket: SocketLike;
  bucket: TokenBucket;
  lastSeen: number;
  closed: boolean;
}

const OPEN = 1;

/**
 * Tracks the one controlling connection per seat and fans state out to them.
 * Sockets and rooms live in the same process, so a broadcast is a direct write.
 */
export class Hub {
  private readonly byRoom = new Map<string, Set<Connection>>();
  private readonly byMembership = new Map<string, Connection>();

  connectionCount(): number {
    return this.byMembership.size;
  }

  roomsWithConnections(): string[] {
    return [...this.byRoom.keys()];
  }

  /** Registers a connection, replacing any earlier one for the same seat. */
  register(roomId: string, membershipId: string, seat: Seat, socket: SocketLike): Connection {
    const previous = this.byMembership.get(membershipId);
    if (previous && previous.socket !== socket) {
      this.send(previous, {
        type: 'replaced',
        message: t('server.seatReplaced'),
      });
      previous.closed = true;
      try {
        previous.socket.close(4001, 'replaced');
      } catch {
        // already gone
      }
      this.remove(previous);
    }
    const connection: Connection = {
      id: randomUUID(),
      roomId,
      membershipId,
      seat,
      socket,
      bucket: new TokenBucket(),
      lastSeen: Date.now(),
      closed: false,
    };
    this.byMembership.set(membershipId, connection);
    const set = this.byRoom.get(roomId) ?? new Set<Connection>();
    set.add(connection);
    this.byRoom.set(roomId, set);
    metrics.connectedPlayers = this.byMembership.size;
    return connection;
  }

  remove(connection: Connection): void {
    const current = this.byMembership.get(connection.membershipId);
    if (current && current.id === connection.id) this.byMembership.delete(connection.membershipId);
    const set = this.byRoom.get(connection.roomId);
    if (set) {
      set.delete(connection);
      if (set.size === 0) this.byRoom.delete(connection.roomId);
    }
    metrics.connectedPlayers = this.byMembership.size;
  }

  isCurrent(connection: Connection): boolean {
    return this.byMembership.get(connection.membershipId)?.id === connection.id;
  }

  connectionsIn(roomId: string): Connection[] {
    return [...(this.byRoom.get(roomId) ?? [])];
  }

  send(connection: Connection, message: unknown): void {
    if (connection.socket.readyState !== OPEN) return;
    try {
      connection.socket.send(JSON.stringify(message));
    } catch {
      log.warn('socket send failed', { room: pseudonym(connection.roomId) });
    }
  }

  /** Sends every connected seat its own projection of the room. */
  broadcast(room: Room, extra: { events?: unknown[]; lastSeq?: number } = {}): void {
    for (const connection of this.connectionsIn(room.id)) {
      const membership = room.memberships.get(connection.membershipId);
      if (!membership) {
        this.send(connection, { type: 'removed', message: t('server.notInRoom') });
        continue;
      }
      this.send(connection, {
        type: 'update',
        revision: room.revision,
        seq: extra.lastSeq ?? null,
        events: extra.events ?? [],
        snapshot: buildSnapshot(room, membership),
      });
    }
  }

  refresh(roomId: string): void {
    const room = getRoom(roomId);
    if (room) this.broadcast(room);
  }

  /** Presence uses its own version, so heartbeats never stale gameplay commands. */
  async setPresence(
    roomId: string,
    membershipId: string,
    connected: boolean,
    connectionId: string | null,
  ): Promise<void> {
    if (!getRoom(roomId)) return;
    await withRoom(roomId, (room) => {
      const membership = room.memberships.get(membershipId);
      if (!membership) return;
      membership.connected = connected;
      membership.connectionId = connectionId;
      membership.connectedSince = connected ? Date.now() : null;
      membership.disconnectedAt = connected ? null : Date.now();
      if (connected) membership.abandonVote = false;
      bumpPresence(room);
      this.broadcast(room);
    });
  }

  /** A connection silent for longer than the timeout is dropped. */
  sweepHeartbeats(): void {
    const deadline = Date.now() - config.timings.disconnectAfterMs;
    for (const connection of this.byMembership.values()) {
      this.send(connection, { type: 'ping', at: Date.now() });
      if (connection.lastSeen < deadline) {
        log.info('connection timed out', { room: pseudonym(connection.roomId) });
        try {
          connection.socket.close(4002, 'heartbeat timeout');
        } catch {
          // already gone
        }
      }
    }
  }

  /** Used when a room is closed, expired or purged. */
  closeRoomConnections(roomId: string, reason: string, message: string): void {
    for (const connection of this.connectionsIn(roomId)) {
      this.send(connection, { type: 'closed', reason, message });
      connection.closed = true;
      try {
        connection.socket.close(4003, reason);
      } catch {
        // already gone
      }
    }
  }

  everyConnection(): Connection[] {
    return [...this.byMembership.values()];
  }
}

export const hub = new Hub();
