import type { CardId, Suit } from './cards';
import { suitOf } from './cards';
import {
  canDeclarePair,
  canRevealTrump,
  legalBids,
  legalCards,
  remainingCardCount,
} from './legal';
import type {
  AuctionRecord,
  CompletedTrick,
  CurrentTrick,
  DoublingState,
  HandResult,
  MatchState,
  PairState,
  Phase,
  Seat,
  Stake,
  Team,
  TrumpMode,
} from './types';
import { SEATS, teamOf } from './types';

export type TrumpStatus = 'none' | 'hidden' | 'revealed';

export interface ViewActions {
  bids: number[];
  canPass: boolean;
  canChooseTrump: boolean;
  canDouble: boolean;
  canRedouble: boolean;
  canPassDouble: boolean;
  canPassRedouble: boolean;
  legalCards: CardId[];
  canRevealTrump: boolean;
  canDeclarePair: boolean;
  canContinueTrick: boolean;
  canNextHand: boolean;
  canRematch: boolean;
}

export interface HandView {
  handNumber: number;
  dealer: Seat;
  bidder: Seat | null;
  bidderTeam: Team | null;
  bid: number | null;
  stake: Stake;
  trumpMode: TrumpMode | null;
  trumpStatus: TrumpStatus;
  /** Present only for players permitted to know it. */
  trump: Suit | null;
  revealedBy: Seat | null;
  auction: {
    turn: Seat;
    highBid: number | null;
    highBidder: Seat | null;
    history: AuctionRecord[];
  };
  doubling: {
    actor: Seat | null;
    doubledBy: Seat | null;
    redoubledBy: Seat | null;
    defenderDecisions: DoublingState['defenderDecisions'];
    bidderDecisions: DoublingState['bidderDecisions'];
  };
  turn: Seat | null;
  currentTrick: CurrentTrick;
  tricks: CompletedTrick[];
  trickNumber: number;
  cardCounts: Record<Seat, number>;
  yourCards: CardId[];
  /** Bidder-only preview of the reserved seventh card. */
  reservedCard: { card: CardId; suit: Suit } | null;
  reservedHeld: boolean;
  ack: { trickIndex: number; acknowledged: Seat[] } | null;
  pair: PairState | null;
  result: HandResult | null;
}

export interface MatchView {
  rulesVersion: number;
  phase: Phase;
  dealer: Seat;
  handNumber: number;
  scores: [number, number];
  matchResult: { winner: Team } | null;
  continues: Seat[];
  history: HandResult[];
  you: { seat: Seat; team: Team };
  hand: HandView | null;
  actions: ViewActions;
}

function noActions(): ViewActions {
  return {
    bids: [],
    canPass: false,
    canChooseTrump: false,
    canDouble: false,
    canRedouble: false,
    canPassDouble: false,
    canPassRedouble: false,
    legalCards: [],
    canRevealTrump: false,
    canDeclarePair: false,
    canContinueTrick: false,
    canNextHand: false,
    canRematch: false,
  };
}

/**
 * Builds the view for one seat. Everything a player must not know — other hands,
 * the undealt deck, unrevealed trump, and other players' legal actions — is
 * dropped here rather than hidden by the UI.
 */
export function projectFor(state: MatchState, seat: Seat): MatchView {
  const actions = noActions();
  const hand = state.hand;
  let handView: HandView | null = null;

  if (hand) {
    const isBidder = hand.bidder === seat;
    const trumpKnown = hand.trumpRevealed || (isBidder && hand.trump !== null);
    const trumpStatus: TrumpStatus = hand.trumpRevealed
      ? 'revealed'
      : hand.trumpMode === null
        ? 'none'
        : 'hidden';
    const cardCounts = SEATS.reduce(
      (acc, s) => {
        acc[s] = remainingCardCount(hand, s);
        return acc;
      },
      {} as Record<Seat, number>,
    );
    const reservedVisible = isBidder && hand.reservedCard !== null && !hand.reservedReleased;

    handView = {
      handNumber: hand.handNumber,
      dealer: hand.dealer,
      bidder: hand.bidder,
      bidderTeam: hand.bidder === null ? null : teamOf(hand.bidder),
      bid: hand.bid,
      stake: hand.stake,
      trumpMode: hand.trumpMode,
      trumpStatus,
      trump: trumpKnown ? hand.trump : null,
      revealedBy: hand.revealedBy,
      auction: {
        turn: hand.auction.turn,
        highBid: hand.auction.highBid,
        highBidder: hand.auction.highBidder,
        history: hand.auction.history,
      },
      doubling: {
        actor:
          state.phase === 'DOUBLE_WINDOW' || state.phase === 'REDOUBLE_WINDOW'
            ? (hand.doubling.pending[0] ?? null)
            : null,
        doubledBy: hand.doubling.doubledBy,
        redoubledBy: hand.doubling.redoubledBy,
        defenderDecisions: hand.doubling.defenderDecisions,
        bidderDecisions: hand.doubling.bidderDecisions,
      },
      turn: state.phase === 'PLAYING' ? hand.turn : null,
      currentTrick: hand.currentTrick,
      tricks: hand.tricks,
      trickNumber: Math.min(hand.tricks.length + 1, 8),
      cardCounts,
      yourCards: [...(hand.hands[seat] ?? [])],
      reservedCard:
        reservedVisible && hand.reservedCard
          ? { card: hand.reservedCard, suit: suitOf(hand.reservedCard) }
          : null,
      reservedHeld: hand.reservedCard !== null && !hand.reservedReleased,
      ack: hand.ack ? { trickIndex: hand.ack.trickIndex, acknowledged: hand.ack.acknowledged } : null,
      pair: hand.pair,
      result: hand.result,
    };

    switch (state.phase) {
      case 'BIDDING':
        if (hand.auction.turn === seat) {
          actions.bids = legalBids(state);
          actions.canPass = true;
        }
        break;
      case 'CHOOSE_TRUMP':
        actions.canChooseTrump = isBidder;
        break;
      case 'DOUBLE_WINDOW':
        if (hand.doubling.pending[0] === seat) {
          actions.canDouble = true;
          actions.canPassDouble = true;
        }
        break;
      case 'REDOUBLE_WINDOW':
        if (hand.doubling.pending[0] === seat) {
          actions.canRedouble = true;
          actions.canPassRedouble = true;
        }
        break;
      case 'PLAYING':
        if (hand.ack) {
          actions.canContinueTrick = !hand.ack.acknowledged.includes(seat);
          actions.canDeclarePair = canDeclarePair(state, seat);
        } else {
          actions.legalCards = legalCards(state, seat);
          actions.canRevealTrump = canRevealTrump(state, seat);
        }
        break;
      case 'HAND_RESULT':
        actions.canNextHand = !state.continues.includes(seat);
        break;
      default:
        break;
    }
  } else if (state.phase === 'HAND_RESULT') {
    actions.canNextHand = !state.continues.includes(seat);
  }

  if (state.phase === 'MATCH_RESULT') {
    actions.canRematch = !state.continues.includes(seat);
  }

  return {
    rulesVersion: state.rulesVersion,
    phase: state.phase,
    dealer: state.dealer,
    handNumber: state.handNumber,
    scores: state.scores,
    matchResult: state.matchResult ? { winner: state.matchResult.winner } : null,
    continues: state.continues,
    history: state.history,
    you: { seat, team: teamOf(seat) },
    hand: handView,
    actions,
  };
}
