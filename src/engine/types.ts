import type { CardId, Suit } from './cards';

export const RULES_VERSION = 1;

export type Seat = 0 | 1 | 2 | 3;
/** Team 0 owns seats 0 and 2; team 1 owns seats 1 and 3. */
export type Team = 0 | 1;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export type Phase =
  | 'DEAL_FIRST'
  | 'BIDDING'
  | 'CHOOSE_TRUMP'
  | 'DOUBLE_WINDOW'
  | 'REDOUBLE_WINDOW'
  | 'DEAL_SECOND'
  | 'PLAYING'
  | 'HAND_RESULT'
  | 'MATCH_RESULT';

export type TrumpMode = 'suit' | 'seventh';
export type Stake = 1 | 2 | 4;

export interface TrickPlay {
  seat: Seat;
  card: CardId;
}

export interface CompletedTrick {
  index: number;
  leader: Seat;
  plays: TrickPlay[];
  winner: Seat;
  points: number;
  /** True when trump was live for this trick's resolution. */
  trumpLive: boolean;
}

export interface CurrentTrick {
  index: number;
  leader: Seat;
  plays: TrickPlay[];
}

export interface AuctionRecord {
  seat: Seat;
  action: 'bid' | 'pass';
  value?: number;
  /** Set when the dealer was forced to 16 by three opening passes. */
  forced?: boolean;
}

export interface AuctionState {
  turn: Seat;
  highBid: number | null;
  highBidder: Seat | null;
  consecutivePasses: number;
  history: AuctionRecord[];
}

export type DoubleDecision = 'double' | 'pass';

export interface DoublingState {
  /** Seats that still may act in the open window, in order. */
  pending: Seat[];
  defenderDecisions: { seat: Seat; decision: DoubleDecision }[];
  bidderDecisions: { seat: Seat; decision: 'redouble' | 'pass' }[];
  doubledBy: Seat | null;
  redoubledBy: Seat | null;
}

export interface PairState {
  seat: Seat;
  team: Team;
  cards: [CardId, CardId];
  trickIndex: number;
  adjustment: number;
}

export interface AckWindow {
  trickIndex: number;
  acknowledged: Seat[];
}

export interface HandResult {
  handNumber: number;
  dealer: Seat;
  bidder: Seat;
  bidderTeam: Team;
  bid: number;
  trumpMode: TrumpMode;
  trump: Suit | null;
  trumpRevealed: boolean;
  pairAdjustment: number;
  target: number;
  capturedPoints: [number, number];
  stake: Stake;
  annulled: boolean;
  contractMade: boolean | null;
  scoreDelta: [number, number];
  scoresAfter: [number, number];
  pair: PairState | null;
}

export interface HandState {
  handNumber: number;
  dealer: Seat;
  /** Server-secret shuffled order; persisted before dealing and never reshuffled. */
  deck: CardId[];
  dealtCount: 0 | 4 | 8;
  hands: Record<Seat, CardId[]>;
  auction: AuctionState;
  bidder: Seat | null;
  bid: number | null;
  trumpMode: TrumpMode | null;
  /** Private until `trumpRevealed`. */
  trump: Suit | null;
  trumpRevealed: boolean;
  revealedBy: Seat | null;
  revealTrickIndex: number | null;
  /** Seat carrying the immediate must-trump obligation created by its own reveal. */
  forcedTrumpSeat: Seat | null;
  reservedCard: CardId | null;
  reservedReleased: boolean;
  doubling: DoublingState;
  stake: Stake;
  turn: Seat;
  currentTrick: CurrentTrick;
  tricks: CompletedTrick[];
  ack: AckWindow | null;
  pair: PairState | null;
  result: HandResult | null;
}

export interface MatchState {
  rulesVersion: number;
  phase: Phase;
  dealer: Seat;
  handNumber: number;
  scores: [number, number];
  hand: HandState | null;
  /** Seats that have acknowledged the current HAND_RESULT / MATCH_RESULT screen. */
  continues: Seat[];
  matchResult: { winner: Team; reason: 'target' | 'ended' } | null;
  history: HandResult[];
}

export type EngineCommand =
  | { type: 'bid'; seat: Seat; value: number }
  | { type: 'pass'; seat: Seat }
  | { type: 'chooseTrump'; seat: Seat; mode: TrumpMode; suit?: Suit }
  | { type: 'double'; seat: Seat }
  | { type: 'passDouble'; seat: Seat }
  | { type: 'redouble'; seat: Seat }
  | { type: 'passRedouble'; seat: Seat }
  | { type: 'revealTrump'; seat: Seat }
  | { type: 'playCard'; seat: Seat; card: CardId }
  | { type: 'declarePair'; seat: Seat }
  | { type: 'continueTrick'; seat: Seat }
  | { type: 'nextHand'; seat: Seat }
  | { type: 'rematch'; seat: Seat };

export type EngineCommandType = EngineCommand['type'];

export type EngineEvent =
  | { type: 'handStarted'; handNumber: number; dealer: Seat }
  | { type: 'dealtFirst' }
  | { type: 'bidPlaced'; seat: Seat; value: number; forced?: boolean }
  | { type: 'passed'; seat: Seat }
  | { type: 'auctionWon'; seat: Seat; value: number }
  | { type: 'trumpChosen'; seat: Seat; mode: TrumpMode }
  | { type: 'doubleWindowOpened'; seats: Seat[] }
  | { type: 'doubled'; seat: Seat }
  | { type: 'passedDouble'; seat: Seat }
  | { type: 'redoubled'; seat: Seat }
  | { type: 'passedRedouble'; seat: Seat }
  | { type: 'stakeSet'; stake: Stake }
  | { type: 'dealtSecond' }
  | { type: 'trumpRevealed'; seat: Seat; suit: Suit; releasedReserved: boolean }
  | { type: 'cardPlayed'; seat: Seat; card: CardId }
  | { type: 'trickCompleted'; trick: CompletedTrick }
  | { type: 'ackWindowOpened'; trickIndex: number }
  | { type: 'acknowledged'; seat: Seat }
  | { type: 'pairDeclared'; pair: PairState; target: number }
  | { type: 'handCompleted'; result: HandResult }
  | { type: 'matchCompleted'; winner: Team }
  | { type: 'rematchStarted' };

export type EngineErrorCode = 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'ILLEGAL_MOVE';

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function teamOf(seat: Seat): Team {
  return (seat % 2) as Team;
}

export function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

/** Clockwise successor. */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}
