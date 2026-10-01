import { randomUUID } from 'node:crypto';
import type { MatchState, Seat } from '../engine';
import { config } from './config';
import { AppError } from './errors';
import { t } from './text';

/**
 * The whole store. Rooms live in this process and nowhere else: a room is
 * created, played and dropped. Nothing survives a restart, and nothing is
 * written to disk.
 *
 * Every mutation runs inside `withRoom`, which serialises commands per room.
 * Handlers must therefore validate first and mutate last: there is no rollback,
 * but there is also no interleaving, because the store itself is synchronous.
 */

export type RoomStatus = 'lobby' | 'active' | 'closed' | 'expired';

export interface Membership {
  id: string;
  seat: Seat;
  displayName: string;
  /** Case-folded name used for the uniqueness check. */
  nameKey: string;
  ready: boolean;
  connected: boolean;
  connectionId: string | null;
  joinedAt: number;
  /** When the current connection was established; drives host transfer order. */
  connectedSince: number | null;
  disconnectedAt: number | null;
  abandonVote: boolean;
}

export interface Session {
  id: string;
  membershipId: string;
  verifier: Buffer;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export interface Admission {
  id: string;
  verifier: Buffer;
  passwordVersion: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface RecoveryGrant {
  id: string;
  seat: Seat;
  verifier: Buffer;
  expiresAt: number;
  consumedAt: number | null;
  revokedAt: number | null;
}

export interface CommandReceipt {
  membershipId: string;
  payloadHash: string;
  revision: number;
}

export interface Match {
  id: string;
  rulesVersion: number;
  state: MatchState;
  startedAt: number;
}

export interface Room {
  id: string;
  status: RoomStatus;
  rulesVersion: number;
  passwordVerifier: Buffer;
  passwordVersion: number;
  /** Host-readable password. Cleared when play starts. */
  password: string | null;
  hostMembershipId: string | null;
  revision: number;
  /** Separate counter so heartbeats never invalidate gameplay commands. */
  presenceVersion: number;
  eventSeq: number;
  createdAt: number;
  lastActionAt: number;
  expiresAt: number;
  hardExpiresAt: number;
  expiryWarnedAt: number | null;
  closedAt: number | null;
  purgeAfter: number | null;
  match: Match | null;
  memberships: Map<string, Membership>;
  sessions: Map<string, Session>;
  admissions: Map<string, Admission>;
  recoveries: Map<string, RecoveryGrant>;
  receipts: Map<string, CommandReceipt>;
}

export interface StoredEvent {
  type: string;
  actorSeat?: Seat | null;
  publicPayload?: unknown;
}

export interface CommittedEvent {
  seq: number;
  revision: number;
  type: string;
  actorSeat: Seat | null;
  publicPayload: unknown;
}

export interface CommitResult {
  revision: number;
  events: CommittedEvent[];
}

const rooms = new Map<string, Room>();

/** Serialises work per room, so two commands can never interleave. */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(handler: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(handler, handler);
    // Keep the chain alive even when a handler rejects.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const locks = new Map<string, Mutex>();

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function requireRoom(roomId: string): Room {
  const room = rooms.get(roomId);
  if (!room) throw new AppError('NOT_FOUND', t('server.roomNotFound'));
  return room;
}

export function isExpired(room: Room): boolean {
  const now = Date.now();
  return room.expiresAt <= now || room.hardExpiresAt <= now;
}

/** A room that can still be changed: not closed, not expired, not gone. */
export function requireLiveRoom(roomId: string): Room {
  const room = requireRoom(roomId);
  if (room.status === 'closed') throw new AppError('ROOM_UNAVAILABLE', t('server.roomClosed'));
  if (room.status === 'expired' || isExpired(room)) {
    throw new AppError('ROOM_UNAVAILABLE', t('server.roomExpired'));
  }
  return room;
}

/**
 * Runs `handler` with exclusive access to the room. Rooms that do not exist are
 * rejected before a lock is created, so probing cannot grow the lock table.
 */
export async function withRoom<T>(roomId: string, handler: (room: Room) => T | Promise<T>): Promise<T> {
  if (!rooms.has(roomId)) throw new AppError('NOT_FOUND', t('server.roomNotFound'));
  let lock = locks.get(roomId);
  if (!lock) {
    lock = new Mutex();
    locks.set(roomId, lock);
  }
  return lock.run(() => handler(requireRoom(roomId)));
}

export function listRooms(): Room[] {
  return [...rooms.values()];
}

export function activeRoomCount(): number {
  let count = 0;
  for (const room of rooms.values()) {
    if (room.status === 'lobby' || room.status === 'active') count += 1;
  }
  return count;
}

export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
  locks.delete(roomId);
}

export function createRoom(init: {
  id: string;
  rulesVersion: number;
  passwordVerifier: Buffer;
  password: string;
}): Room {
  const now = Date.now();
  const hardExpiresAt = now + config.timings.absoluteLifetimeMs;
  const room: Room = {
    id: init.id,
    status: 'lobby',
    rulesVersion: init.rulesVersion,
    passwordVerifier: init.passwordVerifier,
    passwordVersion: 1,
    password: init.password,
    hostMembershipId: null,
    revision: 0,
    presenceVersion: 0,
    eventSeq: 0,
    createdAt: now,
    lastActionAt: now,
    expiresAt: Math.min(now + config.timings.lobbyIdleMs, hardExpiresAt),
    hardExpiresAt,
    expiryWarnedAt: null,
    closedAt: null,
    purgeAfter: null,
    match: null,
    memberships: new Map(),
    sessions: new Map(),
    admissions: new Map(),
    recoveries: new Map(),
    receipts: new Map(),
  };
  rooms.set(room.id, room);
  return room;
}

export function members(room: Room): Membership[] {
  return [...room.memberships.values()].sort((a, b) => a.seat - b.seat);
}

export function memberAt(room: Room, seat: number): Membership | undefined {
  for (const membership of room.memberships.values()) {
    if (membership.seat === seat) return membership;
  }
  return undefined;
}

export function addMembership(
  room: Room,
  init: { seat: Seat; displayName: string; nameKey: string },
): Membership {
  const membership: Membership = {
    id: randomUUID(),
    seat: init.seat,
    displayName: init.displayName,
    nameKey: init.nameKey,
    ready: false,
    connected: false,
    connectionId: null,
    joinedAt: Date.now(),
    connectedSince: null,
    disconnectedAt: null,
    abandonVote: false,
  };
  room.memberships.set(membership.id, membership);
  return membership;
}

export function removeMembership(room: Room, membership: Membership): void {
  revokeSessionsFor(room, membership.id);
  room.memberships.delete(membership.id);
}

export function revokeSessionsFor(room: Room, membershipId: string): void {
  for (const session of room.sessions.values()) {
    if (session.membershipId === membershipId) session.revokedAt = Date.now();
  }
}

export function revokeAllSessions(room: Room): void {
  const now = Date.now();
  for (const session of room.sessions.values()) session.revokedAt ??= now;
}

export function revokeOutstandingGrants(room: Room): void {
  const now = Date.now();
  for (const admission of room.admissions.values()) admission.consumedAt ??= now;
  for (const grant of room.recoveries.values()) {
    if (!grant.consumedAt) grant.revokedAt ??= now;
  }
}

export function clearReadiness(room: Room): void {
  for (const membership of room.memberships.values()) membership.ready = false;
}

/** Idle lifetime restarts on every successful user action, never on a heartbeat. */
export function nextExpiryFor(room: Room): number {
  const idleMs = room.status === 'lobby' ? config.timings.lobbyIdleMs : config.timings.activeIdleMs;
  return Math.min(Date.now() + idleMs, room.hardExpiresAt);
}

/**
 * Bumps the revision, stamps the events and refreshes the idle deadline. The
 * caller has already mutated the room under the same lock, so state, events and
 * score effects become visible together.
 */
export function commitEvents(
  room: Room,
  events: StoredEvent[],
  options: { touch?: boolean } = {},
): CommitResult {
  room.revision += 1;
  if (options.touch !== false) {
    room.lastActionAt = Date.now();
    room.expiresAt = nextExpiryFor(room);
    room.expiryWarnedAt = null;
  }
  const committed = events.map((event) => {
    room.eventSeq += 1;
    return {
      seq: room.eventSeq,
      revision: room.revision,
      type: event.type,
      actorSeat: (event.actorSeat ?? null) as Seat | null,
      publicPayload: event.publicPayload ?? null,
    };
  });
  return { revision: room.revision, events: committed };
}

export function bumpPresence(room: Room): number {
  room.presenceVersion += 1;
  return room.presenceVersion;
}

/** Test and shutdown helper: forgets every room immediately. */
export function clearAll(): void {
  rooms.clear();
  locks.clear();
}
