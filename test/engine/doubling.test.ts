import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RANKS, type CardId } from '../../src/engine/cards';
import { projectFor } from '../../src/engine/projection';
import type { MatchState, Seat } from '../../src/engine/types';
import {
  ackAll,
  apply,
  applyAll,
  autoPlayHand,
  expectRejected,
  newHand,
  winAuction,
  type HandSpec,
} from './helpers';

const DEALER = 3 as const;

/** One suit per seat: seat 0 holds every spade and takes every trick. */
const SWEEP: HandSpec = {
  0: RANKS.map((rank) => `S${rank}` as CardId),
  1: RANKS.map((rank) => `H${rank}` as CardId),
  2: RANKS.map((rank) => `D${rank}` as CardId),
  3: RANKS.map((rank) => `C${rank}` as CardId),
};

function auctionTo(bidder: Seat, bid: number): MatchState {
  return winAuction(newHand(DEALER, SWEEP), bidder, bid);
}

function chooseSpades(state: MatchState): MatchState {
  const bidder = state.hand?.bidder as Seat;
  return apply(state, { type: 'chooseTrump', seat: bidder, mode: 'suit', suit: 'S' });
}

/** Trick 1: seat 1 reveals (holding no trump) and seat 0 takes the trick. */
function firstTrick(state: MatchState): MatchState {
  return applyAll(state, [
    { type: 'playCard', seat: 0, card: 'SJ' },
    { type: 'revealTrump', seat: 1 },
    { type: 'playCard', seat: 1, card: 'HJ' },
    { type: 'playCard', seat: 2, card: 'DJ' },
    { type: 'playCard', seat: 3, card: 'CJ' },
  ]);
}

describe('double and redouble', () => {
  it('asks the two defenders in clockwise order after the bidder', () => {
    const state = chooseSpades(auctionTo(0, 20));
    assert.equal(state.phase, 'DOUBLE_WINDOW');
    assert.deepEqual(state.hand?.doubling.pending, [1, 3]);
    assert.equal(projectFor(state, 1).actions.canDouble, true);
    assert.equal(projectFor(state, 3).actions.canDouble, false, 'only the acting defender may decide');
    assert.equal(projectFor(state, 0).actions.canDouble, false);
    expectRejected(state, { type: 'double', seat: 0 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'double', seat: 2 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'double', seat: 3 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'redouble', seat: 0 }, 'WRONG_PHASE');
  });

  it('blocks the second deal until every decision is made', () => {
    let state = chooseSpades(auctionTo(0, 20));
    assert.equal(state.hand?.hands[0].length, 4);
    expectRejected(state, { type: 'playCard', seat: 0, card: 'SJ' }, 'WRONG_PHASE');
    state = apply(state, { type: 'passDouble', seat: 1 });
    assert.equal(state.phase, 'DOUBLE_WINDOW');
    assert.equal(state.hand?.hands[0].length, 4);
    state = apply(state, { type: 'passDouble', seat: 3 });
    assert.equal(state.phase, 'PLAYING');
    assert.equal(state.hand?.stake, 1);
    assert.equal(state.hand?.hands[0].length, 8);
  });

  it('sets the stake to 2 when either defender doubles', () => {
    const early = apply(chooseSpades(auctionTo(0, 20)), { type: 'double', seat: 1 });
    assert.equal(early.hand?.stake, 2);
    assert.equal(early.phase, 'REDOUBLE_WINDOW');
    assert.deepEqual(early.hand?.doubling.pending, [0, 2]);

    const late = applyAll(chooseSpades(auctionTo(0, 20)), [
      { type: 'passDouble', seat: 1 },
      { type: 'double', seat: 3 },
    ]);
    assert.equal(late.hand?.stake, 2);
    assert.equal(late.hand?.doubling.doubledBy, 3);
    assert.equal(late.phase, 'REDOUBLE_WINDOW');
  });

  it('closes the window after the first double and allows no further raises', () => {
    const state = apply(chooseSpades(auctionTo(0, 20)), { type: 'double', seat: 1 });
    expectRejected(state, { type: 'double', seat: 3 }, 'WRONG_PHASE');
    const redoubled = apply(state, { type: 'redouble', seat: 0 });
    assert.equal(redoubled.hand?.stake, 4);
    expectRejected(redoubled, { type: 'redouble', seat: 2 }, 'WRONG_PHASE');
    expectRejected(redoubled, { type: 'double', seat: 3 }, 'WRONG_PHASE');
  });

  it('lets either member of the bidding side redouble, and leaves the stake at 2 if both pass', () => {
    const byPartner = applyAll(chooseSpades(auctionTo(0, 20)), [
      { type: 'double', seat: 1 },
      { type: 'passRedouble', seat: 0 },
      { type: 'redouble', seat: 2 },
    ]);
    assert.equal(byPartner.hand?.stake, 4);
    assert.equal(byPartner.phase, 'PLAYING');

    const bothPass = applyAll(chooseSpades(auctionTo(0, 20)), [
      { type: 'double', seat: 1 },
      { type: 'passRedouble', seat: 0 },
      { type: 'passRedouble', seat: 2 },
    ]);
    assert.equal(bothPass.hand?.stake, 2);
    assert.equal(bothPass.phase, 'PLAYING');
  });

  it('rejects defenders redoubling and bidders doubling', () => {
    const state = apply(chooseSpades(auctionTo(0, 20)), { type: 'double', seat: 1 });
    expectRejected(state, { type: 'redouble', seat: 1 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'redouble', seat: 3 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'passRedouble', seat: 2 }, 'NOT_YOUR_TURN');
  });
});

describe('scoring', () => {
  function playOut(state: MatchState): MatchState {
    return autoPlayHand(ackAll(firstTrick(state)));
  }

  it('awards +1 to the bidding team at the base stake', () => {
    const state = playOut(
      applyAll(chooseSpades(auctionTo(0, 20)), [
        { type: 'passDouble', seat: 1 },
        { type: 'passDouble', seat: 3 },
      ]),
    );
    const result = state.hand?.result;
    assert.deepEqual(result?.capturedPoints, [28, 0]);
    assert.equal(result?.stake, 1);
    assert.equal(result?.contractMade, true);
    assert.deepEqual(result?.scoreDelta, [1, 0]);
    assert.deepEqual(state.scores, [1, 0]);
  });

  it('awards +2 when doubled and +4 when redoubled', () => {
    const doubled = playOut(
      applyAll(chooseSpades(auctionTo(0, 20)), [
        { type: 'double', seat: 1 },
        { type: 'passRedouble', seat: 0 },
        { type: 'passRedouble', seat: 2 },
      ]),
    );
    assert.deepEqual(doubled.hand?.result?.scoreDelta, [2, 0]);

    const redoubled = playOut(
      applyAll(chooseSpades(auctionTo(0, 20)), [
        { type: 'double', seat: 1 },
        { type: 'redouble', seat: 0 },
      ]),
    );
    assert.deepEqual(redoubled.hand?.result?.scoreDelta, [4, 0]);
    assert.deepEqual(redoubled.scores, [4, 0]);
  });

  it('subtracts the stake from the bidding team when the contract fails', () => {
    const failed = playOut(
      applyAll(chooseSpades(auctionTo(1, 16)), [
        { type: 'passDouble', seat: 2 },
        { type: 'passDouble', seat: 0 },
      ]),
    );
    const result = failed.hand?.result;
    assert.equal(result?.bidderTeam, 1);
    assert.deepEqual(result?.capturedPoints, [28, 0]);
    assert.equal(result?.contractMade, false);
    assert.deepEqual(result?.scoreDelta, [0, -1]);
    assert.deepEqual(failed.scores, [0, -1]);
  });

  it('scores nothing for an annulled hand even when doubled', () => {
    const state = autoPlayHand(
      applyAll(chooseSpades(auctionTo(0, 20)), [
        { type: 'double', seat: 1 },
        { type: 'redouble', seat: 0 },
      ]),
    );
    const result = state.hand?.result;
    assert.equal(result?.annulled, true);
    assert.equal(result?.stake, 4);
    assert.deepEqual(result?.scoreDelta, [0, 0]);
    assert.deepEqual(state.scores, [0, 0]);
  });

  it('combines a marriage with a redouble exactly as the profile states', () => {
    // Bid 20, bidder-side marriage lowers the target to 16, redoubled success pays 4.
    let state = applyAll(chooseSpades(auctionTo(0, 20)), [
      { type: 'double', seat: 1 },
      { type: 'redouble', seat: 0 },
    ]);
    state = firstTrick(state);
    assert.equal(projectFor(state, 0).actions.canDeclarePair, true);
    state = apply(state, { type: 'declarePair', seat: 0 });
    state = autoPlayHand(ackAll(state));
    const result = state.hand?.result;
    assert.equal(result?.pairAdjustment, -4);
    assert.equal(result?.target, 16);
    assert.equal(result?.stake, 4);
    assert.deepEqual(result?.scoreDelta, [4, 0]);
  });
});

describe('match boundaries', () => {
  it('ends the match when the bidding team reaches +6', () => {
    let state = chooseSpades(auctionTo(0, 20));
    state.scores = [4, 0];
    state = playOutDoubled(state);
    assert.deepEqual(state.scores, [6, 0]);
    assert.deepEqual(state.matchResult, { winner: 0, reason: 'target' });
    assert.equal(state.phase, 'HAND_RESULT');
    state = applyAll(state, [
      { type: 'nextHand', seat: 0 },
      { type: 'nextHand', seat: 1 },
      { type: 'nextHand', seat: 2 },
      { type: 'nextHand', seat: 3 },
    ]);
    assert.equal(state.phase, 'MATCH_RESULT');
  });

  it('ends the match when the bidding team overshoots −6', () => {
    let state = chooseSpades(auctionTo(1, 16));
    state.scores = [0, -4];
    state = applyAll(state, [
      { type: 'double', seat: 2 },
      { type: 'redouble', seat: 1 },
    ]);
    state = autoPlayHand(ackAll(firstTrick(state)));
    assert.deepEqual(state.scores, [0, -8]);
    assert.deepEqual(state.matchResult, { winner: 0, reason: 'target' });
  });

  it('resets scores and history on a unanimous rematch', () => {
    let state = chooseSpades(auctionTo(0, 20));
    state.scores = [4, 0];
    state = playOutDoubled(state);
    state = applyAll(state, [
      { type: 'nextHand', seat: 0 },
      { type: 'nextHand', seat: 1 },
      { type: 'nextHand', seat: 2 },
      { type: 'nextHand', seat: 3 },
    ]);
    assert.equal(projectFor(state, 0).actions.canRematch, true);
    state = applyAll(state, [
      { type: 'rematch', seat: 0 },
      { type: 'rematch', seat: 1 },
      { type: 'rematch', seat: 2 },
    ]);
    assert.equal(state.phase, 'MATCH_RESULT', 'a rematch needs all four');
    expectRejected(state, { type: 'rematch', seat: 0 }, 'ILLEGAL_MOVE');
    state = apply(state, { type: 'rematch', seat: 3 });
    assert.equal(state.phase, 'DEAL_FIRST');
    assert.deepEqual(state.scores, [0, 0]);
    assert.equal(state.matchResult, null);
    assert.equal(state.history.length, 0);
    assert.equal(state.handNumber, 1);
  });

  function playOutDoubled(state: MatchState): MatchState {
    const doubled = applyAll(state, [
      { type: 'double', seat: 1 },
      { type: 'passRedouble', seat: 0 },
      { type: 'passRedouble', seat: 2 },
    ]);
    return autoPlayHand(ackAll(firstTrick(doubled)));
  }
});
