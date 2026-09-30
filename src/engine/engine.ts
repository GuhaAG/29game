import { FULL_DECK, type CardId, type Suit, cardPoints, isSuit, strongerInSuit, suitOf } from './cards';
import {
  canDeclarePair,
  canRevealTrump,
  legalBids,
  legalCards,
  needsAutomaticRelease,
  pairAdjustedTarget,
  trumpHonours,
} from './legal';
import { PROFILE } from './profile';
import {
  type CompletedTrick,
  type EngineCommand,
  type EngineEvent,
  EngineError,
  type HandResult,
  type HandState,
  type MatchState,
  RULES_VERSION,
  SEATS,
  type Seat,
  type Team,
  nextSeat,
  partnerOf,
  teamOf,
} from './types';

export interface ApplyResult {
  state: MatchState;
  events: EngineEvent[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(code: 'WRONG_PHASE' | 'NOT_YOUR_TURN' | 'ILLEGAL_MOVE', message: string): never {
  throw new EngineError(code, message);
}

export function createMatch(dealer: Seat): MatchState {
  return {
    rulesVersion: RULES_VERSION,
    phase: 'DEAL_FIRST',
    dealer,
    handNumber: 1,
    scores: [0, 0],
    hand: null,
    continues: [],
    matchResult: null,
    history: [],
  };
}

/** True when the server must supply a freshly shuffled deck before play continues. */
export function needsDeck(state: MatchState): boolean {
  return state.phase === 'DEAL_FIRST' && state.hand === null;
}

/** Seat order for dealing and for the opening bid: clockwise from the dealer's left. */
export function dealOrder(dealer: Seat): Seat[] {
  const order: Seat[] = [];
  let seat = nextSeat(dealer);
  for (let i = 0; i < 4; i += 1) {
    order.push(seat);
    seat = nextSeat(seat);
  }
  return order;
}

function assertDeck(deck: readonly CardId[]): void {
  if (deck.length !== PROFILE.deckSize || new Set(deck).size !== PROFILE.deckSize) {
    fail('ILLEGAL_MOVE', 'deck must contain all 32 unique cards');
  }
  for (const card of deck) {
    if (!FULL_DECK.includes(card)) fail('ILLEGAL_MOVE', `unknown card ${card}`);
  }
}

/** Deals rounds [from, to) of the persisted deck, one card at a time, clockwise. */
function deal(hand: HandState, from: number, to: number): void {
  const order = dealOrder(hand.dealer);
  for (let round = from; round < to; round += 1) {
    order.forEach((seat, offset) => {
      const card = hand.deck[round * 4 + offset];
      if (card) hand.hands[seat].push(card);
    });
  }
}

export function startHand(state: MatchState, deck: CardId[], dealer?: Seat): ApplyResult {
  if (!needsDeck(state)) fail('WRONG_PHASE', 'no deal is pending');
  assertDeck(deck);
  const next = clone(state);
  if (dealer !== undefined) next.dealer = dealer;
  const openingSeat = nextSeat(next.dealer);
  const hand: HandState = {
    handNumber: next.handNumber,
    dealer: next.dealer,
    deck: [...deck],
    dealtCount: 0,
    hands: { 0: [], 1: [], 2: [], 3: [] },
    auction: {
      turn: openingSeat,
      highBid: null,
      highBidder: null,
      consecutivePasses: 0,
      history: [],
    },
    bidder: null,
    bid: null,
    trumpMode: null,
    trump: null,
    trumpRevealed: false,
    revealedBy: null,
    revealTrickIndex: null,
    forcedTrumpSeat: null,
    reservedCard: null,
    reservedReleased: false,
    doubling: {
      pending: [],
      defenderDecisions: [],
      bidderDecisions: [],
      doubledBy: null,
      redoubledBy: null,
    },
    stake: PROFILE.baseStake,
    turn: openingSeat,
    currentTrick: { index: 0, leader: openingSeat, plays: [] },
    tricks: [],
    ack: null,
    pair: null,
    result: null,
  };
  next.hand = hand;
  deal(hand, 0, PROFILE.firstDealSize);
  hand.dealtCount = 4;
  next.phase = 'BIDDING';
  next.continues = [];
  return {
    state: next,
    events: [
      { type: 'handStarted', handNumber: hand.handNumber, dealer: hand.dealer },
      { type: 'dealtFirst' },
    ],
  };
}

function endAuction(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  const seat = hand.auction.highBidder;
  const value = hand.auction.highBid;
  if (seat === null || value === null) fail('ILLEGAL_MOVE', 'auction ended without a bid');
  hand.bidder = seat;
  hand.bid = value;
  hand.turn = seat;
  state.phase = 'CHOOSE_TRUMP';
  events.push({ type: 'auctionWon', seat, value });
}

function openDoubleWindow(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  const bidder = hand.bidder as Seat;
  const defenders: Seat[] = [nextSeat(bidder), nextSeat(partnerOf(bidder))];
  hand.doubling.pending = defenders;
  hand.turn = defenders[0] as Seat;
  state.phase = 'DOUBLE_WINDOW';
  events.push({ type: 'doubleWindowOpened', seats: defenders });
}

function openRedoubleWindow(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  const bidder = hand.bidder as Seat;
  const seats: Seat[] = [bidder, partnerOf(bidder)];
  hand.doubling.pending = seats;
  hand.turn = bidder;
  state.phase = 'REDOUBLE_WINDOW';
  events.push({ type: 'doubleWindowOpened', seats });
}

function dealSecond(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  state.phase = 'DEAL_SECOND';
  events.push({ type: 'stakeSet', stake: hand.stake });
  deal(hand, PROFILE.firstDealSize, PROFILE.cardsPerHand);
  hand.dealtCount = 8;
  hand.doubling.pending = [];
  if (hand.trumpMode === 'seventh') {
    const bidder = hand.bidder as Seat;
    const offset = dealOrder(hand.dealer).indexOf(bidder);
    const reserved = hand.deck[(PROFILE.seventhCardIndex - 1) * 4 + offset] as CardId;
    hand.reservedCard = reserved;
    hand.hands[bidder] = hand.hands[bidder].filter((card) => card !== reserved);
    hand.trump = suitOf(reserved);
  }
  const opener = nextSeat(hand.dealer);
  hand.turn = opener;
  hand.currentTrick = { index: 0, leader: opener, plays: [] };
  state.phase = 'PLAYING';
  events.push({ type: 'dealtSecond' });
}

function revealTrump(hand: HandState, seat: Seat, events: EngineEvent[]): void {
  const suit = hand.trump as Suit;
  hand.trumpRevealed = true;
  hand.revealedBy = seat;
  hand.revealTrickIndex = hand.currentTrick.index;
  let released = false;
  if (hand.trumpMode === 'seventh' && hand.reservedCard && !hand.reservedReleased) {
    hand.hands[hand.bidder as Seat].push(hand.reservedCard);
    hand.reservedReleased = true;
    released = true;
  }
  events.push({ type: 'trumpRevealed', seat, suit, releasedReserved: released });
}

function trickWinner(hand: HandState, plays: { seat: Seat; card: CardId }[], trumpLive: boolean): Seat {
  const led = suitOf((plays[0] as { card: CardId }).card);
  const contenders = trumpLive && hand.trump && plays.some((play) => suitOf(play.card) === hand.trump)
    ? plays.filter((play) => suitOf(play.card) === hand.trump)
    : plays.filter((play) => suitOf(play.card) === led);
  let best = contenders[0] as { seat: Seat; card: CardId };
  for (const play of contenders) {
    if (strongerInSuit(play.card, best.card)) best = play;
  }
  return best.seat;
}

function capturedPointsByTeam(hand: HandState): [number, number] {
  const totals: [number, number] = [0, 0];
  for (const trick of hand.tricks) totals[teamOf(trick.winner)] += trick.points;
  return totals;
}

function completeHand(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  const bidder = hand.bidder as Seat;
  const bidderTeam = teamOf(bidder);
  const bid = hand.bid as number;
  const adjustment = hand.pair ? hand.pair.adjustment : 0;
  const target = pairAdjustedTarget(bid, adjustment);
  const captured = capturedPointsByTeam(hand);
  const annulled = !hand.trumpRevealed;
  const contractMade = annulled ? null : captured[bidderTeam] >= target;
  const scoreDelta: [number, number] = [0, 0];
  if (!annulled) {
    scoreDelta[bidderTeam] = contractMade ? hand.stake : -hand.stake;
  }
  state.scores = [state.scores[0] + scoreDelta[0], state.scores[1] + scoreDelta[1]];
  const result: HandResult = {
    handNumber: hand.handNumber,
    dealer: hand.dealer,
    bidder,
    bidderTeam,
    bid,
    trumpMode: hand.trumpMode as 'suit' | 'seventh',
    trump: hand.trumpRevealed ? hand.trump : null,
    trumpRevealed: hand.trumpRevealed,
    pairAdjustment: adjustment,
    target,
    capturedPoints: captured,
    stake: hand.stake,
    annulled,
    contractMade,
    scoreDelta,
    scoresAfter: [...state.scores] as [number, number],
    pair: hand.pair,
  };
  hand.result = result;
  state.history.push(result);
  state.phase = 'HAND_RESULT';
  state.continues = [];
  events.push({ type: 'handCompleted', result });

  if (state.scores[bidderTeam] >= PROFILE.matchBoundary) {
    state.matchResult = { winner: bidderTeam, reason: 'target' };
  } else if (state.scores[bidderTeam] <= -PROFILE.matchBoundary) {
    state.matchResult = { winner: (1 - bidderTeam) as Team, reason: 'target' };
  }
}

function resolveTrick(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  const plays = hand.currentTrick.plays;
  const trumpLive =
    hand.trumpRevealed && hand.revealTrickIndex !== null && hand.revealTrickIndex <= hand.currentTrick.index;
  const winner = trickWinner(hand, plays, trumpLive);
  const trick: CompletedTrick = {
    index: hand.currentTrick.index,
    leader: hand.currentTrick.leader,
    plays: [...plays],
    winner,
    points: plays.reduce((total, play) => total + cardPoints(play.card), 0),
    trumpLive,
  };
  hand.tricks.push(trick);
  events.push({ type: 'trickCompleted', trick });
  hand.currentTrick = { index: trick.index + 1, leader: winner, plays: [] };
  hand.turn = winner;
  hand.forcedTrumpSeat = null;
  if (hand.tricks.length === PROFILE.handsPerDeal) {
    completeHand(state, hand, events);
    return;
  }
  // Identical acknowledgment window after every non-final trick, so a pause
  // never signals that somebody holds the marriage.
  hand.ack = { trickIndex: trick.index, acknowledged: [] };
  events.push({ type: 'ackWindowOpened', trickIndex: trick.index });
}

/**
 * Releases the reserved seventh card the moment the bidder is on turn with an
 * otherwise empty hand, so the released card is visible as their legal play and
 * trump is live for the whole of that final trick.
 */
function autoReleaseIfNeeded(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  if (!needsAutomaticRelease(state)) return;
  revealTrump(hand, hand.bidder as Seat, events);
}

function closeAckIfComplete(state: MatchState, hand: HandState, events: EngineEvent[]): void {
  if (hand.ack && hand.ack.acknowledged.length === 4) {
    hand.ack = null;
    autoReleaseIfNeeded(state, hand, events);
  }
}

function requirePlayingTurn(state: MatchState, hand: HandState, seat: Seat): void {
  if (state.phase !== 'PLAYING') fail('WRONG_PHASE', 'not in the playing phase');
  if (hand.ack) fail('WRONG_PHASE', 'waiting for all players to continue');
  if (hand.turn !== seat) fail('NOT_YOUR_TURN', 'not your turn');
}

export function applyCommand(state: MatchState, command: EngineCommand): ApplyResult {
  const next = clone(state);
  const events: EngineEvent[] = [];
  const hand = next.hand;
  const seat = command.seat;

  switch (command.type) {
    case 'bid': {
      if (next.phase !== 'BIDDING' || !hand) fail('WRONG_PHASE', 'bidding is closed');
      if (hand.auction.turn !== seat) fail('NOT_YOUR_TURN', 'not your turn to bid');
      if (!legalBids(next).includes(command.value)) fail('ILLEGAL_MOVE', 'bid is not legal');
      hand.auction.highBid = command.value;
      hand.auction.highBidder = seat;
      hand.auction.consecutivePasses = 0;
      hand.auction.history.push({ seat, action: 'bid', value: command.value });
      events.push({ type: 'bidPlaced', seat, value: command.value });
      if (command.value === PROFILE.maxBid) {
        endAuction(next, hand, events);
      } else {
        hand.auction.turn = nextSeat(seat);
        hand.turn = hand.auction.turn;
      }
      break;
    }
    case 'pass': {
      if (next.phase !== 'BIDDING' || !hand) fail('WRONG_PHASE', 'bidding is closed');
      if (hand.auction.turn !== seat) fail('NOT_YOUR_TURN', 'not your turn to bid');
      hand.auction.history.push({ seat, action: 'pass' });
      hand.auction.consecutivePasses += 1;
      events.push({ type: 'passed', seat });
      if (hand.auction.highBid === null && hand.auction.consecutivePasses === 3) {
        hand.auction.highBid = PROFILE.forcedDealerBid;
        hand.auction.highBidder = hand.dealer;
        hand.auction.history.push({
          seat: hand.dealer,
          action: 'bid',
          value: PROFILE.forcedDealerBid,
          forced: true,
        });
        events.push({ type: 'bidPlaced', seat: hand.dealer, value: PROFILE.forcedDealerBid, forced: true });
        endAuction(next, hand, events);
      } else if (hand.auction.highBid !== null && hand.auction.consecutivePasses === 3) {
        endAuction(next, hand, events);
      } else {
        hand.auction.turn = nextSeat(seat);
        hand.turn = hand.auction.turn;
      }
      break;
    }
    case 'chooseTrump': {
      if (next.phase !== 'CHOOSE_TRUMP' || !hand) fail('WRONG_PHASE', 'trump is not being chosen');
      if (hand.bidder !== seat) fail('NOT_YOUR_TURN', 'only the contract holder chooses trump');
      if (command.mode === 'suit') {
        if (!isSuit(command.suit)) fail('ILLEGAL_MOVE', 'a trump suit is required');
        hand.trumpMode = 'suit';
        hand.trump = command.suit;
      } else if (command.mode === 'seventh') {
        hand.trumpMode = 'seventh';
        hand.trump = null; // resolved from the reserved card at the second deal
      } else {
        fail('ILLEGAL_MOVE', 'unknown trump mode');
      }
      events.push({ type: 'trumpChosen', seat, mode: hand.trumpMode });
      openDoubleWindow(next, hand, events);
      break;
    }
    case 'double':
    case 'passDouble': {
      if (next.phase !== 'DOUBLE_WINDOW' || !hand) fail('WRONG_PHASE', 'the double window is closed');
      if (hand.doubling.pending[0] !== seat) fail('NOT_YOUR_TURN', 'not your decision');
      if (command.type === 'double') {
        hand.doubling.defenderDecisions.push({ seat, decision: 'double' });
        hand.doubling.doubledBy = seat;
        hand.stake = 2;
        events.push({ type: 'doubled', seat });
        openRedoubleWindow(next, hand, events);
      } else {
        hand.doubling.defenderDecisions.push({ seat, decision: 'pass' });
        hand.doubling.pending.shift();
        events.push({ type: 'passedDouble', seat });
        const upcoming = hand.doubling.pending[0];
        if (upcoming === undefined) {
          hand.stake = PROFILE.baseStake;
          dealSecond(next, hand, events);
        } else {
          hand.turn = upcoming;
        }
      }
      break;
    }
    case 'redouble':
    case 'passRedouble': {
      if (next.phase !== 'REDOUBLE_WINDOW' || !hand) fail('WRONG_PHASE', 'the redouble window is closed');
      if (hand.doubling.pending[0] !== seat) fail('NOT_YOUR_TURN', 'not your decision');
      if (command.type === 'redouble') {
        hand.doubling.bidderDecisions.push({ seat, decision: 'redouble' });
        hand.doubling.redoubledBy = seat;
        hand.stake = 4;
        events.push({ type: 'redoubled', seat });
        dealSecond(next, hand, events);
      } else {
        hand.doubling.bidderDecisions.push({ seat, decision: 'pass' });
        hand.doubling.pending.shift();
        events.push({ type: 'passedRedouble', seat });
        const upcoming = hand.doubling.pending[0];
        if (upcoming === undefined) {
          hand.stake = 2;
          dealSecond(next, hand, events);
        } else {
          hand.turn = upcoming;
        }
      }
      break;
    }
    case 'revealTrump': {
      if (!hand) fail('WRONG_PHASE', 'no hand in progress');
      requirePlayingTurn(next, hand, seat);
      if (!canRevealTrump(next, seat)) fail('ILLEGAL_MOVE', 'trump cannot be revealed now');
      revealTrump(hand, seat, events);
      hand.forcedTrumpSeat = seat;
      break;
    }
    case 'playCard': {
      if (!hand) fail('WRONG_PHASE', 'no hand in progress');
      requirePlayingTurn(next, hand, seat);
      if (needsAutomaticRelease(next)) {
        // Sole exception to "never reveal while leading": the bidder's last card
        // is the reserved one, so trump goes live for the whole final trick.
        revealTrump(hand, seat, events);
      }
      if (!legalCards(next, seat).includes(command.card)) fail('ILLEGAL_MOVE', 'that card cannot be played');
      hand.hands[seat] = hand.hands[seat].filter((card) => card !== command.card);
      hand.currentTrick.plays.push({ seat, card: command.card });
      if (hand.forcedTrumpSeat === seat) hand.forcedTrumpSeat = null;
      events.push({ type: 'cardPlayed', seat, card: command.card });
      if (hand.currentTrick.plays.length === 4) {
        resolveTrick(next, hand, events);
      } else {
        hand.turn = nextSeat(seat);
        autoReleaseIfNeeded(next, hand, events);
      }
      break;
    }
    case 'declarePair': {
      if (!hand || next.phase !== 'PLAYING' || !hand.ack) fail('WRONG_PHASE', 'no acknowledgment window is open');
      if (!canDeclarePair(next, seat)) fail('ILLEGAL_MOVE', 'you cannot declare a marriage now');
      const cards = trumpHonours(hand, seat) as [CardId, CardId];
      const adjustment = teamOf(seat) === teamOf(hand.bidder as Seat) ? -PROFILE.pairAdjustment : PROFILE.pairAdjustment;
      hand.pair = {
        seat,
        team: teamOf(seat),
        cards,
        trickIndex: hand.ack.trickIndex,
        adjustment,
      };
      hand.ack.acknowledged.push(seat);
      events.push({
        type: 'pairDeclared',
        pair: hand.pair,
        target: pairAdjustedTarget(hand.bid as number, adjustment),
      });
      events.push({ type: 'acknowledged', seat });
      closeAckIfComplete(next, hand, events);
      break;
    }
    case 'continueTrick': {
      if (!hand || next.phase !== 'PLAYING' || !hand.ack) fail('WRONG_PHASE', 'no acknowledgment window is open');
      if (hand.ack.acknowledged.includes(seat)) fail('ILLEGAL_MOVE', 'already acknowledged');
      hand.ack.acknowledged.push(seat);
      events.push({ type: 'acknowledged', seat });
      closeAckIfComplete(next, hand, events);
      break;
    }
    case 'nextHand': {
      if (next.phase !== 'HAND_RESULT') fail('WRONG_PHASE', 'no hand result is showing');
      if (next.continues.includes(seat)) fail('ILLEGAL_MOVE', 'already confirmed');
      next.continues.push(seat);
      events.push({ type: 'acknowledged', seat });
      if (next.continues.length === 4) {
        next.continues = [];
        if (next.matchResult) {
          next.phase = 'MATCH_RESULT';
          events.push({ type: 'matchCompleted', winner: next.matchResult.winner });
        } else {
          next.dealer = nextSeat(next.dealer);
          next.handNumber += 1;
          next.hand = null;
          next.phase = 'DEAL_FIRST';
        }
      }
      break;
    }
    case 'rematch': {
      if (next.phase !== 'MATCH_RESULT') fail('WRONG_PHASE', 'the match is still running');
      if (next.continues.includes(seat)) fail('ILLEGAL_MOVE', 'already confirmed');
      next.continues.push(seat);
      events.push({ type: 'acknowledged', seat });
      if (next.continues.length === 4) {
        next.continues = [];
        next.scores = [0, 0];
        next.matchResult = null;
        next.history = [];
        next.handNumber = 1;
        next.hand = null;
        next.phase = 'DEAL_FIRST';
        events.push({ type: 'rematchStarted' });
      }
      break;
    }
    default:
      fail('ILLEGAL_MOVE', 'unknown command');
  }

  return { state: next, events };
}

/** Invariant helper used by tests and by the server's consistency checks. */
export function accountedCards(state: MatchState): CardId[] {
  const hand = state.hand;
  if (!hand) return [];
  const cards: CardId[] = [];
  for (const seat of SEATS) cards.push(...hand.hands[seat]);
  if (hand.reservedCard && !hand.reservedReleased) cards.push(hand.reservedCard);
  for (const trick of hand.tricks) for (const play of trick.plays) cards.push(play.card);
  for (const play of hand.currentTrick.plays) cards.push(play.card);
  return cards;
}
