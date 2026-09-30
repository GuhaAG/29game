import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { JSDOM } from 'jsdom';

// The view layer builds real DOM nodes, so it is exercised against a real DOM.
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/room/testroom',
});
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).location = dom.window.location;
(globalThis as Record<string, unknown>).CSS = dom.window.CSS;
(globalThis as Record<string, unknown>).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as Record<string, unknown>).Node = dom.window.Node;
(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
(globalThis as Record<string, unknown>).DocumentFragment = dom.window.DocumentFragment;

/* eslint-disable @typescript-eslint/no-var-requires */
const views = require('../../src/client/views') as typeof import('../../src/client/views');
/* eslint-enable @typescript-eslint/no-var-requires */

const noopActions = new Proxy({}, { get: () => () => undefined }) as import('../../src/client/views').Actions;

function baseState(): import('../../src/client/views').UiState {
  return {
    view: 'room',
    roomId: 'testroom',
    seats: null,
    snapshot: null,
    status: 'open',
    statusDetail: null,
    notice: null,
    hostPassword: null,
    recovery: null,
    selectedCard: null,
    selectedBid: null,
    busy: false,
    log: [],
  };
}

function snapshotFixture(overrides: Record<string, unknown> = {}): any {
  return {
    room: {
      id: 'testroom',
      status: 'active',
      rulesVersion: 1,
      revision: 12,
      presenceVersion: 3,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      expiryWarning: false,
    },
    you: { seat: 0, team: 0, name: 'You', ready: true, isHost: true },
    seats: [
      { seat: 0, team: 0, name: 'You', connected: true, ready: true, isHost: true, isYou: true },
      { seat: 1, team: 1, name: 'Left', connected: true, ready: true, isHost: false, isYou: false },
      { seat: 2, team: 0, name: 'Partner', connected: true, ready: true, isHost: false, isYou: false },
      { seat: 3, team: 1, name: 'Right', connected: true, ready: true, isHost: false, isYou: false },
    ],
    password: null,
    canStart: false,
    paused: null,
    match: {
      rulesVersion: 1,
      phase: 'PLAYING',
      dealer: 3,
      handNumber: 1,
      scores: [0, 0],
      matchResult: null,
      continues: [],
      history: [],
      you: { seat: 0, team: 0 },
      hand: {
        handNumber: 1,
        dealer: 3,
        bidder: 0,
        bidderTeam: 0,
        bid: 18,
        stake: 2,
        trumpMode: 'suit',
        trumpStatus: 'hidden',
        trump: 'S',
        revealedBy: null,
        auction: { turn: 0, highBid: 18, highBidder: 0, history: [{ seat: 0, action: 'bid', value: 18 }] },
        doubling: { actor: null, doubledBy: 1, redoubledBy: null, defenderDecisions: [], bidderDecisions: [] },
        turn: 0,
        currentTrick: { index: 0, leader: 0, plays: [] },
        tricks: [],
        trickNumber: 1,
        cardCounts: { 0: 8, 1: 8, 2: 8, 3: 8 },
        yourCards: ['SJ', 'S9', 'HA', 'HT', 'DK', 'DQ', 'C8', 'C7'],
        reservedCard: null,
        reservedHeld: false,
        ack: null,
        pair: null,
        result: null,
      },
      actions: {
        bids: [],
        canPass: false,
        canChooseTrump: false,
        canDouble: false,
        canRedouble: false,
        canPassDouble: false,
        canPassRedouble: false,
        legalCards: ['SJ', 'S9'],
        canRevealTrump: false,
        canDeclarePair: false,
        canContinueTrick: false,
        canNextHand: false,
        canRematch: false,
      },
      ...(overrides.match as Record<string, unknown>),
    },
    ...overrides,
  };
}

describe('client screens', () => {
  before(() => {
    assert.ok(views.homeView);
  });

  it('offers creating and joining from the home screen, with the rules drawer', () => {
    const element = views.homeView(baseState(), noopActions);
    const text = element.textContent ?? '';
    assert.match(text, /Create game/);
    assert.match(text, /Join a game/);
    assert.match(text, /Rules of this table/);
    assert.match(text, /Jack 3 points/, 'the drawer renders the engine rule text');
    assert.ok(element.querySelector('label[for="room"]'), 'the room field is labelled');
  });

  it('labels every field on the create screen and offers all four seats', () => {
    const element = views.createView(baseState(), noopActions);
    assert.ok(element.querySelector('label[for="name"]'));
    assert.equal(element.querySelectorAll('input[name="seat"]').length, 4);
    assert.match(element.textContent ?? '', /Seat 1 — Team A/);
  });

  it('asks only for the password at the gate and never shows the roster', () => {
    const element = views.gateView(baseState(), noopActions);
    assert.ok(element.querySelector('input[type="password"]'));
    assert.doesNotMatch(element.textContent ?? '', /Seat 2/);
    assert.match(element.textContent ?? '', /Recovery code/, 'recovery is reachable from the gate');
  });

  it('shows free seats and marks taken ones on the join screen', () => {
    const state = baseState();
    state.seats = [
      { seat: 0, team: 0, name: 'Host' },
      { seat: 1, team: 1, name: null },
      { seat: 2, team: 0, name: null },
      { seat: 3, team: 1, name: null },
    ];
    const element = views.joinView(state, noopActions);
    assert.equal(element.querySelectorAll('input[name="seat"]').length, 3);
    assert.match(element.textContent ?? '', /Host \(taken\)/);
  });

  it('renders the table with the local player at the bottom and legal cards only', () => {
    const state = baseState();
    state.snapshot = snapshotFixture();
    const element = views.roomView(state, noopActions);

    assert.ok(element.querySelector('.seat-box.you'));
    assert.ok(element.querySelector('.seat-box.partner'));
    assert.match(element.querySelector('.seat-box.partner')?.textContent ?? '', /Partner/);
    assert.match(element.textContent ?? '', /Trick.*1 of 8/s);
    assert.match(element.textContent ?? '', /×2/, 'the stake is visible');

    const cardButtons = [...element.querySelectorAll('button.card')];
    assert.equal(cardButtons.length, 8);
    const enabled = cardButtons.filter((button) => !button.hasAttribute('disabled'));
    assert.equal(enabled.length, 2, 'only legal cards are enabled');
    assert.equal(enabled[0]?.getAttribute('aria-label'), 'Jack of Spades');
    assert.equal(
      (element.querySelector('button[data-focus="play"]') as HTMLButtonElement).hasAttribute('disabled'),
      true,
      'confirmation is required before a card is played',
    );
  });

  it('keeps hidden trump private to its owner and shows others only a status', () => {
    const own = baseState();
    own.snapshot = snapshotFixture();
    assert.match(views.roomView(own, noopActions).textContent ?? '', /Hidden \(yours: Spades\)/);

    const other = baseState();
    const snapshot = snapshotFixture();
    snapshot.you = { seat: 1, team: 1, name: 'Left', ready: true, isHost: false };
    snapshot.match.hand.trump = null;
    snapshot.match.hand.bidder = 0;
    other.snapshot = snapshot;
    const text = views.roomView(other, noopActions).textContent ?? '';
    assert.match(text, /Trump\s*Hidden/);
    assert.doesNotMatch(text, /Spades/);
  });

  it('shows the reserved seventh card separately and never as a playable button', () => {
    const state = baseState();
    const snapshot = snapshotFixture();
    snapshot.match.hand.trumpMode = 'seventh';
    snapshot.match.hand.yourCards = ['SJ', 'S9', 'HA', 'HT', 'DK', 'DQ', 'C8'];
    snapshot.match.hand.reservedCard = { card: 'C7', suit: 'C' };
    snapshot.match.hand.reservedHeld = true;
    state.snapshot = snapshot;
    const element = views.roomView(state, noopActions);
    assert.equal(element.querySelectorAll('button.card').length, 7);
    assert.ok(element.querySelector('.card.reserved'), 'the reserved card is shown apart');
    assert.match(element.textContent ?? '', /Reserved seventh card/);
  });

  it('gives every player the same between-trick window', () => {
    const state = baseState();
    const snapshot = snapshotFixture();
    snapshot.match.hand.ack = { trickIndex: 0, acknowledged: [1] };
    snapshot.match.hand.tricks = [
      { index: 0, leader: 0, plays: [], winner: 2, points: 5, trumpLive: true },
    ];
    snapshot.match.actions.legalCards = [];
    snapshot.match.actions.canContinueTrick = true;
    snapshot.match.actions.canDeclarePair = false;
    state.snapshot = snapshot;
    const element = views.roomView(state, noopActions);
    assert.match(element.textContent ?? '', /Between tricks/);
    assert.ok(element.querySelector('button[data-focus="continue"]'));
    assert.equal(element.querySelector('button[data-focus="declare"]'), null);
  });

  it('explains an annulled hand in the result panel', () => {
    const state = baseState();
    const snapshot = snapshotFixture();
    snapshot.match.phase = 'HAND_RESULT';
    snapshot.match.hand.result = {
      handNumber: 1,
      dealer: 3,
      bidder: 0,
      bidderTeam: 0,
      bid: 18,
      trumpMode: 'suit',
      trump: null,
      trumpRevealed: false,
      pairAdjustment: 0,
      target: 18,
      capturedPoints: [14, 14],
      stake: 2,
      annulled: true,
      contractMade: null,
      scoreDelta: [0, 0],
      scoresAfter: [0, 0],
      pair: null,
    };
    snapshot.match.actions.canNextHand = true;
    state.snapshot = snapshot;
    const element = views.roomView(state, noopActions);
    assert.match(element.textContent ?? '', /Hand annulled: trump was not revealed/);
    assert.ok(element.querySelector('button[data-focus="next-hand"]'));
  });

  it('shows the pause message and recovery options while a seat is away', () => {
    const state = baseState();
    const snapshot = snapshotFixture();
    snapshot.paused = { reason: 'disconnected', seats: [3] };
    state.snapshot = snapshot;
    const element = views.roomView(state, noopActions);
    assert.match(element.textContent ?? '', /Waiting for Right to reconnect/);
    assert.match(element.textContent ?? '', /End match, no winner/);
  });

  it('announces a paused connection at the top of the table', () => {
    const state = baseState();
    state.status = 'reconnecting';
    state.snapshot = snapshotFixture();
    const element = views.roomView(state, noopActions);
    assert.match(element.querySelector('.banner')?.textContent ?? '', /Reconnecting—actions paused/);
  });

  it('keeps every interactive control reachable by keyboard', () => {
    const state = baseState();
    state.snapshot = snapshotFixture();
    const element = views.roomView(state, noopActions);
    for (const node of element.querySelectorAll('[onclick]')) {
      assert.equal(node.tagName, 'BUTTON', 'click targets are real buttons');
    }
    assert.equal(element.querySelectorAll('a[href="#"]').length, 0);
  });
});
