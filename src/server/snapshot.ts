import { type Seat, projectFor, teamOf } from '../engine';
import type { Snapshot } from '../shared/wire';
import type { Membership, Room } from './state';
import { members } from './state';

export type { SeatView, Snapshot } from '../shared/wire';

/**
 * The member-specific view. Everything a player must not know - other hands, the
 * undealt deck, unrevealed trump, other players' legal actions - is dropped here
 * rather than hidden by the interface.
 */
export function buildSnapshot(room: Room, viewer: Membership): Snapshot {
  const roster = members(room);
  const bySeat = new Map(roster.map((membership) => [membership.seat, membership]));

  const seats: Snapshot['seats'] = ([0, 1, 2, 3] as Seat[]).map((seat) => {
    const membership = bySeat.get(seat);
    return {
      seat,
      team: teamOf(seat),
      name: membership ? membership.displayName : null,
      connected: membership ? membership.connected : false,
      ready: membership ? membership.ready : false,
      isHost: membership ? membership.id === room.hostMembershipId : false,
      isYou: membership ? membership.id === viewer.id : false,
    };
  });

  const isHost = viewer.id === room.hostMembershipId;
  const occupied = seats.filter((seat) => seat.name !== null);
  const disconnected = roster.filter((membership) => !membership.connected).map((m) => m.seat);

  return {
    room: {
      id: room.id,
      status: room.status,
      rulesVersion: room.rulesVersion,
      revision: room.revision,
      presenceVersion: room.presenceVersion,
      expiresAt: new Date(room.expiresAt).toISOString(),
      expiryWarning: room.expiryWarnedAt !== null,
    },
    you: {
      seat: viewer.seat,
      team: teamOf(viewer.seat),
      name: viewer.displayName,
      ready: viewer.ready,
      isHost,
    },
    seats,
    password: isHost && room.status === 'lobby' ? room.password : null,
    canStart:
      isHost &&
      room.status === 'lobby' &&
      occupied.length === 4 &&
      occupied.every((seat) => seat.connected && seat.ready),
    paused:
      room.status === 'active' && disconnected.length > 0
        ? { reason: 'disconnected', seats: disconnected }
        : null,
    match: room.match ? projectFor(room.match.state, viewer.seat) : null,
  };
}
