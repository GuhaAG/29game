import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { projectFor } from '../../src/engine/projection';
import { apply, applyAll, completeSpec, expectRejected, newHand } from './helpers';

const DEALER = 3 as const;

function fresh() {
  return newHand(DEALER, completeSpec({}));
}

describe('auction', () => {
  it('opens to the dealer’s left and deals four cards each', () => {
    const state = fresh();
    assert.equal(state.phase, 'BIDDING');
    assert.equal(state.hand?.auction.turn, 0);
    for (const seat of [0, 1, 2, 3] as const) {
      assert.equal(state.hand?.hands[seat].length, 4);
    }
  });

  it('offers 16–28 first, then only raises', () => {
    const state = fresh();
    assert.deepEqual(projectFor(state, 0).actions.bids[0], 16);
    assert.equal(projectFor(state, 0).actions.bids.at(-1), 28);
    const after = apply(state, { type: 'bid', seat: 0, value: 20 });
    assert.deepEqual(projectFor(after, 1).actions.bids, [21, 22, 23, 24, 25, 26, 27, 28]);
    expectRejected(after, { type: 'bid', seat: 1, value: 20 }, 'ILLEGAL_MOVE');
    expectRejected(after, { type: 'bid', seat: 1, value: 29 }, 'ILLEGAL_MOVE');
    expectRejected(state, { type: 'bid', seat: 0, value: 15 }, 'ILLEGAL_MOVE');
  });

  it('forces the dealer to 16 after three opening passes', () => {
    const state = applyAll(fresh(), [
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
    ]);
    assert.equal(state.phase, 'CHOOSE_TRUMP');
    assert.equal(state.hand?.bidder, DEALER);
    assert.equal(state.hand?.bid, 16);
    assert.ok(state.hand?.auction.history.some((entry) => entry.forced));
  });

  it('ends after three consecutive passes following a bid', () => {
    const state = applyAll(fresh(), [
      { type: 'bid', seat: 0, value: 18 },
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
    ]);
    assert.equal(state.phase, 'CHOOSE_TRUMP');
    assert.equal(state.hand?.bidder, 0);
    assert.equal(state.hand?.bid, 18);
  });

  it('lets a player who passed bid again later; a raise resets the pass count', () => {
    let state = applyAll(fresh(), [
      { type: 'pass', seat: 0 },
      { type: 'bid', seat: 1, value: 16 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'bid', seat: 0, value: 17 },
    ]);
    assert.equal(state.phase, 'BIDDING');
    assert.equal(state.hand?.auction.consecutivePasses, 0);
    state = applyAll(state, [
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
    ]);
    assert.equal(state.hand?.bidder, 0);
    assert.equal(state.hand?.bid, 17);
  });

  it('ends immediately at the maximum bid', () => {
    const state = apply(fresh(), { type: 'bid', seat: 0, value: 28 });
    assert.equal(state.phase, 'CHOOSE_TRUMP');
    assert.equal(state.hand?.bid, 28);
    assert.equal(state.hand?.auction.history.length, 1);
  });

  it('rejects bids out of turn and after the auction closes', () => {
    const state = fresh();
    expectRejected(state, { type: 'bid', seat: 1, value: 20 }, 'NOT_YOUR_TURN');
    expectRejected(state, { type: 'pass', seat: 2 }, 'NOT_YOUR_TURN');
    const closed = apply(state, { type: 'bid', seat: 0, value: 28 });
    expectRejected(closed, { type: 'bid', seat: 1, value: 28 }, 'WRONG_PHASE');
  });

  it('never exposes another seat’s cards or actions', () => {
    const state = fresh();
    const view = projectFor(state, 1);
    assert.equal(view.hand?.yourCards.length, 4);
    assert.deepEqual(view.actions.bids, []);
    assert.equal(JSON.stringify(view).includes('"deck"'), false);
  });
});
