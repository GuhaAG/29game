import { RULES_VERSION } from './types';

/**
 * The frozen rule profile (rulesVersion=1) confirmed in SPEC.md §2.
 * The wording of the rules shown to players lives in locales/en.json
 * (rules.sections); keep it in step with these numbers when either changes.
 */
export const PROFILE = {
  rulesVersion: RULES_VERSION,
  deckSize: 32,
  totalCardPoints: 28,
  minBid: 16,
  maxBid: 28,
  handsPerDeal: 8,
  cardsPerHand: 8,
  firstDealSize: 4,
  /** 1-based index, in the bidder's personal deal order, of the reserved seventh card. */
  seventhCardIndex: 7,
  pairAdjustment: 4,
  baseStake: 1,
  matchBoundary: 6,
  direction: 'clockwise',
  lastTrickPoint: false,
  forcedDealerBid: 16,
} as const;
