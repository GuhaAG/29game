import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FULL_DECK,
  RANKS,
  SUITS,
  TOTAL_CARD_POINTS,
  cardLabel,
  cardPoints,
  handPoints,
  strongerInSuit,
} from '../../src/engine/cards';
import { shuffleDeck } from '../../src/engine/shuffle';

describe('deck', () => {
  it('holds 32 unique cards worth 28 points in total', () => {
    assert.equal(FULL_DECK.length, 32);
    assert.equal(new Set(FULL_DECK).size, 32);
    assert.equal(handPoints(FULL_DECK), TOTAL_CARD_POINTS);
  });

  it('scores J=3, 9=2, A=1, 10=1 and nothing else', () => {
    assert.equal(cardPoints('SJ'), 3);
    assert.equal(cardPoints('S9'), 2);
    assert.equal(cardPoints('SA'), 1);
    assert.equal(cardPoints('ST'), 1);
    for (const rank of ['K', 'Q', '8', '7']) assert.equal(cardPoints(`S${rank}`), 0);
    for (const suit of SUITS) assert.equal(handPoints(RANKS.map((rank) => `${suit}${rank}`)), 7);
  });

  it('ranks J 9 A 10 K Q 8 7 from strongest to weakest', () => {
    const order = RANKS.map((rank) => `H${rank}`);
    for (let i = 0; i < order.length - 1; i += 1) {
      assert.ok(strongerInSuit(order[i] as string, order[i + 1] as string));
      assert.ok(!strongerInSuit(order[i + 1] as string, order[i] as string));
    }
  });

  it('labels the ten as 10', () => {
    assert.equal(cardLabel('DT'), '10♦');
  });

  it('shuffles into a permutation without reusing or dropping cards', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      let counter = seed;
      const deck = shuffleDeck((max) => {
        counter = (counter * 1103515245 + 12345) >>> 0;
        return counter % max;
      });
      assert.equal(deck.length, 32);
      assert.equal(new Set(deck).size, 32);
      assert.deepEqual([...deck].sort(), [...FULL_DECK].sort());
    }
  });
});
