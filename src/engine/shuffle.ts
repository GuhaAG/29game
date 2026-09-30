import { FULL_DECK, type CardId } from './cards';

/**
 * Unbiased Fisher–Yates over the 32 card ids. Randomness is injected so rule
 * transitions stay deterministic and testable; the server passes a CSPRNG.
 */
export function shuffleDeck(randomIndex: (exclusiveMax: number) => number): CardId[] {
  const deck = [...FULL_DECK];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    if (j < 0 || j > i) throw new Error('random index out of range');
    const a = deck[i] as CardId;
    const b = deck[j] as CardId;
    deck[i] = b;
    deck[j] = a;
  }
  return deck;
}
