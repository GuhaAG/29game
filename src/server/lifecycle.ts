import { config } from './config';
import { hub } from './hub';
import { log, metrics, pseudonym } from './logger';
import { purgeStaleBuckets } from './ratelimit';
import {
  type Room,
  activeRoomCount,
  commitEvents,
  deleteRoom,
  listRooms,
  members,
  revokeAllSessions,
  revokeOutstandingGrants,
} from './state';

/** Administrative role only: the engine never depends on who the host is. */
function transferAbsentHost(room: Room): void {
  if (room.status !== 'lobby' && room.status !== 'active') return;
  const host = room.hostMembershipId ? room.memberships.get(room.hostMembershipId) : undefined;
  if (host?.connected) return;
  if (!host?.disconnectedAt || Date.now() - host.disconnectedAt < config.timings.hostTransferAfterMs) {
    return;
  }
  const candidate = members(room)
    .filter((membership) => membership.connected)
    .sort((a, b) => (a.connectedSince ?? 0) - (b.connectedSince ?? 0) || a.seat - b.seat)[0];
  if (!candidate) return;
  room.hostMembershipId = candidate.id;
  commitEvents(
    room,
    [{ type: 'room.hostTransferred', actorSeat: candidate.seat, publicPayload: { seat: candidate.seat } }],
    { touch: false },
  );
  log.info('host transferred', { room: pseudonym(room.id) });
  hub.broadcast(room);
}

function warnExpiring(room: Room): void {
  if (room.status !== 'lobby' && room.status !== 'active') return;
  if (room.expiryWarnedAt !== null) return;
  if (room.expiresAt - Date.now() > config.timings.expiryWarningMs) return;
  room.expiryWarnedAt = Date.now();
  for (const connection of hub.connectionsIn(room.id)) {
    hub.send(connection, {
      type: 'notice',
      level: 'warning',
      message: 'This room will close soon if nobody acts.',
      expiresAt: new Date(room.expiresAt).toISOString(),
    });
  }
  hub.broadcast(room);
}

/** Expiry revokes credentials and drops the game rather than half-restoring it. */
function expire(room: Room): void {
  if (room.status !== 'lobby' && room.status !== 'active') return;
  if (room.expiresAt > Date.now() && room.hardExpiresAt > Date.now()) return;
  room.status = 'expired';
  room.closedAt = Date.now();
  room.password = null;
  room.match = null;
  room.purgeAfter = Date.now() + config.timings.purgeExpiredAfterMs;
  revokeAllSessions(room);
  revokeOutstandingGrants(room);
  metrics.expiredRooms += 1;
  hub.closeRoomConnections(
    room.id,
    'expired',
    'This room has expired. Create a new room to play again.',
  );
  log.info('room expired', { room: pseudonym(room.id) });
}

function purge(room: Room): boolean {
  if (room.purgeAfter === null || room.purgeAfter > Date.now()) return false;
  if (hub.connectionsIn(room.id).length > 0) {
    hub.closeRoomConnections(room.id, 'closed', 'This room is no longer available.');
  }
  deleteRoom(room.id);
  return true;
}

let timer: NodeJS.Timeout | null = null;
let hourly: NodeJS.Timeout | null = null;

export function sweepOnce(): void {
  hub.sweepHeartbeats();
  let purged = 0;
  for (const room of listRooms()) {
    try {
      transferAbsentHost(room);
      warnExpiring(room);
      expire(room);
      if (purge(room)) purged += 1;
    } catch (error) {
      log.warn('sweep failed for room', { room: pseudonym(room.id), message: (error as Error).message });
    }
  }
  if (purged > 0) log.info('forgot rooms', { count: purged });
  metrics.activeRooms = activeRoomCount();
}

export function startLifecycle(): void {
  if (timer) return;
  timer = setInterval(sweepOnce, config.timings.sweepIntervalMs);
  timer.unref();
  hourly = setInterval(purgeStaleBuckets, 60 * 60_000);
  hourly.unref();
}

export function stopLifecycle(): void {
  if (timer) clearInterval(timer);
  if (hourly) clearInterval(hourly);
  timer = null;
  hourly = null;
}
