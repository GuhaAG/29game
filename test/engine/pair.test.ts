import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectFor } from '../../src/engine/projection';
import type { MatchState, Seat } from '../../src/engine/types';
import { ackAll, apply, applyAll, expectRejected, newHand, winAuction, type HandSpec } from './helpers';

const DEALER = 3 as const;

/** Seat 2 (bidder's partner) holds the trump king and queen. */
const BIDDER_PAIR: HandSpec = {
  0: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'ST'],
  1: ['HK', 'HQ', 'H8', 'H7', 'CJ', 'C9', 'CA', 'CT'],
  2: ['DJ', 'D9', 'DA', 'DT', 'SK', 'SQ', 'CK', 'CQ'],
  3: ['DK', 'DQ', 'D8', 'D7', 'S8', 'S7', 'C8', 'C7'],
};

/** The honours are split between partners. */
const SPLIT_PAIR: HandSpec = {
  0: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'SK'],
  1: ['HK', 'HQ', 'H8', 'H7', 'CJ', 'C9', 'CA', 'CT'],
  2: ['DJ', 'D9', 'DA', 'DT', 'ST', 'SQ', 'CK', 'CQ'],
  3: ['DK', 'DQ', 'D8', 'D7', 'S8', 'S7', 'C8', 'C7'],
};

/** Seat 3 (a defender) holds the trump king and queen. */
const DEFENDER_PAIR: HandSpec = {
  0: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'ST'],
  1: ['HK', 'HQ', 'H8', 'H7', 'CJ', 'C9', 'CA', 'CT'],
  2: ['DJ', 'D9', 'DA', 'DT', 'S8', 'S7', 'CK', 'CQ'],
  3: ['DK', 'DQ', 'D8', 'D7', 'SK', 'SQ', 'C8', 'C7'],
};

function setupPlay(spec: HandSpec, bid: number): MatchState {
  let state = winAuction(newHand(DEALER, spec), 0, bid);
  state = apply(state, { type: 'chooseTrump', seat: 0, mode: 'suit', suit: 'S' });
  while (state.phase === 'DOUBLE_WINDOW') {
    const seat = state.hand?.doubling.pending[0] as Seat;
    state = apply(state, { type: 'passDouble', seat });
  }
  return state;
}

/** Trick 1: seat 3 reveals and trumps, so the defenders take it. */
function afterDefenderTrick(state: MatchState): MatchState {
  return applyAll(state, [
    { type: 'playCard', seat: 0, card: 'HJ' },
    { type: 'playCard', seat: 1, card: 'HK' },
    { type: 'playCard', seat: 2, card: 'DJ' },
    { type: 'revealTrump', seat: 3 },
    { type: 'playCard', seat: 3, card: 'S7' },
  ]);
}

/** Trick 2: seat 0 trumps the diamond lead, so the bidding team takes it. */
function afterBidderTrick(state: MatchState, seat2Discard = 'D9'): MatchState {
  return applyAll(ackAll(state), [
    { type: 'playCard', seat: 3, card: 'DK' },
    { type: 'playCard', seat: 0, card: 'SJ' },
    { type: 'playCard', seat: 1, card: 'CJ' },
    { type: 'playCard', seat: 2, card: seat2Discard },
  ]);
}

describe('marriage (pair)', () => {
  it('is unavailable before trump is revealed', () => {
    const state = applyAll(setupPlay(BIDDER_PAIR, 20), [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'playCard', seat: 2, card: 'DJ' },
      { type: 'playCard', seat: 3, card: 'DK' },
    ]);
    assert.equal(state.hand?.tricks[0]?.winner, 0);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, false);
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
  });

  it('is unavailable when the other team won the trick', () => {
    const state = afterDefenderTrick(setupPlay(BIDDER_PAIR, 20));
    assert.equal(state.hand?.tricks[0]?.winner, 3);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, false);
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
  });

  it('lowers the bidding team’s target by four and keeps the cards in hand', () => {
    let state = afterBidderTrick(afterDefenderTrick(setupPlay(BIDDER_PAIR, 20)));
    assert.equal(state.hand?.tricks[1]?.winner, 0);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, true);
    state = apply(state, { type: 'declarePair', seat: 2 });
    assert.equal(state.hand?.pair?.adjustment, -4);
    assert.deepEqual(state.hand?.pair?.cards.sort(), ['SK', 'SQ']);
    assert.ok(state.hand?.hands[2].includes('SK'));
    assert.ok(state.hand?.hands[2].includes('SQ'));
    assert.ok(state.hand?.ack?.acknowledged.includes(2), 'declaring also acknowledges');
    assert.equal(projectFor(state, 2).actions.canContinueTrick, false);
    expectRejected(state, { type: 'continueTrick', seat: 2 }, 'ILLEGAL_MOVE');
  });

  it('raises the target by four when the defenders declare', () => {
    let state = setupPlay(DEFENDER_PAIR, 20);
    state = applyAll(state, [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'revealTrump', seat: 2 },
      { type: 'playCard', seat: 2, card: 'S7' },
      { type: 'playCard', seat: 3, card: 'D7' },
    ]);
    assert.equal(state.hand?.tricks[0]?.winner, 2);
    assert.equal(projectFor(state, 3).actions.canDeclarePair, false);
    state = applyAll(ackAll(state), [
      { type: 'playCard', seat: 2, card: 'CK' },
      { type: 'playCard', seat: 3, card: 'C7' },
      { type: 'playCard', seat: 0, card: 'HA' },
      { type: 'playCard', seat: 1, card: 'CJ' },
    ]);
    assert.equal(state.hand?.tricks[1]?.winner, 1, 'the jack is the strongest club');
    assert.equal(projectFor(state, 3).actions.canDeclarePair, true);
    state = apply(state, { type: 'declarePair', seat: 3 });
    assert.equal(state.hand?.pair?.adjustment, 4);
    assert.equal(state.hand?.pair?.team, 1);
  });

  it('clamps the adjusted target to 16–28', () => {
    let low = afterBidderTrick(afterDefenderTrick(setupPlay(BIDDER_PAIR, 18)));
    low = apply(low, { type: 'declarePair', seat: 2 });
    const lowTarget = low.hand?.pair ? Math.min(28, Math.max(16, 18 + low.hand.pair.adjustment)) : 0;
    assert.equal(lowTarget, 16);

    let high = setupPlay(DEFENDER_PAIR, 28);
    high = applyAll(high, [
      { type: 'playCard', seat: 0, card: 'HJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
      { type: 'revealTrump', seat: 2 },
      { type: 'playCard', seat: 2, card: 'S7' },
      { type: 'playCard', seat: 3, card: 'D7' },
    ]);
    high = applyAll(ackAll(high), [
      { type: 'playCard', seat: 2, card: 'CK' },
      { type: 'playCard', seat: 3, card: 'C7' },
      { type: 'playCard', seat: 0, card: 'HA' },
      { type: 'playCard', seat: 1, card: 'CJ' },
    ]);
    high = apply(high, { type: 'declarePair', seat: 3 });
    const highTarget = Math.min(28, Math.max(16, 28 + (high.hand?.pair?.adjustment ?? 0)));
    assert.equal(highTarget, 28);
  });

  it('is unavailable when the honours are split between partners', () => {
    const state = afterBidderTrick(afterDefenderTrick(setupPlay(SPLIT_PAIR, 20)), 'DT');
    assert.equal(state.hand?.tricks[1]?.winner, 0);
    assert.equal(projectFor(state, 0).actions.canDeclarePair, false);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, false);
    expectRejected(state, { type: 'declarePair', seat: 0 }, 'ILLEGAL_MOVE');
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
  });

  it('is unavailable once one of the honours has been played', () => {
    let state = afterBidderTrick(afterDefenderTrick(setupPlay(BIDDER_PAIR, 20)));
    state = ackAll(state);
    state = applyAll(state, [
      { type: 'playCard', seat: 0, card: 'H9' },
      { type: 'playCard', seat: 1, card: 'H8' },
      { type: 'playCard', seat: 2, card: 'SQ' }, // spends an honour as a discard
      { type: 'playCard', seat: 3, card: 'C8' },
    ]);
    assert.equal(state.hand?.tricks[2]?.winner, 2, 'the discarded trump takes the trick');
    assert.equal(projectFor(state, 2).actions.canDeclarePair, false, 'only the king is left');
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
  });

  it('allows a skipped declaration to be made after a later qualifying trick', () => {
    let state = afterBidderTrick(afterDefenderTrick(setupPlay(BIDDER_PAIR, 20)));
    state = ackAll(state); // everyone continues; seat 2 declines to declare
    assert.equal(state.hand?.pair, null);
    state = applyAll(state, [
      { type: 'playCard', seat: 0, card: 'H9' },
      { type: 'playCard', seat: 1, card: 'H8' },
      { type: 'playCard', seat: 2, card: 'CK' },
      { type: 'playCard', seat: 3, card: 'C8' },
    ]);
    assert.equal(state.hand?.tricks[2]?.winner, 0);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, true);
    state = apply(state, { type: 'declarePair', seat: 2 });
    assert.equal(state.hand?.pair?.trickIndex, 2);
  });

  it('records at most one marriage per hand', () => {
    let state = afterBidderTrick(afterDefenderTrick(setupPlay(BIDDER_PAIR, 20)));
    state = apply(state, { type: 'declarePair', seat: 2 });
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
    state = ackAll(state);
    state = applyAll(state, [
      { type: 'playCard', seat: 0, card: 'H9' },
      { type: 'playCard', seat: 1, card: 'H8' },
      { type: 'playCard', seat: 2, card: 'CK' },
      { type: 'playCard', seat: 3, card: 'C8' },
    ]);
    assert.equal(projectFor(state, 2).actions.canDeclarePair, false);
    expectRejected(state, { type: 'declarePair', seat: 2 }, 'ILLEGAL_MOVE');
  });
});
