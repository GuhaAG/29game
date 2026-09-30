import { createHash, randomUUID } from 'node:crypto';
import {
  type EngineCommand,
  type EngineEvent,
  EngineError,
  RULES_VERSION,
  type Seat,
  type Suit,
  applyCommand,
  createMatch,
  isSuit,
  needsDeck,
  shuffleDeck,
  startHand,
} from '../engine';
import { config } from './config';
import {
  generateRecoveryCode,
  generateRoomPassword,
  normalizePassword,
  secureRandomIndex,
  verifierFor,
} from './crypto';
import { AppError } from './errors';
import { log } from './logger';
import { checkDisplayName } from './names';
import { issueRecoveryCode } from './rooms';
import {
  type CommittedEvent,
  type Membership,
  type Room,
  type StoredEvent,
  clearReadiness,
  commitEvents,
  memberAt,
  members,
  removeMembership,
  revokeAllSessions,
  revokeOutstandingGrants,
  withRoom,
} from './state';

export interface CommandEnvelope {
  commandId: string;
  expectedRevision?: number | null;
  type: string;
  payload?: Record<string, unknown>;
}

export interface CommandOutcome {
  revision: number;
  duplicate: boolean;
  events: CommittedEvent[];
  room: Room;
  /** Delivered only to the acting connection, never broadcast. */
  privateReply?: Record<string, unknown>;
}

const LOBBY_COMMANDS = new Set([
  'updateOwnName',
  'moveOwnSeat',
  'ready',
  'start',
  'removeMember',
  'rotatePassword',
  'closeRoom',
  'issueRecovery',
  'abandonMatch',
]);

const ENGINE_COMMANDS = new Set([
  'bid',
  'pass',
  'chooseTrump',
  'double',
  'passDouble',
  'redouble',
  'passRedouble',
  'revealTrump',
  'playCard',
  'declarePair',
  'continueTrick',
  'nextHand',
  'rematch',
]);

function payloadHash(type: string, payload: unknown): string {
  return createHash('sha256').update(JSON.stringify({ type, payload: payload ?? null })).digest('base64url');
}

function requireHost(room: Room, membership: Membership): void {
  if (room.hostMembershipId !== membership.id) {
    throw new AppError('UNAUTHORIZED', 'Only the host can do that.');
  }
}

function requireLobby(room: Room): void {
  if (room.status !== 'lobby') throw new AppError('WRONG_PHASE', 'The match has already started.');
}

function freshDeck(): string[] {
  return shuffleDeck(secureRandomIndex);
}

/** Translates the validated envelope into a typed engine command for this seat. */
function toEngineCommand(type: string, payload: Record<string, unknown>, seat: Seat): EngineCommand {
  switch (type) {
    case 'bid': {
      const value = payload.value;
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new AppError('INVALID', 'Choose a bid.');
      }
      return { type: 'bid', seat, value };
    }
    case 'chooseTrump': {
      const mode = payload.mode;
      if (mode === 'seventh') return { type: 'chooseTrump', seat, mode: 'seventh' };
      if (mode === 'suit' && isSuit(payload.suit)) {
        return { type: 'chooseTrump', seat, mode: 'suit', suit: payload.suit as Suit };
      }
      throw new AppError('INVALID', 'Choose a trump suit or the seventh card.');
    }
    case 'playCard': {
      const card = payload.card;
      if (typeof card !== 'string') throw new AppError('INVALID', 'Choose a card to play.');
      return { type: 'playCard', seat, card };
    }
    case 'pass':
    case 'double':
    case 'passDouble':
    case 'redouble':
    case 'passRedouble':
    case 'revealTrump':
    case 'declarePair':
    case 'continueTrick':
    case 'nextHand':
    case 'rematch':
      return { type, seat } as EngineCommand;
    default:
      throw new AppError('INVALID', 'Unknown action.');
  }
}

/** Engine events carry no private data; card identities reach players through projections. */
function toStoredEvents(events: EngineEvent[], actorSeat: Seat): StoredEvent[] {
  return events.map((event) => ({
    type: `game.${event.type}`,
    actorSeat,
    publicPayload: event,
  }));
}

function describeEngineError(error: EngineError): string {
  switch (error.code) {
    case 'NOT_YOUR_TURN':
      return 'It is not your turn.';
    case 'WRONG_PHASE':
      return 'That action is not available right now.';
    default:
      return 'That move is not allowed.';
  }
}

function runEngine(room: Room, command: EngineCommand): StoredEvent[] {
  const match = room.match;
  if (!match) throw new AppError('WRONG_PHASE', 'The match has not started.');
  let result;
  try {
    result = applyCommand(match.state, command);
  } catch (error) {
    if (error instanceof EngineError) throw new AppError(error.code, describeEngineError(error));
    throw error;
  }
  let state = result.state;
  let events = result.events;
  // Automatic transitions run only here, on the server, with injected randomness.
  let guard = 0;
  while (needsDeck(state)) {
    guard += 1;
    if (guard > 4) throw new AppError('SERVER_ERROR', 'Unable to continue the match.');
    const dealer = command.type === 'rematch' ? (secureRandomIndex(4) as Seat) : undefined;
    const dealt = startHand(state, freshDeck(), dealer);
    state = dealt.state;
    events = [...events, ...dealt.events];
  }
  match.state = state;
  return toStoredEvents(events, command.seat);
}

function closeRoomRecord(room: Room): void {
  room.status = 'closed';
  room.closedAt = Date.now();
  room.password = null;
  room.purgeAfter = Date.now() + config.timings.purgeExpiredAfterMs;
  revokeAllSessions(room);
  revokeOutstandingGrants(room);
}

function handleLobbyCommand(
  room: Room,
  membership: Membership,
  type: string,
  payload: Record<string, unknown>,
): { events: StoredEvent[]; privateReply?: Record<string, unknown> } {
  const seat = membership.seat;
  const roster = members(room);

  switch (type) {
    case 'updateOwnName': {
      requireLobby(room);
      const check = checkDisplayName(payload.name);
      if (!check.ok) throw new AppError('INVALID', check.reason ?? 'That screen name is not allowed.');
      if (roster.some((other) => other.id !== membership.id && other.nameKey === check.key)) {
        throw new AppError('NAME_TAKEN', 'That screen name is already used in this room.');
      }
      membership.displayName = check.name;
      membership.nameKey = check.key;
      clearReadiness(room);
      return {
        events: [
          { type: 'member.renamed', actorSeat: seat, publicPayload: { seat, name: check.name } },
          { type: 'lobby.readyCleared', publicPayload: {} },
        ],
      };
    }
    case 'moveOwnSeat': {
      requireLobby(room);
      const target = payload.seat;
      if (typeof target !== 'number' || target < 0 || target > 3) {
        throw new AppError('INVALID', 'Choose one of the four seats.');
      }
      if (target === membership.seat) return { events: [] };
      if (roster.some((other) => other.seat === target)) {
        throw new AppError('SEAT_TAKEN', 'That seat is already taken.');
      }
      // One assignment both claims the new seat and releases the old one.
      membership.seat = target as Seat;
      clearReadiness(room);
      return {
        events: [
          { type: 'member.moved', actorSeat: seat, publicPayload: { from: seat, to: target } },
          { type: 'lobby.readyCleared', publicPayload: {} },
        ],
      };
    }
    case 'ready': {
      requireLobby(room);
      const ready = payload.ready !== false;
      membership.ready = ready;
      return { events: [{ type: 'member.ready', actorSeat: seat, publicPayload: { seat, ready } }] };
    }
    case 'start': {
      requireHost(room, membership);
      requireLobby(room);
      if (roster.length !== 4) {
        throw new AppError('WRONG_PHASE', 'All four seats must be filled before starting.');
      }
      if (!roster.every((member) => member.connected && member.ready)) {
        throw new AppError('WRONG_PHASE', 'Everyone must be connected and ready before starting.');
      }
      const dealer = secureRandomIndex(4) as Seat;
      const created = startHand(createMatch(dealer), freshDeck());
      room.match = {
        id: randomUUID(),
        rulesVersion: RULES_VERSION,
        state: created.state,
        startedAt: Date.now(),
      };
      // Seats, names, teams and admission lock now; the readable password goes.
      room.status = 'active';
      room.password = null;
      for (const admission of room.admissions.values()) admission.consumedAt ??= Date.now();
      return {
        events: [
          { type: 'match.started', actorSeat: seat, publicPayload: { dealer: created.state.dealer } },
          ...toStoredEvents(created.events, seat),
        ],
      };
    }
    case 'removeMember': {
      requireHost(room, membership);
      requireLobby(room);
      const target = payload.seat;
      if (typeof target !== 'number') throw new AppError('INVALID', 'Choose a seat to remove.');
      if (target === membership.seat) throw new AppError('INVALID', 'You cannot remove yourself.');
      const victim = memberAt(room, target);
      if (!victim) throw new AppError('INVALID', 'That seat is already empty.');
      removeMembership(room, victim);
      clearReadiness(room);
      return {
        events: [
          { type: 'member.removed', actorSeat: seat, publicPayload: { seat: target } },
          { type: 'lobby.readyCleared', publicPayload: {} },
        ],
      };
    }
    case 'rotatePassword': {
      requireHost(room, membership);
      requireLobby(room);
      const password = generateRoomPassword();
      room.passwordVerifier = verifierFor('password', normalizePassword(password), room.id);
      room.password = password;
      room.passwordVersion += 1;
      // Outstanding admission grants are bound to the old password version.
      for (const admission of room.admissions.values()) admission.consumedAt ??= Date.now();
      return {
        events: [{ type: 'room.passwordRotated', actorSeat: seat, publicPayload: {} }],
        privateReply: { password },
      };
    }
    case 'closeRoom': {
      requireHost(room, membership);
      // A running match can only be ended unanimously (abandonMatch), never by
      // the host alone; the host may close the room before it starts.
      requireLobby(room);
      closeRoomRecord(room);
      return { events: [{ type: 'room.closed', actorSeat: seat, publicPayload: { reason: 'host' } }] };
    }
    case 'issueRecovery': {
      requireHost(room, membership);
      const target = payload.seat;
      if (typeof target !== 'number' || target < 0 || target > 3) {
        throw new AppError('INVALID', 'Choose a seat.');
      }
      if (!memberAt(room, target)) throw new AppError('INVALID', 'That seat is empty.');
      const grant = issueRecoveryCode(room, target as Seat, generateRecoveryCode());
      return {
        events: [{ type: 'seat.recoveryIssued', actorSeat: seat, publicPayload: { seat: target } }],
        privateReply: { recoveryCode: grant.code, expiresAt: grant.expiresAt, seat: target },
      };
    }
    case 'abandonMatch': {
      if (room.status !== 'active') throw new AppError('WRONG_PHASE', 'There is no match to end.');
      if (roster.every((member) => member.connected)) {
        throw new AppError('WRONG_PHASE', 'Everyone is connected; the match can continue.');
      }
      membership.abandonVote = true;
      const present = roster.filter((member) => member.connected);
      if (!present.every((member) => member.abandonVote)) {
        return { events: [{ type: 'match.abandonVote', actorSeat: seat, publicPayload: { seat } }] };
      }
      closeRoomRecord(room);
      return {
        events: [{ type: 'match.abandoned', actorSeat: seat, publicPayload: { reason: 'unanimous' } }],
      };
    }
    default:
      throw new AppError('INVALID', 'Unknown action.');
  }
}

/**
 * Single entry point for every socket command. Runs under the room lock, so the
 * receipt, the state change and the events all become visible together.
 */
export async function handleCommand(
  roomId: string,
  membershipId: string,
  envelope: CommandEnvelope,
): Promise<CommandOutcome> {
  if (typeof envelope.commandId !== 'string' || envelope.commandId.length === 0 || envelope.commandId.length > 100) {
    throw new AppError('INVALID', 'Malformed request.');
  }
  const type = envelope.type;
  if (typeof type !== 'string' || (!LOBBY_COMMANDS.has(type) && !ENGINE_COMMANDS.has(type))) {
    throw new AppError('INVALID', 'Unknown action.');
  }
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const hash = payloadHash(type, payload);

  return withRoom(roomId, (room) => {
    const membership = room.memberships.get(membershipId);
    if (!membership) throw new AppError('UNAUTHORIZED', 'You are no longer part of this room.');

    const receipt = room.receipts.get(envelope.commandId);
    if (receipt) {
      if (receipt.payloadHash !== hash) {
        throw new AppError('INVALID', 'That request was already used for a different action.');
      }
      // Replaying a delivered command must not repeat its effects.
      return { revision: receipt.revision, duplicate: true, events: [], room };
    }

    if (room.status === 'closed' || room.status === 'expired') {
      throw new AppError('ROOM_UNAVAILABLE', 'This room is no longer available.');
    }
    if (
      envelope.expectedRevision !== undefined &&
      envelope.expectedRevision !== null &&
      envelope.expectedRevision !== room.revision
    ) {
      throw new AppError('STALE_STATE', 'The table changed while you were deciding.');
    }

    let events: StoredEvent[];
    let privateReply: Record<string, unknown> | undefined;

    if (LOBBY_COMMANDS.has(type)) {
      const outcome = handleLobbyCommand(room, membership, type, payload);
      events = outcome.events;
      privateReply = outcome.privateReply;
    } else {
      if (room.status !== 'active' || !room.match) {
        throw new AppError('WRONG_PHASE', 'The match has not started.');
      }
      const roster = members(room);
      if (roster.length !== 4 || roster.some((member) => !member.connected)) {
        throw new AppError('WRONG_PHASE', 'Play is paused until everyone is reconnected.');
      }
      events = runEngine(room, toEngineCommand(type, payload, membership.seat));
    }

    const committed = commitEvents(room, events);
    room.receipts.set(envelope.commandId, {
      membershipId: membership.id,
      payloadHash: hash,
      revision: committed.revision,
    });
    log.debug('command applied', { type, revision: committed.revision });

    return {
      revision: committed.revision,
      duplicate: false,
      events: committed.events,
      room,
      privateReply,
    };
  });
}
