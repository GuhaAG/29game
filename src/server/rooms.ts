import { createHash, randomUUID } from 'node:crypto';
import { RULES_VERSION, type Seat } from '../engine';
import { config } from './config';
import {
  generateRoomId,
  generateRoomPassword,
  generateToken,
  normalizePassword,
  normalizeRecoveryCode,
  verifierFor,
  verifierMatches,
} from './crypto';
import { AppError, unauthorized } from './errors';
import { checkDisplayName } from './names';
import { checkOnly, enforce, recordFailure } from './ratelimit';
import { buildSnapshot, type Snapshot } from './snapshot';
import {
  type Membership,
  type Room,
  type Session,
  addMembership,
  clearReadiness,
  commitEvents,
  createRoom as createRoomRecord,
  getRoom,
  memberAt,
  members,
  requireLiveRoom,
  requireRoom,
  revokeSessionsFor,
  withRoom,
} from './state';

export const SESSION_COOKIE = 'seat_session';

function ipBucket(prefix: string, ip: string): string {
  return `${prefix}:${createHash('sha256').update(ip).digest('base64url').slice(0, 22)}`;
}

function assertSeat(value: unknown): Seat {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3) {
    throw new AppError('INVALID', 'Choose one of the four seats.');
  }
  return value as Seat;
}

export interface IssuedSession {
  cookieValue: string;
  csrfToken: string;
  sessionId: string;
}

function issueSession(room: Room, membershipId: string): IssuedSession {
  const sessionId = randomUUID();
  const token = generateToken(32);
  const session: Session = {
    id: sessionId,
    membershipId,
    verifier: verifierFor('session', token, sessionId),
    csrfToken: generateToken(24),
    issuedAt: Date.now(),
    expiresAt: room.hardExpiresAt,
    revokedAt: null,
  };
  room.sessions.set(sessionId, session);
  return { cookieValue: `${sessionId}.${token}`, csrfToken: session.csrfToken, sessionId };
}

export interface CreatedRoom {
  roomId: string;
  password: string;
  session: IssuedSession;
  seat: Seat;
  name: string;
}

/** Creates the room, claims the host's own seat and issues its session in one step. */
export async function createRoom(input: {
  name: unknown;
  seat: unknown;
  ip: string;
}): Promise<CreatedRoom> {
  await enforce(ipBucket('create', input.ip), config.limits.roomCreatePerIp);
  const name = checkDisplayName(input.name);
  if (!name.ok) throw new AppError('INVALID', name.reason ?? 'That screen name is not allowed.');
  const seat = assertSeat(input.seat);

  const password = generateRoomPassword();
  const roomId = generateRoomId();
  const room = createRoomRecord({
    id: roomId,
    rulesVersion: RULES_VERSION,
    passwordVerifier: verifierFor('password', normalizePassword(password), roomId),
    password,
  });
  const host = addMembership(room, { seat, displayName: name.name, nameKey: name.key });
  room.hostMembershipId = host.id;
  const session = issueSession(room, host.id);
  return { roomId, password, session, seat, name: name.name };
}

export interface AdmissionGrant {
  token: string;
  expiresAt: string;
}

/** Validates the room password and issues a short-lived admission grant. */
export async function requestAdmission(input: {
  roomId: string;
  password: unknown;
  ip: string;
}): Promise<AdmissionGrant> {
  const roomBucket = ipBucket(`join:${input.roomId}`, input.ip);
  const globalBucket = ipBucket('join', input.ip);
  await checkOnly(roomBucket, config.limits.failedJoinPerRoomIp);
  await checkOnly(globalBucket, config.limits.failedJoinPerIp);

  const fail = async (error: AppError): Promise<never> => {
    await recordFailure(roomBucket, config.limits.failedJoinPerRoomIp);
    await recordFailure(globalBucket, config.limits.failedJoinPerIp);
    throw error;
  };

  const existing = getRoom(input.roomId);
  const password = typeof input.password === 'string' ? input.password : '';
  // A wrong password and an unknown room are indistinguishable from outside.
  if (!existing || password.length === 0) {
    return fail(unauthorized('That room link or password is not valid.'));
  }

  return withRoom(input.roomId, async (room) => {
    if (!verifierMatches('password', normalizePassword(password), room.passwordVerifier, room.id)) {
      return fail(unauthorized('That room link or password is not valid.'));
    }
    if (room.status !== 'lobby' || room.expiresAt <= Date.now()) {
      throw new AppError('ROOM_UNAVAILABLE', 'This room is not accepting new players.');
    }
    if (room.memberships.size >= 4) {
      throw new AppError('ROOM_UNAVAILABLE', 'All four seats are taken.');
    }
    const token = generateToken(32);
    const grantId = randomUUID();
    const expiresAt = Date.now() + config.timings.admissionTtlMs;
    room.admissions.set(grantId, {
      id: grantId,
      verifier: verifierFor('admission', token, grantId),
      passwordVersion: room.passwordVersion,
      expiresAt,
      consumedAt: null,
    });
    return { token: `${grantId}.${token}`, expiresAt: new Date(expiresAt).toISOString() };
  });
}

function checkAdmission(room: Room, grant: unknown): { id: string } {
  if (typeof grant !== 'string' || !grant.includes('.')) throw unauthorized();
  const [grantId, token] = grant.split('.', 2) as [string, string];
  const record = room.admissions.get(grantId);
  if (!record || record.consumedAt || record.expiresAt <= Date.now()) throw unauthorized();
  if (record.passwordVersion !== room.passwordVersion) {
    throw unauthorized('The room password changed. Ask the host for the new one.');
  }
  if (!verifierMatches('admission', token, record.verifier, grantId)) throw unauthorized();
  return { id: grantId };
}

export interface SeatListing {
  status: string;
  seats: { seat: Seat; team: 0 | 1; name: string | null }[];
}

/** Roster preview for a holder of a valid admission grant, never for a room id alone. */
export async function listSeats(input: { roomId: string; grant: unknown }): Promise<SeatListing> {
  return withRoom(input.roomId, (room) => {
    requireLiveRoom(room.id);
    checkAdmission(room, input.grant);
    return {
      status: room.status,
      seats: ([0, 1, 2, 3] as Seat[]).map((seat) => ({
        seat,
        team: (seat % 2) as 0 | 1,
        name: memberAt(room, seat)?.displayName ?? null,
      })),
    };
  });
}

export interface ClaimResult {
  session: IssuedSession;
  seat: Seat;
  name: string;
  revision: number;
  membershipId: string;
}

/**
 * Consumes the admission grant and claims the chosen seat and name. Two browsers
 * racing for the same seat or name: exactly one wins, because the check and the
 * claim happen in one uninterrupted step under the room lock.
 */
export async function claimSeat(input: {
  roomId: string;
  grant: unknown;
  name: unknown;
  seat: unknown;
}): Promise<ClaimResult> {
  const check = checkDisplayName(input.name);
  if (!check.ok) throw new AppError('INVALID', check.reason ?? 'That screen name is not allowed.');
  const seat = assertSeat(input.seat);

  return withRoom(input.roomId, (room) => {
    requireLiveRoom(room.id);
    if (room.status !== 'lobby') {
      throw new AppError('ROOM_UNAVAILABLE', 'This match has already started.');
    }
    const grant = checkAdmission(room, input.grant);
    const roster = members(room);
    if (roster.some((membership) => membership.seat === seat)) {
      throw new AppError('SEAT_TAKEN', 'That seat was just taken. Pick another one.');
    }
    if (roster.some((membership) => membership.nameKey === check.key)) {
      throw new AppError('NAME_TAKEN', 'That screen name is already used in this room.');
    }

    const membership = addMembership(room, { seat, displayName: check.name, nameKey: check.key });
    const admission = room.admissions.get(grant.id);
    if (admission) admission.consumedAt = Date.now();
    // A new arrival changes the roster, so everyone confirms readiness again.
    clearReadiness(room);
    const session = issueSession(room, membership.id);
    const committed = commitEvents(room, [
      { type: 'member.joined', actorSeat: seat, publicPayload: { seat, name: check.name } },
    ]);
    return {
      session,
      seat,
      name: check.name,
      revision: committed.revision,
      membershipId: membership.id,
    };
  });
}

export interface AuthContext {
  room: Room;
  membership: Membership;
  session: Session;
}

/** Resolves the seat session cookie. Never trusts a client-supplied seat or name. */
export function authenticate(roomId: string, cookieValue: string | undefined): AuthContext {
  if (!cookieValue || !cookieValue.includes('.')) throw unauthorized();
  const [sessionId, token] = cookieValue.split('.', 2) as [string, string];
  const room = requireRoom(roomId);
  const session = room.sessions.get(sessionId);
  if (!session || session.revokedAt || session.expiresAt <= Date.now()) throw unauthorized();
  if (!verifierMatches('session', token, session.verifier, sessionId)) throw unauthorized();
  const membership = room.memberships.get(session.membershipId);
  if (!membership) throw unauthorized('You are no longer part of this room.');
  return { room, membership, session };
}

export function snapshotFor(
  roomId: string,
  cookieValue: string | undefined,
): { snapshot: Snapshot; csrfToken: string } {
  const context = authenticate(roomId, cookieValue);
  return {
    snapshot: buildSnapshot(context.room, context.membership),
    csrfToken: context.session.csrfToken,
  };
}

export interface RecoveryIssue {
  code: string;
  expiresAt: string;
  seat: Seat;
}

/** Host-issued, one-use, five-minute code for a seat whose browser session was lost. */
export function issueRecoveryCode(room: Room, seat: Seat, code: string): RecoveryIssue {
  for (const grant of room.recoveries.values()) {
    if (grant.seat === seat && !grant.consumedAt) grant.revokedAt ??= Date.now();
  }
  const grantId = randomUUID();
  const expiresAt = Date.now() + config.timings.recoveryTtlMs;
  room.recoveries.set(grantId, {
    id: grantId,
    seat,
    verifier: verifierFor('recovery', normalizeRecoveryCode(code), grantId),
    expiresAt,
    consumedAt: null,
    revokedAt: null,
  });
  return { code: `${grantId}.${code}`, expiresAt: new Date(expiresAt).toISOString(), seat };
}

/** Redeems a recovery code, revoking every earlier credential for that seat. */
export async function redeemRecovery(input: {
  roomId: string;
  code: unknown;
  ip: string;
}): Promise<{ session: IssuedSession; seat: Seat }> {
  const roomBucket = ipBucket(`recover:${input.roomId}`, input.ip);
  await checkOnly(roomBucket, config.limits.failedJoinPerRoomIp);
  const raw = typeof input.code === 'string' ? input.code.trim() : '';
  if (!raw.includes('.')) {
    await recordFailure(roomBucket, config.limits.failedJoinPerRoomIp);
    throw unauthorized('That recovery code is not valid.');
  }
  const [grantId, secret] = raw.split('.', 2) as [string, string];

  return withRoom(input.roomId, async (room) => {
    requireLiveRoom(room.id);
    const grant = room.recoveries.get(grantId);
    const valid =
      grant &&
      !grant.consumedAt &&
      !grant.revokedAt &&
      grant.expiresAt > Date.now() &&
      verifierMatches('recovery', normalizeRecoveryCode(secret), grant.verifier, grantId);
    if (!grant || !valid) {
      await recordFailure(roomBucket, config.limits.failedJoinPerRoomIp);
      throw unauthorized('That recovery code is not valid or has already been used.');
    }
    const membership = memberAt(room, grant.seat);
    if (!membership) throw new AppError('ROOM_UNAVAILABLE', 'That seat is no longer in the room.');
    grant.consumedAt = Date.now();
    revokeSessionsFor(room, membership.id);
    const session = issueSession(room, membership.id);
    commitEvents(room, [
      { type: 'seat.recovered', actorSeat: membership.seat, publicPayload: { seat: membership.seat } },
    ]);
    return { session, seat: membership.seat };
  });
}
