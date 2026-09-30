import assert from 'node:assert/strict';
import { FULL_DECK, type CardId } from '../../src/engine/cards';
import {
  applyCommand,
  accountedCards,
  createMatch,
  dealOrder,
  startHand,
} from '../../src/engine/engine';
import { projectFor } from '../../src/engine/projection';
import type { EngineCommand, EngineEvent, MatchState, Seat } from '../../src/engine/types';
import { SEATS } from '../../src/engine/types';

export interface HandSpec {
  0: CardId[];
  1: CardId[];
  2: CardId[];
  3: CardId[];
}

/**
 * Builds the deck order that deals exactly `spec` when `dealer` deals, so tests
 * can state the hands they want instead of the shuffle that produces them.
 * Each seat's array is that seat's personal deal order (index 6 is the seventh card).
 */
export function deckFromHands(dealer: Seat, spec: HandSpec): CardId[] {
  const order = dealOrder(dealer);
  const deck: CardId[] = new Array(32);
  order.forEach((seat, offset) => {
    const cards = spec[seat];
    assert.equal(cards.length, 8, `seat ${seat} needs 8 cards`);
    cards.forEach((card, round) => {
      deck[round * 4 + offset] = card;
    });
  });
  const unique = new Set(deck);
  assert.equal(unique.size, 32, 'hand specification must use 32 distinct cards');
  for (const card of deck) assert.ok(FULL_DECK.includes(card), `unknown card ${card}`);
  return deck;
}

/** Fills the remaining cards of a partial specification from the unused deck. */
export function completeSpec(partial: Partial<Record<Seat, CardId[]>>): HandSpec {
  const used = new Set<CardId>();
  for (const seat of SEATS) for (const card of partial[seat] ?? []) used.add(card);
  const pool = FULL_DECK.filter((card) => !used.has(card));
  const spec = {} as HandSpec;
  for (const seat of SEATS) {
    const cards = [...(partial[seat] ?? [])];
    while (cards.length < 8) cards.push(pool.shift() as CardId);
    spec[seat] = cards;
  }
  return spec;
}

export function newHand(dealer: Seat, spec: HandSpec): MatchState {
  const state = createMatch(dealer);
  return startHand(state, deckFromHands(dealer, spec)).state;
}

export function apply(state: MatchState, command: EngineCommand): MatchState {
  return applyCommand(state, command).state;
}

export function applyAll(state: MatchState, commands: EngineCommand[]): MatchState {
  return commands.reduce((current, command) => apply(current, command), state);
}

export function eventsOf(state: MatchState, command: EngineCommand): EngineEvent[] {
  return applyCommand(state, command).events;
}

export function expectRejected(
  state: MatchState,
  command: EngineCommand,
  code?: 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'ILLEGAL_MOVE',
): void {
  const before = structuredClone(state);
  assert.throws(
    () => applyCommand(state, command),
    (error: unknown) => {
      const engineError = error as { name?: string; code?: string };
      assert.equal(engineError.name, 'EngineError');
      if (code) assert.equal(engineError.code, code, `expected ${code}, got ${engineError.code}`);
      return true;
    },
  );
  assert.deepEqual(state, before, 'a rejected command must not change state');
}

/** Everyone acknowledges the between-trick window, in seat order. */
export function ackAll(state: MatchState, skip: Seat[] = []): MatchState {
  let current = state;
  for (const seat of SEATS) {
    if (skip.includes(seat)) continue;
    if (current.hand?.ack && !current.hand.ack.acknowledged.includes(seat)) {
      current = apply(current, { type: 'continueTrick', seat });
    }
  }
  return current;
}

/** Wins the auction for `seat` at `value` with everyone else passing. */
export function winAuction(state: MatchState, seat: Seat, value: number): MatchState {
  let current = state;
  while (current.phase === 'BIDDING') {
    const turn = current.hand?.auction.turn as Seat;
    current =
      turn === seat && current.hand?.auction.highBidder !== seat
        ? apply(current, { type: 'bid', seat, value })
        : apply(current, { type: 'pass', seat: turn });
  }
  return current;
}

export function assertCardConservation(state: MatchState): void {
  const cards = accountedCards(state);
  assert.equal(cards.length, 32, 'all 32 cards must be accounted for');
  assert.equal(new Set(cards).size, 32, 'no duplicated cards');
}

/** Plays the first legal card for whoever is on turn, acknowledging between tricks. */
export function autoPlayHand(state: MatchState): MatchState {
  let current = state;
  let guard = 0;
  while (current.phase === 'PLAYING') {
    guard += 1;
    if (guard > 200) throw new Error('hand did not finish');
    if (current.hand?.ack) {
      current = ackAll(current);
      continue;
    }
    const seat = current.hand?.turn as Seat;
    const card = projectFor(current, seat).actions.legalCards[0] as CardId;
    current = apply(current, { type: 'playCard', seat, card });
    assertCardConservation(current);
  }
  return current;
}
