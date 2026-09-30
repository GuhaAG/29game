import { RULES_VERSION } from './types';

/**
 * The frozen rule profile (rulesVersion=1) confirmed in SPEC.md §2.
 * The client rules drawer renders `RULES_TEXT`, so displayed rules and engine
 * behaviour always come from the same module.
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

export const RULES_TEXT: { heading: string; points: string[] }[] = [
  {
    heading: 'Cards and points',
    points: [
      '32 cards: J, 9, A, 10, K, Q, 8, 7 in each suit, listed strongest first.',
      'Jack 3 points, nine 2 points, ace 1 point, ten 1 point; king, queen, eight and seven score nothing.',
      'Every hand contains exactly 28 card points. There is no point for the last trick.',
    ],
  },
  {
    heading: 'Seats and teams',
    points: [
      'Four players, seats 1–4 clockwise. Seats opposite one another are partners.',
      'Seats and teams are locked once the host starts the match.',
    ],
  },
  {
    heading: 'Deal and auction',
    points: [
      'Four cards are dealt to each player, then bidding runs clockwise from the dealer’s left.',
      'Bids are whole numbers from 16 to 28 and each new bid must beat the previous one.',
      'If the first three players pass, the dealer is forced to take the contract at 16.',
      'Otherwise the auction ends after three consecutive passes. A bid of 28 ends it immediately.',
      'Passing never removes you from the auction; you may bid again on a later turn.',
    ],
  },
  {
    heading: 'Trump',
    points: [
      'The winning bidder secretly picks a trump suit, or picks “seventh card”.',
      'With “seventh card”, trump is the suit of the seventh card of the bidder’s own deal — the third card of their second batch. That card is held back, outside the playable hand, until trump is revealed.',
      'Unrevealed trump has no power. Other players only see that trump is hidden.',
    ],
  },
  {
    heading: 'Double and redouble',
    points: [
      'After trump is chosen, each defender in turn may double or pass; the first double closes the window and sets the stake to 2.',
      'After a double, the bidder and then their partner may redouble or pass; the first redouble sets the stake to 4.',
      'The stake multiplies match points only. It never changes the bid, the card points, or the marriage adjustment.',
    ],
  },
  {
    heading: 'Play',
    points: [
      'The player to the dealer’s left leads the first trick; afterwards the trick winner leads.',
      'You must follow the suit led if you can.',
      'If you cannot follow, you may reveal trump or simply discard. Revealing is only possible on your turn when you cannot follow suit — never while leading.',
      'A player who asks for the reveal must then play trump if they hold one; after a seventh-card release, following the led suit still comes first.',
      'Once revealed, trump counts for the whole of the current trick, including cards already played to it. Completed tricks never change.',
      'The strongest trump wins a trick once trump is live; otherwise the strongest card of the led suit wins.',
      'If the bidder’s only remaining card is the reserved seventh card, it is revealed and released automatically before they play — the one case where a reveal happens on a lead.',
    ],
  },
  {
    heading: 'Marriage (pair)',
    points: [
      'After any trick except the last, every player confirms “Continue”.',
      'In that window, a player holding both the trump king and queen may declare a marriage, provided trump has been revealed and their team just won the trick.',
      'A marriage lowers the bidder’s target by 4, or raises it by 4 when the defenders declare; the target always stays between 16 and 28.',
      'Only one marriage counts per hand, and the two cards stay in the holder’s hand.',
    ],
  },
  {
    heading: 'Scoring',
    points: [
      'The bidding team succeeds when its captured card points reach the adjusted target.',
      'Success adds the stake (1, 2 or 4) to the bidding team’s match score; failure subtracts it. The other team’s score is unchanged.',
      'If trump is never revealed the hand is annulled: no match points change and the deal rotates.',
      'A team reaching +6 or more wins the match; a team reaching −6 or less loses it.',
    ],
  },
];
