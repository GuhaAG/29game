import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

/** Dealer 2 means seat 3 leads, so the bidder is never forced to lead first. */
const DEALER = 2 as const;

/** Seat 0's seventh personal card is H7 — its only heart. */
const ONLY_TRUMP: HandSpec = {
  0: ['CJ', 'C9', 'CA', 'CT', 'DJ', 'D9', 'H7', 'S7'],
  1: ['HK', 'HQ', 'H8', 'CK', 'CQ', 'C8', 'C7', 'D7'],
  2: ['DA', 'DT', 'DK', 'DQ', 'D8', 'SK', 'SQ', 'S8'],
  3: ['HJ', 'H9', 'HA', 'HT', 'SJ', 'S9', 'SA', 'ST'],
};

/** Seat 0 holds the trump king and is dealt the trump queen as its seventh card. */
const RESERVED_HONOUR: HandSpec = {
  0: ['CJ', 'C9', 'CA', 'CT', 'HK', 'D9', 'HQ', 'S7'],
  1: ['HJ', 'H9', 'H8', 'H7', 'CK', 'CQ', 'C8', 'C7'],
  2: ['HA', 'HT', 'DA', 'DT', 'DK', 'DQ', 'D8', 'D7'],
  3: ['SJ', 'S9', 'SA', 'ST', 'SK', 'SQ', 'S8', 'DJ'],
};

function chooseSeventh(spec: HandSpec, bid = 18): MatchState {
  let state = winAuction(newHand(DEALER, spec), 0, bid);
  state = apply(state, { type: 'chooseTrump', seat: 0, mode: 'seventh' });
  return state;
}

function passDoubles(state: MatchState): MatchState {
  let current = state;
  while (current.phase === 'DOUBLE_WINDOW') {
    current = apply(current, { type: 'passDouble', seat: current.hand?.doubling.pending[0] as Seat });
  }
  return current;
}

describe('seventh-card trump', () => {
  it('withholds the preview until the doubling decisions are finished', () => {
    const state = chooseSeventh(ONLY_TRUMP);
    assert.equal(state.phase, 'DOUBLE_WINDOW');
    const bidderView = projectFor(state, 0);
    assert.equal(bidderView.hand?.reservedCard, null);
    assert.equal(bidderView.hand?.trump, null);
    assert.equal(bidderView.hand?.trumpMode, 'seventh');
    assert.equal(bidderView.hand?.yourCards.length, 4, 'the second batch is not dealt yet');
  });

  it('reserves the bidder’s own seventh card and takes trump from it', () => {
    const state = passDoubles(chooseSeventh(ONLY_TRUMP));
    assert.equal(state.phase, 'PLAYING');
    assert.equal(state.hand?.reservedCard, 'H7');
    assert.equal(state.hand?.trump, 'H');
    assert.equal(state.hand?.hands[0].length, 7, 'seven playable cards');
    const bidderView = projectFor(state, 0);
    assert.deepEqual(bidderView.hand?.reservedCard, { card: 'H7', suit: 'H' });
    assert.equal(bidderView.hand?.trump, 'H');
    assert.equal(bidderView.hand?.cardCounts[0], 8, 'the reserved card still counts as a card');
    const opponentView = projectFor(state, 1);
    assert.equal(opponentView.hand?.reservedCard, null);
    assert.equal(opponentView.hand?.trump, null);
    assert.equal(opponentView.hand?.trumpStatus, 'hidden');
    assert.equal(opponentView.hand?.cardCounts[0], 8);
    assertCardConservation(state);
  });

  it('applies no extra cancellation when the reserved card is the bidder’s only trump', () => {
    const state = passDoubles(chooseSeventh(ONLY_TRUMP));
    assert.equal(state.phase, 'PLAYING');
    assert.equal(state.hand?.hands[0].filter((card) => card.startsWith('H')).length, 0);
    assert.equal(state.history.length, 0);
  });

  it('keeps the reserved card out of the playable hand and out of the follow-suit test', () => {
    const state = apply(passDoubles(chooseSeventh(ONLY_TRUMP)), { type: 'playCard', seat: 3, card: 'HJ' });
    const view = projectFor(state, 0);
    assert.equal(view.actions.legalCards.length, 7);
    assert.equal(view.actions.legalCards.includes('H7'), false);
    assert.equal(view.actions.canRevealTrump, true, 'the reserved heart does not count as following');
    expectRejected(state, { type: 'playCard', seat: 0, card: 'H7' }, 'ILLEGAL_MOVE');
  });

  it('lets the bidder discard instead of revealing', () => {
    const state = applyAll(passDoubles(chooseSeventh(ONLY_TRUMP)), [
      { type: 'playCard', seat: 3, card: 'HJ' },
      { type: 'playCard', seat: 0, card: 'CJ' },
    ]);
    assert.equal(state.hand?.trumpRevealed, false);
    assert.equal(state.hand?.reservedReleased, false);
    assert.equal(state.hand?.reservedCard, 'H7');
    assertCardConservation(state);
  });

  it('releases the reserved card on reveal and then requires following suit', () => {
    const state = applyAll(passDoubles(chooseSeventh(ONLY_TRUMP)), [
      { type: 'playCard', seat: 3, card: 'HJ' },
      { type: 'revealTrump', seat: 0 },
    ]);
    assert.equal(state.hand?.reservedReleased, true);
    assert.ok(state.hand?.hands[0].includes('H7'));
    assert.deepEqual(projectFor(state, 0).actions.legalCards, ['H7'], 'following the lead comes first');
    assert.equal(projectFor(state, 0).hand?.reservedCard, null);
    assert.equal(projectFor(state, 1).hand?.trump, 'H', 'the reveal is public');
    assertCardConservation(state);
  });

  it('releases the reserved card when another player reveals', () => {
    let state = applyAll(passDoubles(chooseSeventh(ONLY_TRUMP)), [
      { type: 'playCard', seat: 3, card: 'HJ' },
      { type: 'playCard', seat: 0, card: 'CJ' },
      { type: 'playCard', seat: 1, card: 'HK' },
    ]);
    assert.equal(projectFor(state, 2).actions.canRevealTrump, true);
    state = apply(state, { type: 'revealTrump', seat: 2 });
    assert.equal(state.hand?.reservedReleased, true);
    assert.ok(state.hand?.hands[0].includes('H7'));
    assert.equal(state.hand?.hands[0].length, 7, 'six played-down cards plus the released one');
    // Seat 2 holds no hearts, so the must-trump obligation simply does not apply.
    assert.equal(projectFor(state, 2).actions.legalCards.length, 8);
    state = apply(state, { type: 'playCard', seat: 2, card: 'DA' });
    assert.equal(state.hand?.tricks[0]?.winner, 3);
    assertCardConservation(state);
  });

  it('auto-releases the last reserved card, including when the bidder leads', () => {
    const state = autoPlayHand(passDoubles(chooseSeventh(ONLY_TRUMP)));
    assert.equal(state.phase, 'HAND_RESULT');
    const result = state.hand?.result;
    assert.equal(result?.annulled, false, 'the forced release prevents an annulment');
    assert.equal(result?.trumpRevealed, true);
    assert.equal(state.hand?.revealedBy, 0);
    assert.equal(state.hand?.revealTrickIndex, 7, 'released on the final trick');
    assert.equal(state.hand?.reservedReleased, true);
    const played = (state.hand?.tricks ?? []).flatMap((trick) => trick.plays.map((play) => play.card));
    assert.equal(played.length, 32);
    assert.equal(new Set(played).size, 32);
    assert.ok(played.includes('H7'), 'the reserved card is neither lost nor duplicated');
  });

  it('offers the released card as the only legal play when it is the last one', () => {
    let state = passDoubles(chooseSeventh(ONLY_TRUMP));
    let guard = 0;
    while (state.phase === 'PLAYING' && (state.hand?.tricks.length ?? 0) < 7) {
      guard += 1;
      if (guard > 100) throw new Error('stuck');
      if (state.hand?.ack) {
        state = ackAll(state);
        continue;
      }
      const seat = state.hand?.turn as Seat;
      const card = projectFor(state, seat).actions.legalCards[0] as string;
      state = apply(state, { type: 'playCard', seat, card });
    }
    state = ackAll(state);
    assert.equal(state.hand?.hands[0].length, 0, 'only the reserved card is left');
    while ((state.hand?.turn as Seat) !== 0) {
      const seat = state.hand?.turn as Seat;
      const card = projectFor(state, seat).actions.legalCards[0] as string;
      state = apply(state, { type: 'playCard', seat, card });
    }
    assert.equal(state.hand?.trumpRevealed, true, 'released as soon as the bidder is on turn');
    assert.deepEqual(state.hand?.hands[0], ['H7']);
    assert.deepEqual(projectFor(state, 0).actions.legalCards, ['H7']);
    assert.equal(state.hand?.revealTrickIndex, 7);
  });

  it('allows a marriage that uses the released card', () => {
    let state = passDoubles(chooseSeventh(RESERVED_HONOUR, 20));
    assert.equal(state.hand?.reservedCard, 'HQ');
    assert.equal(state.hand?.trump, 'H');
    state = applyAll(state, [
      { type: 'playCard', seat: 3, card: 'SJ' },
      { type: 'playCard', seat: 0, card: 'S7' },
      { type: 'revealTrump', seat: 1 },
      { type: 'playCard', seat: 1, card: 'H7' },
      { type: 'playCard', seat: 2, card: 'HA' },
    ]);
    assert.equal(state.hand?.tricks[0]?.winner, 2, 'the ace of trump beats the seven');
    assert.ok(state.hand?.hands[0].includes('HQ'), 'the reserved queen was released by the reveal');
    assert.equal(projectFor(state, 0).actions.canDeclarePair, true);
    state = apply(state, { type: 'declarePair', seat: 0 });
    assert.equal(state.hand?.pair?.adjustment, -4);
    assert.deepEqual(state.hand?.pair?.cards.sort(), ['HK', 'HQ']);
  });
});
