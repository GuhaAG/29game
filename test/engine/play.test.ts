import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CardId } from '../../src/engine/cards';
import { handPoints } from '../../src/engine/cards';
import { projectFor } from '../../src/engine/projection';
import type { MatchState, Seat } from '../../src/engine/types';
import {
  ackAll,
  apply,
  applyAll,
  assertCardConservation,
  autoPlayHand,
  expectRejected,
  newHand,
  winAuction,
  type HandSpec,
} from './helpers';

const DEALER = 3 as const;

const BASE: HandSpec = {
  0: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'ST'],
  1: ['HK', 'HQ', 'H8', 'H7', 'CJ', 'C9', 'CA', 'CT'],
  2: ['DJ', 'D9', 'DA', 'DT', 'SK', 'SQ', 'CK', 'CQ'],
  3: ['DK', 'DQ', 'D8', 'D7', 'S8', 'S7', 'C8', 'C7'],
};

const BIDDER_VOID: HandSpec = {
  0: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'ST'],
  1: ['CJ', 'C9', 'CA', 'CT', 'SK', 'SQ', 'S8', 'S7'],
  2: ['HK', 'HQ', 'H8', 'H7', 'DJ', 'D9', 'DA', 'DT'],
  3: ['CK', 'CQ', 'C8', 'C7', 'DK', 'DQ', 'D8', 'D7'],
};

/** Auction won by `bidder` at `bid`, trump suit chosen, both defenders pass. */
function setupPlay(spec: HandSpec, bidder: Seat = 0, bid = 16, trump: 'S' | 'H' | 'D' | 'C' = 'S'): MatchState {
  let state = winAuction(newHand(DEALER, spec), bidder, bid);
  state = apply(state, { type: 'chooseTrump', seat: bidder, mode: 'suit', suit: trump });
  while (state.phase === 'DOUBLE_WINDOW') {
    const seat = state.hand?.doubling.pending[0] as Seat;
    state = apply(state, { type: 'passDouble', seat });
  }
  return state;
}

describe('play, following suit and reveal', () => {
  it('deals the second batch only after doubling and starts play left of the dealer', () => {
    const state = setupPlay(BASE);
    assert.equal(state.phase, 'PLAYING');
    assert.equal(state.hand?.turn, 0);
    assert.equal(state.hand?.currentTrick.leader, 0);
    for (const seat of [0, 1, 2, 3] as const) assert.equal(state.hand?.hands[seat].length, 8);
    assertCardConservation(state);
  });

  it('requires following the led suit', () => {
    const state = apply(setupPlay(BASE), { type: 'playCard', seat: 0, card: 'HJ' });
    assert.deepEqual(projectFor(state, 1).actions.legalCards.sort(), ['H7', 'H8', 'HK', 'HQ']);
    expectRejected(state, { type: 'playCard', seat: 1, card: 'CJ' }, 'ILLEGAL_MOVE');
    expectRejected(state, { type: 'playCard', seat: 2, card: 'DJ' }, 'NOT_YOUR_TURN');
  });

  it('never offers reveal while leading or while able to follow', () => {
    const lead = setupPlay(BASE);
    assert.equal(projectFor(lead, 0).actions.canRevealTrump, false);
    expectRejected(lead, { type: 'revealTrump', seat: 0 }, 'ILLEGAL_MOVE');
    const following = apply(lead, { type: 'playCard', seat: 0, card: 'HJ' });
    assert.equal(projectFor(following, 1).actions.canRevealTrump, false);
    expectRejected(following, { type: 'revealTrump', seat: 1 }, 'ILLEGAL_MOVE');
  });

  it('lets a void player discard without revealing', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
    ]);
    assert.equal(projectFor(state, 2).actions.canRevealTrump, true);
    assert.equal(projectFor(state, 2).actions.legalCards.length, 8);
    state = apply(state, { type: 'playCard', seat: 2, card: 'DJ' });
    assert.equal(state.hand?.trumpRevealed, false);
    assert.equal(projectFor(state, 3).hand?.trumpStatus, 'hidden');
  });

  it('forces the revealing player to trump, and applies trump to the whole trick', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'revealTrump', seat: 2 },
    ]);
    assert.equal(state.hand?.trumpRevealed, true);
    assert.deepEqual(projectFor(state, 2).actions.legalCards.sort(), ['SK', 'SQ']);
    expectRejected(state, { type: 'playCard', seat: 2, card: 'DJ' }, 'ILLEGAL_MOVE');
    state = apply(state, { type: 'playCard', seat: 2, card: 'SQ' });
    // Seat 3 is void in hearts but did not request the reveal: free to discard.
    assert.equal(projectFor(state, 3).actions.legalCards.length, 8);
    state = apply(state, { type: 'playCard', seat: 3, card: 'D7' });
    const trick = state.hand?.tricks[0];
    assert.equal(trick?.winner, 2, 'the trump wins even though it was played after the lead');
    assert.equal(trick?.trumpLive, true);
    assert.equal(trick?.points, 3);
  });

  it('counts trump played earlier in the reveal trick', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'playCard', seat: 2, card: 'SK' }, // discarded while trump was still hidden
      { type: 'revealTrump', seat: 3 },
    ]);
    assert.deepEqual(projectFor(state, 3).actions.legalCards.sort(), ['S7', 'S8']);
    state = apply(state, { type: 'playCard', seat: 3, card: 'S8' });
    assert.equal(state.hand?.tricks[0]?.winner, 2, 'the earlier king of trump outranks the eight');
  });

  it('lets the contract holder reveal and leaves completed tricks untouched', () => {
    let state = applyAll(setupPlay(BIDDER_VOID, 1), [{ type: 'playCard', seat: 0, card: 'H9' }]);
    assert.equal(projectFor(state, 1).actions.canRevealTrump, true);
    state = applyAll(state, [
      { type: 'revealTrump', seat: 1 },
      { type: 'playCard', seat: 1, card: 'S7' },
      { type: 'playCard', seat: 2, card: 'HK' },
      { type: 'playCard', seat: 3, card: 'CK' },
    ]);
    assert.equal(state.hand?.tricks[0]?.winner, 1);
    assert.equal(state.hand?.revealedBy, 1);
  });

  it('keeps a trick completed before the reveal unchanged', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'playCard', seat: 2, card: 'SK' },
      { type: 'playCard', seat: 3, card: 'S8' },
    ]);
    const first = structuredClone(state.hand?.tricks[0]);
    assert.equal(first?.winner, 0, 'hidden trump has no power');
    assert.equal(first?.trumpLive, false);
    state = ackAll(state);
    state = applyAll(state, [
      { type: 'playCard', seat: 0, card: 'H9' },
      { type: 'playCard', seat: 1, card: 'HQ' },
      { type: 'revealTrump', seat: 2 },
      { type: 'playCard', seat: 2, card: 'SQ' },
      { type: 'playCard', seat: 3, card: 'S7' },
    ]);
    assert.deepEqual(state.hand?.tricks[0], first);
  });

  it('opens the same acknowledgment window after every non-final trick', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'playCard', seat: 2, card: 'DJ' },
      { type: 'playCard', seat: 3, card: 'DK' },
    ]);
    assert.ok(state.hand?.ack);
    for (const seat of [0, 1, 2, 3] as const) {
      assert.equal(projectFor(state, seat).actions.canContinueTrick, true);
      assert.equal(projectFor(state, seat).actions.canDeclarePair, false);
      assert.deepEqual(projectFor(state, seat).actions.legalCards, []);
    }
    expectRejected(state, { type: 'playCard', seat: 0, card: 'H9' }, 'WRONG_PHASE');
    state = ackAll(state, [3]);
    assert.ok(state.hand?.ack, 'the window stays open until all four continue');
    expectRejected(state, { type: 'continueTrick', seat: 0 }, 'ILLEGAL_MOVE');
    state = ackAll(state);
    assert.equal(state.hand?.ack, null);
    assert.equal(state.hand?.turn, 0);
  });

  it('annuls the hand when trump is never revealed', () => {
    let state = autoPlayHand(setupPlay(BASE));
    assert.equal(state.phase, 'HAND_RESULT');
    const result = state.hand?.result;
    assert.equal(result?.annulled, true);
    assert.equal(result?.contractMade, null);
    assert.deepEqual(result?.scoreDelta, [0, 0]);
    assert.deepEqual(state.scores, [0, 0]);
    state = applyAll(state, [
      { type: 'nextHand', seat: 0 },
      { type: 'nextHand', seat: 1 },
      { type: 'nextHand', seat: 2 },
      { type: 'nextHand', seat: 3 },
    ]);
    assert.equal(state.phase, 'DEAL_FIRST');
    assert.equal(state.dealer, 0, 'the deal rotates after an annulled hand');
    assert.equal(state.handNumber, 2);
  });

  it('accounts for all 32 cards and 28 card points in a completed hand', () => {
    let state = applyAll(setupPlay(BASE), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'revealTrump', seat: 2 },
      { type: 'playCard', seat: 2, card: 'SQ' },
      { type: 'playCard', seat: 3, card: 'D7' },
    ]);
    state = autoPlayHand(state);
    assert.equal(state.phase, 'HAND_RESULT');
    const played: CardId[] = [];
    for (const trick of state.hand?.tricks ?? []) {
      assert.equal(trick.plays.length, 4);
      for (const play of trick.plays) played.push(play.card);
    }
    assert.equal(played.length, 32);
    assert.equal(new Set(played).size, 32);
    assert.equal(handPoints(played), 28);
    const captured = state.hand?.result?.capturedPoints as [number, number];
    assert.equal(captured[0] + captured[1], 28);
  });
});
