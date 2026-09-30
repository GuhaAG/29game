import type { CardId } from '../engine';
import type { Snapshot } from '../shared/wire';
import { RequestFailed, api } from './api';
import { alertNow, announce, mount } from './dom';
import { RoomSocket, type ServerMessage, type SocketStatus } from './socket';
import {
  type Actions,
  type UiState,
  closedView,
  createView,
  gateView,
  homeView,
  joinView,
  recoverView,
  roomView,
} from './views';

const state: UiState = {
  view: 'home',
  roomId: null,
  seats: null,
  snapshot: null,
  status: 'closed',
  statusDetail: null,
  notice: null,
  hostPassword: null,
  recovery: null,
  selectedCard: null,
  selectedBid: null,
  busy: false,
  log: [],
};

/** The admission grant and CSRF token stay in memory only, never in storage. */
let admissionGrant: string | null = null;
let csrfToken: string | null = null;
let socket: RoomSocket | null = null;
let lastTurn: number | null = null;
let lastPhase: string | null = null;
let lastSeq = 0;

const root = document.getElementById('app') as HTMLElement;

/**
 * Commands that only the player on turn can issue. Those carry the revision the
 * choice was made against; commands four players may send at the same moment
 * (acknowledgements, readiness, lobby edits) must not fail each other with
 * STALE_STATE, so they are sent without one.
 */
const TURN_COMMANDS = new Set([
  'bid',
  'pass',
  'chooseTrump',
  'double',
  'passDouble',
  'redouble',
  'passRedouble',
  'revealTrump',
  'playCard',
]);

function render(): void {
  const views: Record<UiState['view'], () => HTMLElement> = {
    home: () => homeView(state, actions),
    create: () => createView(state, actions),
    gate: () => gateView(state, actions),
    join: () => joinView(state, actions),
    room: () => roomView(state, actions),
    recover: () => recoverView(state, actions),
    closed: () => closedView(state, actions),
  };
  mount(root, views[state.view]());
}

function setNotice(level: 'info' | 'error' | 'warning', message: string): void {
  state.notice = { level, message };
  if (level === 'error') alertNow(message);
  render();
}

function failureNotice(error: unknown): void {
  if (error instanceof RequestFailed) {
    setNotice('error', error.info.message);
    return;
  }
  setNotice('error', 'Something went wrong. Please try again.');
}

function seatName(seat: number): string {
  return state.snapshot?.seats[seat]?.name ?? `Seat ${seat + 1}`;
}

/** Public announcements only: nothing private ever reaches the live region. */
function describeEvent(event: { type: string; actorSeat: number | null; payload: Record<string, unknown> }): string | null {
  const actor = event.actorSeat === null ? 'Someone' : seatName(event.actorSeat);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'game.bidPlaced':
      return `${seatName(payload.seat as number)} bid ${payload.value}${payload.forced ? ' (forced)' : ''}.`;
    case 'game.passed':
      return `${seatName(payload.seat as number)} passed.`;
    case 'game.auctionWon':
      return `${seatName(payload.seat as number)} holds the contract at ${payload.value}.`;
    case 'game.trumpChosen':
      return `${actor} chose trump${payload.mode === 'seventh' ? ' from the seventh card' : ''}.`;
    case 'game.doubled':
      return `${seatName(payload.seat as number)} doubled.`;
    case 'game.redoubled':
      return `${seatName(payload.seat as number)} redoubled.`;
    case 'game.trumpRevealed':
      return `${seatName(payload.seat as number)} revealed trump.`;
    case 'game.cardPlayed':
      return `${seatName(payload.seat as number)} played a card.`;
    case 'game.trickCompleted': {
      const trick = payload.trick as { winner: number; points: number; index: number };
      return `${seatName(trick.winner)} won trick ${trick.index + 1} for ${trick.points} points.`;
    }
    case 'game.pairDeclared': {
      const pair = payload.pair as { seat: number };
      return `${seatName(pair.seat)} declared a marriage. The target is now ${payload.target}.`;
    }
    case 'game.handCompleted':
      return 'The hand is complete.';
    case 'game.matchCompleted':
      return 'The match is complete.';
    case 'match.started':
      return 'The match has started.';
    case 'member.joined':
      return `${payload.name} joined.`;
    case 'member.renamed':
      return `${payload.name} changed their name.`;
    case 'member.removed':
      return `Seat ${(payload.seat as number) + 1} was removed by the host.`;
    case 'room.hostTransferred':
      return `${seatName(payload.seat as number)} is now the host.`;
    case 'room.passwordRotated':
      return 'The host changed the room password.';
    case 'match.abandoned':
      return 'The match was ended with no winner.';
    default:
      return null;
  }
}

function applySnapshot(snapshot: Snapshot): void {
  const previousSeat = state.snapshot?.you.seat;
  state.snapshot = snapshot;
  state.view = 'room';
  const hand = snapshot.match?.hand ?? null;
  const phase = snapshot.match?.phase ?? null;
  // Selection survives harmless updates, but never a turn or phase change.
  if (hand?.turn !== lastTurn || phase !== lastPhase || previousSeat !== snapshot.you.seat) {
    state.selectedCard = null;
    state.selectedBid = null;
  }
  if (state.selectedCard && !snapshot.match?.actions.legalCards.includes(state.selectedCard)) {
    state.selectedCard = null;
  }
  lastTurn = hand?.turn ?? null;
  lastPhase = phase;
  if (phase === 'PLAYING' && hand && hand.turn === snapshot.you.seat && !hand.ack) {
    announce('Your turn to play.');
  }
}

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case 'snapshot':
      applySnapshot(message.snapshot as Snapshot);
      render();
      return;
    case 'update': {
      const seq = message.seq as number | null;
      if (typeof seq === 'number') {
        if (lastSeq && seq > lastSeq + ((message.events as unknown[]) ?? []).length) {
          socket?.send({ type: 'snapshot' });
        }
        lastSeq = seq;
      }
      applySnapshot(message.snapshot as Snapshot);
      for (const event of (message.events as { type: string; actorSeat: number | null; payload: Record<string, unknown> }[]) ?? []) {
        const line = describeEvent(event);
        if (line) {
          state.log.push(line);
          announce(line);
        }
      }
      render();
      return;
    }
    case 'ack': {
      const reply = message.reply as Record<string, unknown> | null;
      if (reply?.password) {
        state.hostPassword = String(reply.password);
        setNotice('info', 'The room password has been replaced. Share the new one privately.');
      }
      if (reply?.recoveryCode) {
        state.recovery = {
          code: String(reply.recoveryCode),
          seat: Number(reply.seat),
          expiresAt: String(reply.expiresAt),
        };
        render();
      }
      return;
    }
    case 'error': {
      const code = String(message.code);
      if (code === 'STALE_STATE') {
        state.selectedCard = null;
        state.selectedBid = null;
      }
      setNotice('error', String(message.message));
      return;
    }
    case 'notice':
      setNotice((message.level as 'info' | 'warning') ?? 'info', String(message.message));
      return;
    case 'replaced':
      state.status = 'closed';
      state.statusDetail = 'replaced';
      setNotice('warning', String(message.message));
      socket?.close();
      return;
    case 'closed':
      state.view = 'closed';
      state.statusDetail = String(message.reason ?? 'closed');
      socket?.close();
      render();
      return;
    case 'removed':
      state.view = 'closed';
      state.statusDetail = 'removed';
      setNotice('warning', String(message.message));
      return;
    default:
      return;
  }
}

function handleStatus(status: SocketStatus, detail?: string): void {
  state.status = status;
  state.statusDetail = detail ?? null;
  if (status === 'open') {
    void refreshState();
  }
  render();
}

async function refreshState(): Promise<void> {
  if (!state.roomId) return;
  try {
    const result = await api.state(state.roomId);
    csrfToken = result.csrfToken;
    applySnapshot(result.snapshot as Snapshot);
    render();
  } catch (error) {
    if (error instanceof RequestFailed && error.info.code === 'UNAUTHORIZED') {
      state.view = 'gate';
      render();
    }
  }
}

function connect(roomId: string): void {
  socket?.close();
  socket = new RoomSocket(roomId, { onMessage: handleMessage, onStatus: handleStatus });
  socket.connect();
}

const actions: Actions = {
  navigate(path: string): void {
    history.pushState({}, '', path);
    void route();
  },

  createRoom(name: string, seat: number): void {
    state.busy = true;
    render();
    void api
      .createRoom(name, seat)
      .then((created) => {
        state.busy = false;
        state.roomId = created.roomId;
        state.hostPassword = created.password;
        csrfToken = created.csrfToken;
        history.pushState({}, '', `/room/${created.roomId}`);
        state.view = 'room';
        connect(created.roomId);
        void refreshState();
        setNotice('info', 'Room created. Share the link and password separately.');
      })
      .catch((error: unknown) => {
        state.busy = false;
        failureNotice(error);
      });
  },

  submitPassword(password: string): void {
    if (!state.roomId) return;
    state.busy = true;
    render();
    void api
      .admission(state.roomId, password)
      .then(async (grant) => {
        admissionGrant = grant.token;
        const seats = await api.seats(state.roomId as string, grant.token);
        state.seats = seats.seats;
        state.busy = false;
        state.view = 'join';
        state.notice = null;
        render();
      })
      .catch((error: unknown) => {
        state.busy = false;
        failureNotice(error);
      });
  },

  claimSeat(name: string, seat: number): void {
    if (!state.roomId || !admissionGrant) return;
    state.busy = true;
    render();
    void api
      .claim(state.roomId, admissionGrant, name, seat, csrfToken)
      .then((claim) => {
        state.busy = false;
        admissionGrant = null;
        csrfToken = claim.csrfToken;
        state.view = 'room';
        connect(state.roomId as string);
        void refreshState();
      })
      .catch((error: unknown) => {
        state.busy = false;
        if (error instanceof RequestFailed && (error.info.code === 'SEAT_TAKEN' || error.info.code === 'NAME_TAKEN')) {
          // Refresh availability so the player sees what is actually free.
          if (admissionGrant && state.roomId) {
            void api
              .seats(state.roomId, admissionGrant)
              .then((seats) => {
                state.seats = seats.seats;
                render();
              })
              .catch(() => undefined);
          }
        }
        failureNotice(error);
      });
  },

  redeemRecovery(code: string): void {
    if (!state.roomId) return;
    state.busy = true;
    render();
    void api
      .recover(state.roomId, code)
      .then((recovered) => {
        state.busy = false;
        csrfToken = recovered.csrfToken;
        state.view = 'room';
        connect(state.roomId as string);
        void refreshState();
        setNotice('info', 'Your seat is back. Any older session for it has been signed out.');
      })
      .catch((error: unknown) => {
        state.busy = false;
        failureNotice(error);
      });
  },

  send(action: string, payload: Record<string, unknown> = {}): void {
    if (!socket || state.status !== 'open') {
      setNotice('warning', 'Reconnecting—actions paused. Your action was not sent.');
      return;
    }
    const sent = socket.send({
      type: 'command',
      commandId: crypto.randomUUID(),
      expectedRevision: TURN_COMMANDS.has(action) ? (state.snapshot?.room.revision ?? null) : null,
      action,
      payload,
    });
    if (!sent) setNotice('warning', 'Reconnecting—actions paused. Your action was not sent.');
  },

  selectCard(cardId: CardId | null): void {
    state.selectedCard = cardId;
    render();
  },

  selectBid(value: number | null): void {
    state.selectedBid = value;
    render();
  },

  copy(label: string, value: string): void {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => setNotice('info', `${label} copied. Share it privately.`))
      .catch(() => setNotice('warning', `Copy failed. Select the ${label.toLowerCase()} and copy it manually.`));
  },

  dismissNotice(): void {
    state.notice = null;
    render();
  },
};

async function route(): Promise<void> {
  const path = location.pathname;
  const match = /^\/room\/([a-z0-9]+)$/.exec(path);
  if (match) {
    const roomId = match[1] as string;
    const changed = state.roomId !== roomId;
    state.roomId = roomId;
    try {
      const result = await api.state(roomId);
      csrfToken = result.csrfToken;
      applySnapshot(result.snapshot as Snapshot);
      if (changed || !socket) connect(roomId);
    } catch (error) {
      if (error instanceof RequestFailed && error.info.code === 'NOT_FOUND') {
        state.view = 'closed';
      } else {
        state.view = 'gate';
      }
    }
    render();
    return;
  }
  socket?.close();
  socket = null;
  state.roomId = null;
  state.view = path === '/create' ? 'create' : 'home';
  render();
}

window.addEventListener('popstate', () => void route());
window.addEventListener('online', () => {
  if (state.roomId && state.status !== 'open') connect(state.roomId);
});

void route();
