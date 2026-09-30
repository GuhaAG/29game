/**
 * Card model for rulesVersion=1: 32 cards, ranks J 9 A 10 K Q 8 7 (descending strength),
 * card points J=3, 9=2, A=1, 10=1, others 0 (28 points per hand).
 */

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

/** Ranks in descending strength order. 'T' is the ten. */
export const RANKS = ['J', '9', 'A', 'T', 'K', 'Q', '8', '7'] as const;
export type Rank = (typeof RANKS)[number];

/** A card id is suit letter + rank letter, e.g. "SJ" = jack of spades. */
export type CardId = string;

export const SUIT_NAMES: Record<Suit, string> = {
  S: 'Spades',
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const RANK_NAMES: Record<Rank, string> = {
  J: 'Jack',
  '9': 'Nine',
  A: 'Ace',
  T: 'Ten',
  K: 'King',
  Q: 'Queen',
  '8': 'Eight',
  '7': 'Seven',
};

const RANK_POINTS: Record<Rank, number> = {
  J: 3,
  '9': 2,
  A: 1,
  T: 1,
  K: 0,
  Q: 0,
  '8': 0,
  '7': 0,
};

/** Strength index; lower is stronger. */
const RANK_STRENGTH: Record<Rank, number> = RANKS.reduce(
  (acc, rank, index) => {
    acc[rank] = index;
    return acc;
  },
  {} as Record<Rank, number>,
);

export const FULL_DECK: readonly CardId[] = SUITS.flatMap((suit) =>
  RANKS.map((rank) => `${suit}${rank}`),
);

export const TOTAL_CARD_POINTS = 28;

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && FULL_DECK.includes(value);
}

export function suitOf(card: CardId): Suit {
  return card[0] as Suit;
}

export function rankOf(card: CardId): Rank {
  return card.slice(1) as Rank;
}

export function cardPoints(card: CardId): number {
  return RANK_POINTS[rankOf(card)];
}

export function handPoints(cards: readonly CardId[]): number {
  return cards.reduce((total, card) => total + cardPoints(card), 0);
}

/** True when `a` beats `b`; both must share a suit. */
export function strongerInSuit(a: CardId, b: CardId): boolean {
  return RANK_STRENGTH[rankOf(a)] < RANK_STRENGTH[rankOf(b)];
}

export function isSuit(value: unknown): value is Suit {
  return typeof value === 'string' && (SUITS as readonly string[]).includes(value);
}

export function cardLabel(card: CardId): string {
  const rank = rankOf(card);
  const display = rank === 'T' ? '10' : rank;
  return `${display}${SUIT_SYMBOLS[suitOf(card)]}`;
}

export function cardAccessibleLabel(card: CardId): string {
  return `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;
}
