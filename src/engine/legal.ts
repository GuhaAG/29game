import { type CardId, suitOf, rankOf } from './cards';
import { PROFILE } from './profile';
import type { HandState, MatchState, Seat } from './types';
import { teamOf } from './types';

/** Number of cards the seat still holds, counting a reserved seventh card. */
export function remainingCardCount(hand: HandState, seat: Seat): number {
  const reserved = hand.reservedCard && !hand.reservedReleased && hand.bidder === seat ? 1 : 0;
  return (hand.hands[seat]?.length ?? 0) + reserved;
}

export function legalBids(state: MatchState): number[] {
  if (state.phase !== 'BIDDING' || !state.hand) return [];
  const floor = state.hand.auction.highBid === null ? PROFILE.minBid : state.hand.auction.highBid + 1;
  const bids: number[] = [];
  for (let value = floor; value <= PROFILE.maxBid; value += 1) bids.push(value);
  return bids;
}

export function leadSuit(hand: HandState): string | null {
  const first = hand.currentTrick.plays[0];
  return first ? suitOf(first.card) : null;
}

/**
 * Legal cards for the seat to play right now. Following the led suit takes
 * priority; a player who requested the reveal must otherwise play trump if able.
 */
export function legalCards(state: MatchState, seat: Seat): CardId[] {
  const hand = state.hand;
  if (!hand || state.phase !== 'PLAYING' || hand.ack || hand.turn !== seat) return [];
  const cards = hand.hands[seat] ?? [];
  const led = leadSuit(hand);
  if (led === null) return [...cards];
  const following = cards.filter((card) => suitOf(card) === led);
  if (following.length > 0) return following;
  if (hand.forcedTrumpSeat === seat && hand.trumpRevealed && hand.trump) {
    const trumps = cards.filter((card) => suitOf(card) === hand.trump);
    if (trumps.length > 0) return trumps;
  }
  return [...cards];
}

/** Reveal is offered only on the actor's turn, when following the lead is impossible. */
export function canRevealTrump(state: MatchState, seat: Seat): boolean {
  const hand = state.hand;
  if (!hand || state.phase !== 'PLAYING' || hand.ack || hand.turn !== seat) return false;
  if (hand.trumpRevealed || !hand.trump) return false;
  const led = leadSuit(hand);
  if (led === null) return false; // never while leading
  return !(hand.hands[seat] ?? []).some((card) => suitOf(card) === led);
}

/**
 * The bidder is out of playable cards and holds only the reserved seventh card:
 * trump is revealed and the card released automatically before they must play.
 */
export function needsAutomaticRelease(state: MatchState): boolean {
  const hand = state.hand;
  if (!hand || state.phase !== 'PLAYING' || hand.ack) return false;
  if (hand.trumpMode !== 'seventh' || hand.reservedReleased || !hand.reservedCard) return false;
  if (hand.bidder === null || hand.turn !== hand.bidder) return false;
  return (hand.hands[hand.bidder] ?? []).length === 0;
}

export function trumpHonours(hand: HandState, seat: Seat): [CardId, CardId] | null {
  if (!hand.trump) return null;
  const cards = hand.hands[seat] ?? [];
  const king = cards.find((card) => suitOf(card) === hand.trump && rankOf(card) === 'K');
  const queen = cards.find((card) => suitOf(card) === hand.trump && rankOf(card) === 'Q');
  return king && queen ? [king, queen] : null;
}

/**
 * Marriage eligibility inside the between-trick window: trump revealed, this
 * player's team won the trick just completed, and both honours still in hand.
 */
export function canDeclarePair(state: MatchState, seat: Seat): boolean {
  const hand = state.hand;
  if (!hand || state.phase !== 'PLAYING' || !hand.ack) return false;
  if (hand.pair || !hand.trumpRevealed) return false;
  if (hand.ack.acknowledged.includes(seat)) return false;
  const trick = hand.tricks[hand.ack.trickIndex];
  if (!trick || teamOf(trick.winner) !== teamOf(seat)) return false;
  return trumpHonours(hand, seat) !== null;
}

export function pairAdjustedTarget(bid: number, adjustment: number): number {
  return Math.min(PROFILE.maxBid, Math.max(PROFILE.minBid, bid + adjustment));
}
