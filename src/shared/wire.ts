import type { MatchView, Seat } from '../engine';

/**
 * The shapes that cross the wire. Kept free of any Node or browser dependency so
 * the server and the client share one definition of the protocol.
 */

export interface SeatView {
  seat: Seat;
  team: 0 | 1;
  name: string | null;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  isYou: boolean;
}

export interface Snapshot {
  room: {
    id: string;
    status: string;
    rulesVersion: number;
    revision: number;
    presenceVersion: number;
    expiresAt: string;
    expiryWarning: boolean;
  };
  you: {
    seat: Seat;
    team: 0 | 1;
    name: string;
    ready: boolean;
    isHost: boolean;
  };
  seats: SeatView[];
  /** Host-only, lobby-only readable copy of the room password. */
  password: string | null;
  canStart: boolean;
  paused: { reason: 'disconnected'; seats: Seat[] } | null;
  match: MatchView | null;
}
