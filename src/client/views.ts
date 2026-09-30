import {
  RULES_TEXT,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  SUITS,
  cardAccessibleLabel,
  type CardId,
  type Suit,
} from '../engine';
import type { Snapshot } from '../shared/wire';
import { h, fragment } from './dom';

export interface Actions {
  navigate(path: string): void;
  createRoom(name: string, seat: number): void;
  submitPassword(password: string): void;
  claimSeat(name: string, seat: number): void;
  redeemRecovery(code: string): void;
  send(action: string, payload?: Record<string, unknown>): void;
  selectCard(card: CardId | null): void;
  selectBid(value: number | null): void;
  copy(label: string, value: string): void;
  dismissNotice(): void;
}

export interface UiState {
  view: 'home' | 'create' | 'gate' | 'join' | 'room' | 'recover' | 'closed';
  roomId: string | null;
  seats: { seat: number; team: number; name: string | null }[] | null;
  snapshot: Snapshot | null;
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
  statusDetail: string | null;
  notice: { level: 'info' | 'error' | 'warning'; message: string } | null;
  hostPassword: string | null;
  recovery: { code: string; seat: number; expiresAt: string } | null;
  selectedCard: CardId | null;
  selectedBid: number | null;
  busy: boolean;
  log: string[];
}

const TEAM_NAMES = ['Team A', 'Team B'];

function seatLabel(seat: number): string {
  return `Seat ${seat + 1}`;
}

function notice(state: UiState, actions: Actions): HTMLElement | null {
  if (!state.notice) return null;
  return h(
    'div',
    { class: `notice ${state.notice.level}`, role: state.notice.level === 'error' ? 'alert' : 'status' },
    h('p', {}, state.notice.message),
    h('button', { onClick: () => actions.dismissNotice(), 'data-focus': 'dismiss-notice' }, 'Dismiss'),
  );
}

function rulesDrawer(): HTMLElement {
  return h(
    'details',
    { class: 'rules' },
    h('summary', {}, 'Rules of this table'),
    ...RULES_TEXT.map((section) =>
      fragment(
        h('h3', {}, section.heading),
        h('ul', {}, ...section.points.map((point) => h('li', {}, point))),
      ),
    ) as unknown as HTMLElement[],
  );
}

function card(cardId: CardId, options: { played?: boolean; reserved?: boolean } = {}): HTMLElement {
  const rank = cardId.slice(1) === 'T' ? '10' : cardId.slice(1);
  const suit = cardId[0] as Suit;
  return h(
    'span',
    {
      class: `card${options.played ? ' played' : ''}${options.reserved ? ' reserved' : ''}`,
      role: 'img',
      'aria-label': cardAccessibleLabel(cardId),
    },
    h('span', { class: 'rank', 'aria-hidden': 'true' }, rank),
    h('span', { class: 'suit', 'aria-hidden': 'true' }, SUIT_SYMBOLS[suit]),
  );
}

function cardButton(
  cardId: CardId,
  options: { selected: boolean; disabled: boolean; onSelect: () => void },
): HTMLElement {
  const rank = cardId.slice(1) === 'T' ? '10' : cardId.slice(1);
  const suit = cardId[0] as Suit;
  return h(
    'button',
    {
      class: 'card',
      type: 'button',
      'aria-pressed': options.selected ? 'true' : 'false',
      'aria-label': `${cardAccessibleLabel(cardId)}${options.disabled ? ', not playable now' : ''}`,
      'data-focus': `card-${cardId}`,
      disabled: options.disabled,
      onClick: options.onSelect,
    },
    h('span', { class: 'rank', 'aria-hidden': 'true' }, rank),
    h('span', { class: 'suit', 'aria-hidden': 'true' }, SUIT_SYMBOLS[suit]),
  );
}

export function homeView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, '29'),
    h('p', { class: 'lede' }, 'A private table for exactly four people. No accounts, no downloads.'),
    notice(state, actions),
    h(
      'div',
      { class: 'card-panel' },
      h('h2', {}, 'Start a game'),
      h('p', {}, 'Create a table, then share the link and password with three other people.'),
      h(
        'button',
        { class: 'primary', 'data-focus': 'create', onClick: () => actions.navigate('/create') },
        'Create game',
      ),
    ),
    h(
      'div',
      { class: 'card-panel' },
      h('h2', {}, 'Join a game'),
      h('p', {}, 'Open the room link you were sent, then enter the room password.'),
      h(
        'form',
        {
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault();
            const input = (event.target as HTMLFormElement).elements.namedItem('room') as HTMLInputElement;
            const value = input.value.trim().replace(/^.*\/room\//, '');
            if (value) actions.navigate(`/room/${value}`);
          },
        },
        h(
          'p',
          { class: 'field' },
          h('label', { for: 'room' }, 'Room link or room code'),
          h('input', { id: 'room', name: 'room', type: 'text', 'data-focus': 'room', autocomplete: 'off' }),
        ),
        h('button', { class: 'primary', type: 'submit' }, 'Continue'),
      ),
    ),
    rulesDrawer(),
  );
}

export function createView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, 'Create a game'),
    notice(state, actions),
    h(
      'form',
      {
        class: 'card-panel',
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          const name = (form.elements.namedItem('name') as HTMLInputElement).value;
          const seat = Number((form.elements.namedItem('seat') as RadioNodeList).value);
          actions.createRoom(name, seat);
        },
      },
      h(
        'p',
        { class: 'field' },
        h('label', { for: 'name' }, 'Your screen name'),
        h('input', {
          id: 'name',
          name: 'name',
          type: 'text',
          maxlength: '24',
          required: true,
          autocomplete: 'nickname',
          'data-focus': 'name',
        }),
        h('span', { class: 'hint' }, 'Up to 24 characters. Everyone picks their own name.'),
      ),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', {}, 'Your seat'),
        ...[0, 1, 2, 3].map((seat) =>
          h(
            'label',
            { class: 'seat-choice', style: 'display:flex;gap:.5rem;align-items:center;font-weight:400' },
            h('input', {
              type: 'radio',
              name: 'seat',
              value: String(seat),
              checked: seat === 0,
              'data-focus': `seat-${seat}`,
            }),
            `${seatLabel(seat)} — ${TEAM_NAMES[seat % 2]}`,
          ),
        ),
        h('span', { class: 'hint' }, 'Seats 1 and 3 are partners; seats 2 and 4 are partners.'),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, 'Create game'),
    ),
    h('button', { onClick: () => actions.navigate('/') }, 'Back'),
  );
}

export function gateView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, 'Enter the room password'),
    h('p', { class: 'lede' }, 'The host shares this privately. It is not part of the room link.'),
    notice(state, actions),
    h(
      'form',
      {
        class: 'card-panel',
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          actions.submitPassword((form.elements.namedItem('password') as HTMLInputElement).value);
        },
      },
      h(
        'p',
        { class: 'field' },
        h('label', { for: 'password' }, 'Room password'),
        h('input', {
          id: 'password',
          name: 'password',
          type: 'password',
          required: true,
          autocomplete: 'off',
          spellcheck: 'false',
          'data-focus': 'password',
        }),
        h('span', { class: 'hint' }, 'Upper or lower case, with or without the hyphens.'),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, 'Continue'),
    ),
    h(
      'details',
      { class: 'rules' },
      h('summary', {}, 'Lost your seat after closing the browser?'),
      h('p', {}, 'Ask the host for a recovery code for your seat, then enter it here.'),
      h(
        'form',
        {
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault();
            const form = event.target as HTMLFormElement;
            actions.redeemRecovery((form.elements.namedItem('code') as HTMLInputElement).value);
          },
        },
        h(
          'p',
          { class: 'field' },
          h('label', { for: 'code' }, 'Recovery code'),
          h('input', { id: 'code', name: 'code', type: 'text', autocomplete: 'off', 'data-focus': 'code' }),
        ),
        h('button', { type: 'submit' }, 'Recover my seat'),
      ),
    ),
  );
}

export function joinView(state: UiState, actions: Actions): HTMLElement {
  const seats = state.seats ?? [];
  const free = seats.filter((seat) => seat.name === null);
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, 'Choose your name and seat'),
    notice(state, actions),
    h(
      'form',
      {
        class: 'card-panel',
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          const name = (form.elements.namedItem('name') as HTMLInputElement).value;
          const seatField = form.elements.namedItem('seat') as RadioNodeList | null;
          if (!seatField) return;
          actions.claimSeat(name, Number(seatField.value));
        },
      },
      h(
        'p',
        { class: 'field' },
        h('label', { for: 'name' }, 'Your screen name'),
        h('input', {
          id: 'name',
          name: 'name',
          type: 'text',
          maxlength: '24',
          required: true,
          autocomplete: 'nickname',
          'data-focus': 'name',
        }),
      ),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', {}, 'Free seats'),
        ...seats.map((seat) =>
          seat.name === null
            ? h(
                'label',
                { style: 'display:flex;gap:.5rem;align-items:center;font-weight:400' },
                h('input', {
                  type: 'radio',
                  name: 'seat',
                  value: String(seat.seat),
                  checked: free[0]?.seat === seat.seat,
                  'data-focus': `seat-${seat.seat}`,
                }),
                `${seatLabel(seat.seat)} — ${TEAM_NAMES[seat.team]}`,
              )
            : h(
                'p',
                { class: 'hint' },
                `${seatLabel(seat.seat)} — ${TEAM_NAMES[seat.team]}: ${seat.name} (taken)`,
              ),
        ),
      ),
      free.length === 0
        ? h('p', { class: 'notice error' }, 'Every seat is taken in this room.')
        : h('button', { class: 'primary', type: 'submit', disabled: state.busy }, 'Join this table'),
    ),
    rulesDrawer(),
  );
}

export function recoverView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, 'Recover your seat'),
    notice(state, actions),
    h(
      'form',
      {
        class: 'card-panel',
        onSubmit: (event: SubmitEvent) => {
          event.preventDefault();
          const form = event.target as HTMLFormElement;
          actions.redeemRecovery((form.elements.namedItem('code') as HTMLInputElement).value);
        },
      },
      h(
        'p',
        { class: 'field' },
        h('label', { for: 'code' }, 'One-time recovery code'),
        h('input', { id: 'code', name: 'code', type: 'text', required: true, 'data-focus': 'code' }),
        h('span', { class: 'hint' }, 'The host can issue one after checking who you are.'),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, 'Recover my seat'),
    ),
  );
}

export function closedView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    h('h1', {}, 'This room is closed'),
    h(
      'p',
      {},
      state.statusDetail === 'expired'
        ? 'The room expired. Rooms close after a period without activity, and after 24 hours at the latest.'
        : 'The host closed this room, or it is no longer available.',
    ),
    h('button', { class: 'primary', 'data-focus': 'home', onClick: () => actions.navigate('/') }, 'Back to the start'),
  );
}

function connectionBanner(state: UiState): HTMLElement | null {
  if (state.status === 'open') return null;
  const message =
    state.status === 'reconnecting'
      ? 'Reconnecting—actions paused'
      : state.status === 'connecting'
        ? 'Connecting…'
        : state.statusDetail === 'replaced'
          ? 'This seat is open in another tab. This view is no longer active.'
          : 'Disconnected.';
  return h('div', { class: 'banner', role: 'status' }, message);
}

function lobbyPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const you = snapshot.you;
  const seats = snapshot.seats;
  return h(
    'div',
    {},
    h('h2', {}, 'Lobby'),
    h(
      'ul',
      { class: 'seat-list' },
      ...seats.map((seat) =>
        h(
          'li',
          { class: seat.isYou ? 'is-you' : '' },
          h(
            'span',
            {},
            h('strong', {}, seat.name ?? 'Empty'),
            ' ',
            h('span', { class: 'tag' }, `${seatLabel(seat.seat)} · ${TEAM_NAMES[seat.team]}`),
          ),
          h(
            'span',
            {},
            seat.isHost ? h('span', { class: 'tag' }, 'Host') : null,
            ' ',
            seat.name ? h('span', { class: 'tag' }, seat.connected ? 'Connected' : 'Away') : null,
            ' ',
            seat.name ? h('span', { class: 'tag' }, seat.ready ? 'Ready' : 'Not ready') : null,
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card-panel' },
      h('h3', {}, 'Your details'),
      h(
        'form',
        {
          onSubmit: (event: SubmitEvent) => {
            event.preventDefault();
            const form = event.target as HTMLFormElement;
            actions.send('updateOwnName', {
              name: (form.elements.namedItem('newname') as HTMLInputElement).value,
            });
          },
        },
        h(
          'p',
          { class: 'field' },
          h('label', { for: 'newname' }, 'Your screen name'),
          h('input', {
            id: 'newname',
            name: 'newname',
            type: 'text',
            maxlength: '24',
            value: you.name,
            'data-focus': 'newname',
          }),
        ),
        h('button', { type: 'submit' }, 'Change my name'),
      ),
      h('p', { class: 'hint' }, 'Changing your name or seat clears everyone’s ready mark.'),
      h(
        'div',
        { class: 'button-row' },
        ...seats
          .filter((seat) => seat.name === null)
          .map((seat) =>
            h(
              'button',
              {
                'data-focus': `move-${seat.seat}`,
                onClick: () => actions.send('moveOwnSeat', { seat: seat.seat }),
              },
              `Move to ${seatLabel(seat.seat)} (${TEAM_NAMES[seat.team]})`,
            ),
          ),
      ),
      h(
        'div',
        { class: 'button-row', style: 'margin-top:.75rem' },
        h(
          'button',
          {
            class: you.ready ? '' : 'primary',
            'data-focus': 'ready',
            onClick: () => actions.send('ready', { ready: !you.ready }),
          },
          you.ready ? 'Not ready yet' : 'I am ready',
        ),
      ),
    ),
    you.isHost ? hostPanel(state, actions) : null,
  );
}

function hostPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const password = snapshot.password ?? state.hostPassword;
  const link = `${location.origin}/room/${snapshot.room.id}`;
  return h(
    'div',
    { class: 'card-panel' },
    h('h3', {}, 'Host controls'),
    h('p', {}, 'Share the link and the password separately, and only with your three players.'),
    h('p', {}, h('code', { class: 'secret' }, link)),
    h(
      'div',
      { class: 'button-row' },
      h('button', { 'data-focus': 'copy-link', onClick: () => actions.copy('Room link', link) }, 'Copy room link'),
      password
        ? h(
            'button',
            { 'data-focus': 'copy-pass', onClick: () => actions.copy('Room password', password) },
            'Copy password',
          )
        : null,
    ),
    password
      ? h(
          'details',
          { class: 'rules' },
          h('summary', {}, 'Show room password'),
          h('p', {}, h('code', { class: 'secret' }, password)),
        )
      : null,
    h(
      'div',
      { class: 'button-row', style: 'margin-top:.75rem' },
      h(
        'button',
        {
          class: 'primary',
          disabled: !snapshot.canStart,
          'data-focus': 'start',
          onClick: () => actions.send('start'),
        },
        'Start match',
      ),
      h('button', { onClick: () => actions.send('rotatePassword') }, 'New password'),
      h('button', { class: 'danger', onClick: () => actions.send('closeRoom') }, 'Close room'),
    ),
    !snapshot.canStart
      ? h('p', { class: 'hint' }, 'Start becomes available when all four seats are filled, connected and ready.')
      : null,
    h(
      'div',
      { class: 'button-row', style: 'margin-top:.75rem' },
      ...snapshot.seats
        .filter((seat) => seat.name !== null && !seat.isYou)
        .map((seat) =>
          h(
            'button',
            { class: 'danger', onClick: () => actions.send('removeMember', { seat: seat.seat }) },
            `Remove ${seat.name}`,
          ),
        ),
    ),
    state.recovery
      ? h(
          'div',
          { class: 'notice' },
          h('p', {}, `One-time recovery code for ${seatLabel(state.recovery.seat)} (valid five minutes):`),
          h('p', {}, h('code', { class: 'secret' }, state.recovery.code)),
          h('p', { class: 'hint' }, 'Give it to that person directly. It works once.'),
        )
      : null,
  );
}

function statusLine(snapshot: Snapshot): HTMLElement {
  const match = snapshot.match;
  const hand = match?.hand ?? null;
  const trumpText =
    hand === null
      ? '—'
      : hand.trumpStatus === 'revealed'
        ? `${SUIT_NAMES[hand.trump as Suit]} ${SUIT_SYMBOLS[hand.trump as Suit]}`
        : hand.trumpStatus === 'hidden'
          ? hand.trump
            ? `Hidden (yours: ${SUIT_NAMES[hand.trump]})`
            : 'Hidden'
          : 'Not chosen';
  return h(
    'ul',
    { class: 'status-line' },
    h('li', {}, 'Hand ', h('strong', {}, String(match?.handNumber ?? 1))),
    h('li', {}, 'Dealer ', h('strong', {}, seatLabel(match?.dealer ?? 0))),
    h(
      'li',
      {},
      'Contract ',
      h('strong', {}, hand?.bid ? `${hand.bid} by ${seatLabel(hand.bidder as number)}` : 'in the auction'),
    ),
    h('li', {}, 'Stake ', h('strong', {}, `×${hand?.stake ?? 1}`)),
    h('li', {}, 'Trump ', h('strong', {}, trumpText)),
    h('li', {}, 'Trick ', h('strong', {}, `${hand?.trickNumber ?? 1} of 8`)),
    h('li', {}, 'Team A ', h('strong', {}, String(match?.scores[0] ?? 0))),
    h('li', {}, 'Team B ', h('strong', {}, String(match?.scores[1] ?? 0))),
  );
}

function seatBox(snapshot: Snapshot, seat: number, position: string): HTMLElement {
  const info = snapshot.seats[seat];
  const match = snapshot.match;
  const hand = match?.hand ?? null;
  const isTurn = hand?.turn === seat && match?.phase === 'PLAYING';
  const flags: string[] = [];
  if (match && match.dealer === seat) flags.push('dealer');
  if (hand?.bidder === seat) flags.push('contract');
  if (info && !info.connected) flags.push('away');
  const acknowledged = hand?.ack?.acknowledged.includes(seat as 0 | 1 | 2 | 3);
  if (hand?.ack) flags.push(acknowledged ? 'ready for next trick' : 'confirming');
  return h(
    'div',
    {
      class: `seat-box ${position}${isTurn ? ' turn' : ''}`,
      'aria-current': isTurn ? 'true' : null,
    },
    h('span', { class: 'seat-name' }, info?.name ?? 'Empty'),
    h('span', { class: 'flags' }, `${seatLabel(seat)} · ${TEAM_NAMES[seat % 2]}`),
    hand ? h('span', { class: 'flags' }, `${hand.cardCounts[seat as 0 | 1 | 2 | 3] ?? 0} cards`) : null,
    flags.length > 0 ? h('span', { class: 'flags' }, flags.join(' · ')) : null,
    isTurn ? h('span', { class: 'flags' }, 'to play') : null,
  );
}

function trickArea(snapshot: Snapshot): HTMLElement {
  const hand = snapshot.match?.hand;
  const plays = hand?.currentTrick.plays ?? [];
  return h(
    'div',
    { class: 'trick', 'aria-label': 'Cards played to the current trick' },
    ...(plays.length === 0
      ? [h('span', { class: 'flags' }, 'No cards yet')]
      : plays.map((play) =>
          h(
            'span',
            { style: 'text-align:center' },
            card(play.card as CardId, { played: true }),
            h('span', { class: 'flags' }, seatLabel(play.seat)),
          ),
        )),
  );
}

function actionPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  if (!match) return h('div', {});
  const available = match.actions;
  const hand = match.hand;
  const paused = snapshot.paused !== null;

  if (paused) {
    return h(
      'div',
      { class: 'card-panel', role: 'status' },
      h('h2', {}, 'Paused'),
      h(
        'p',
        {},
        `Waiting for ${snapshot.paused?.seats.map((seat) => snapshot.seats[seat]?.name ?? seatLabel(seat)).join(', ')} to reconnect. Nothing is lost.`,
      ),
      h(
        'p',
        { class: 'hint' },
        'The host can issue a recovery code, or all remaining players can end the match with no winner.',
      ),
      h(
        'div',
        { class: 'button-row' },
        snapshot.you.isHost
          ? fragment(
              ...(snapshot.paused?.seats ?? []).map((seat) =>
                h(
                  'button',
                  { onClick: () => actions.send('issueRecovery', { seat }) },
                  `Recovery code for ${seatLabel(seat)}`,
                ),
              ),
            )
          : null,
        h('button', { class: 'danger', onClick: () => actions.send('abandonMatch') }, 'End match, no winner'),
      ),
      state.recovery
        ? h(
            'div',
            { class: 'notice' },
            h('p', {}, `Recovery code for ${seatLabel(state.recovery.seat)}:`),
            h('p', {}, h('code', { class: 'secret' }, state.recovery.code)),
          )
        : null,
    );
  }

  switch (match.phase) {
    case 'BIDDING': {
      if (available.bids.length === 0) {
        return h(
          'div',
          { class: 'card-panel', role: 'status' },
          h('h2', {}, 'Auction'),
          h('p', {}, `Waiting for ${snapshot.seats[hand?.auction.turn ?? 0]?.name ?? 'the next player'} to bid.`),
          auctionHistory(snapshot),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, 'Your bid'),
        h(
          'div',
          { class: 'bid-grid', role: 'group', 'aria-label': 'Available bids' },
          ...available.bids.map((value) =>
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': state.selectedBid === value ? 'true' : 'false',
                'data-focus': `bid-${value}`,
                onClick: () => actions.selectBid(value),
              },
              String(value),
            ),
          ),
        ),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              class: 'primary',
              disabled: state.selectedBid === null,
              'data-focus': 'bid-confirm',
              onClick: () => actions.send('bid', { value: state.selectedBid }),
            },
            state.selectedBid === null ? 'Bid' : `Bid ${state.selectedBid}`,
          ),
          h('button', { 'data-focus': 'pass', onClick: () => actions.send('pass') }, 'Pass'),
        ),
        auctionHistory(snapshot),
      );
    }
    case 'CHOOSE_TRUMP': {
      if (!available.canChooseTrump) {
        return h(
          'div',
          { class: 'card-panel', role: 'status' },
          h('h2', {}, 'Trump'),
          h('p', {}, `${snapshot.seats[hand?.bidder ?? 0]?.name ?? 'The contract holder'} is choosing trump.`),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, 'Choose trump'),
        h('p', { class: 'hint' }, 'Only you will see the suit until it is revealed in play.'),
        h(
          'div',
          { class: 'button-row' },
          ...SUITS.map((suit) =>
            h(
              'button',
              {
                'data-focus': `trump-${suit}`,
                onClick: () => actions.send('chooseTrump', { mode: 'suit', suit }),
              },
              `${SUIT_NAMES[suit]} ${SUIT_SYMBOLS[suit]}`,
            ),
          ),
          h(
            'button',
            { class: 'primary', 'data-focus': 'trump-seventh', onClick: () => actions.send('chooseTrump', { mode: 'seventh' }) },
            'Seventh card',
          ),
        ),
        h(
          'p',
          { class: 'hint' },
          'Seventh card: trump becomes the suit of the seventh card of your own deal, held aside until the reveal.',
        ),
      );
    }
    case 'DOUBLE_WINDOW':
    case 'REDOUBLE_WINDOW': {
      const isRedouble = match.phase === 'REDOUBLE_WINDOW';
      const actor = hand?.doubling.actor ?? null;
      const yourTurn = isRedouble ? available.canRedouble : available.canDouble;
      if (!yourTurn) {
        return h(
          'div',
          { class: 'card-panel', role: 'status' },
          h('h2', {}, isRedouble ? 'Redouble' : 'Double'),
          h('p', {}, `Waiting for ${actor === null ? 'a decision' : (snapshot.seats[actor]?.name ?? seatLabel(actor))}.`),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, isRedouble ? 'Redouble?' : 'Double?'),
        h(
          'p',
          {},
          isRedouble
            ? 'A redouble makes the hand worth four match points either way.'
            : 'A double makes the hand worth two match points either way.',
        ),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              class: 'primary',
              'data-focus': 'double',
              onClick: () => actions.send(isRedouble ? 'redouble' : 'double'),
            },
            isRedouble ? 'Redouble' : 'Double',
          ),
          h(
            'button',
            {
              'data-focus': 'pass-double',
              onClick: () => actions.send(isRedouble ? 'passRedouble' : 'passDouble'),
            },
            'Pass',
          ),
        ),
      );
    }
    case 'PLAYING': {
      if (hand?.ack) {
        return h(
          'div',
          { class: 'card-panel' },
          h('h2', {}, 'Between tricks'),
          h(
            'p',
            {},
            `${seatLabel(hand.tricks[hand.ack.trickIndex]?.winner ?? 0)} won trick ${hand.ack.trickIndex + 1} for ${hand.tricks[hand.ack.trickIndex]?.points ?? 0} points.`,
          ),
          h(
            'div',
            { class: 'button-row' },
            h(
              'button',
              {
                class: 'primary',
                disabled: !available.canContinueTrick,
                'data-focus': 'continue',
                onClick: () => actions.send('continueTrick'),
              },
              available.canContinueTrick ? 'Continue' : 'Waiting for the others',
            ),
            available.canDeclarePair
              ? h(
                  'button',
                  { 'data-focus': 'declare', onClick: () => actions.send('declarePair') },
                  'Declare marriage',
                )
              : null,
          ),
          h(
            'p',
            { class: 'hint' },
            `${hand.ack.acknowledged.length} of 4 have confirmed. Everyone sees this pause.`,
          ),
        );
      }
      const yourTurn = available.legalCards.length > 0;
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, yourTurn ? 'Your turn' : 'Play'),
        h(
          'p',
          { role: 'status' },
          yourTurn
            ? state.selectedCard
              ? `Selected ${cardAccessibleLabel(state.selectedCard)}.`
              : 'Choose a card, then confirm.'
            : `Waiting for ${snapshot.seats[hand?.turn ?? 0]?.name ?? 'the next player'}.`,
        ),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              class: 'primary',
              disabled: !yourTurn || state.selectedCard === null,
              'data-focus': 'play',
              onClick: () => actions.send('playCard', { card: state.selectedCard }),
            },
            'Play card',
          ),
          available.canRevealTrump
            ? h(
                'button',
                { 'data-focus': 'reveal', onClick: () => actions.send('revealTrump') },
                'Reveal trump',
              )
            : null,
        ),
        available.canRevealTrump
          ? h(
              'p',
              { class: 'hint' },
              'You cannot follow the led suit. Reveal trump and you must then play trump if you hold one, or discard and keep it hidden.',
            )
          : null,
      );
    }
    case 'HAND_RESULT':
      return handResultPanel(state, actions);
    case 'MATCH_RESULT':
      return matchResultPanel(state, actions);
    default:
      return h('div', { class: 'card-panel', role: 'status' }, h('p', {}, 'Dealing…'));
  }
}

function auctionHistory(snapshot: Snapshot): HTMLElement {
  const history = snapshot.match?.hand?.auction.history ?? [];
  if (history.length === 0) return h('p', { class: 'hint' }, 'No bids yet.');
  return h(
    'ol',
    { class: 'log' },
    ...history.map((entry) =>
      h(
        'li',
        {},
        `${snapshot.seats[entry.seat]?.name ?? seatLabel(entry.seat)}: ${
          entry.action === 'pass' ? 'passed' : `bid ${entry.value}${entry.forced ? ' (forced)' : ''}`
        }`,
      ),
    ),
  );
}

function handResultPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  const result = match?.hand?.result ?? match?.history.at(-1) ?? null;
  if (!result) return h('div', { class: 'card-panel' }, h('p', {}, 'Scoring…'));
  const rows: [string, string][] = result.annulled
    ? [
        ['Bid', `${result.bid} by ${seatLabel(result.bidder)}`],
        ['Outcome', 'Hand annulled: trump was not revealed'],
        ['Match points', 'No change'],
      ]
    : [
        ['Bid', `${result.bid} by ${seatLabel(result.bidder)} (${TEAM_NAMES[result.bidderTeam]})`],
        ['Marriage adjustment', result.pairAdjustment === 0 ? 'None' : `${result.pairAdjustment > 0 ? '+' : ''}${result.pairAdjustment}`],
        ['Target', String(result.target)],
        ['Team A card points', String(result.capturedPoints[0])],
        ['Team B card points', String(result.capturedPoints[1])],
        ['Stake', `×${result.stake}`],
        ['Contract', result.contractMade ? 'Made' : 'Failed'],
        [
          'Match points',
          `Team A ${result.scoreDelta[0] >= 0 ? '+' : ''}${result.scoreDelta[0]}, Team B ${result.scoreDelta[1] >= 0 ? '+' : ''}${result.scoreDelta[1]}`,
        ],
        ['Score now', `Team A ${result.scoresAfter[0]} · Team B ${result.scoresAfter[1]}`],
      ];
  return h(
    'div',
    { class: 'card-panel' },
    h('h2', {}, `Hand ${result.handNumber} result`),
    h(
      'table',
      { class: 'scores' },
      h('tbody', {}, ...rows.map(([label, value]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value)))),
    ),
    match?.matchResult
      ? h('p', {}, `${TEAM_NAMES[match.matchResult.winner]} has won the match.`)
      : null,
    h(
      'div',
      { class: 'button-row' },
      h(
        'button',
        {
          class: 'primary',
          disabled: !match?.actions.canNextHand,
          'data-focus': 'next-hand',
          onClick: () => actions.send('nextHand'),
        },
        match?.actions.canNextHand ? 'Next hand' : 'Waiting for the others',
      ),
    ),
    h('p', { class: 'hint' }, `${match?.continues.length ?? 0} of 4 ready to continue.`),
  );
}

function matchResultPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  const winner = match?.matchResult?.winner ?? 0;
  return h(
    'div',
    { class: 'card-panel' },
    h('h2', {}, `${TEAM_NAMES[winner]} wins the match`),
    h('p', {}, `Final score: Team A ${match?.scores[0] ?? 0}, Team B ${match?.scores[1] ?? 0}.`),
    h(
      'table',
      { class: 'scores' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Hand'),
          h('th', { scope: 'col' }, 'Contract'),
          h('th', { scope: 'col' }, 'Result'),
          h('th', { scope: 'col' }, 'Score'),
        ),
      ),
      h(
        'tbody',
        {},
        ...(match?.history ?? []).map((entry) =>
          h(
            'tr',
            {},
            h('td', {}, String(entry.handNumber)),
            h('td', {}, `${entry.bid} by ${seatLabel(entry.bidder)} ×${entry.stake}`),
            h('td', {}, entry.annulled ? 'Annulled' : entry.contractMade ? 'Made' : 'Failed'),
            h('td', {}, `${entry.scoresAfter[0]} – ${entry.scoresAfter[1]}`),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'button-row' },
      h(
        'button',
        {
          class: 'primary',
          disabled: !match?.actions.canRematch,
          'data-focus': 'rematch',
          onClick: () => actions.send('rematch'),
        },
        match?.actions.canRematch ? 'Rematch' : 'Waiting for the others',
      ),
      h('button', { onClick: () => actions.navigate('/') }, 'Leave'),
    ),
    h('p', { class: 'hint' }, 'A rematch keeps the same seats and resets both scores.'),
  );
}

function handPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  const hand = match?.hand;
  if (!hand) return h('div', {});
  const legal = match?.actions.legalCards ?? [];
  const selectable = match?.phase === 'PLAYING' && !hand.ack && legal.length > 0;
  return h(
    'section',
    { 'aria-label': 'Your hand' },
    h('h2', {}, 'Your hand'),
    h(
      'ul',
      { class: 'hand' },
      ...hand.yourCards.map((cardId) =>
        h(
          'li',
          {},
          cardButton(cardId as CardId, {
            selected: state.selectedCard === cardId,
            disabled: !selectable || !legal.includes(cardId),
            onSelect: () => actions.selectCard(state.selectedCard === cardId ? null : (cardId as CardId)),
          }),
        ),
      ),
    ),
    hand.reservedCard
      ? h(
          'p',
          {},
          h('span', { class: 'hint' }, 'Reserved seventh card (not playable until trump is revealed): '),
          card(hand.reservedCard.card as CardId, { reserved: true }),
          h('span', { class: 'hint' }, ` Trump will be ${SUIT_NAMES[hand.reservedCard.suit]}.`),
        )
      : null,
  );
}

export function roomView(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return h('main', { id: 'main', class: 'screen' }, h('h1', {}, '29'), h('p', {}, 'Loading the table…'));
  }
  if (snapshot.room.status === 'closed' || snapshot.room.status === 'expired') {
    return closedView({ ...state, statusDetail: snapshot.room.status }, actions);
  }
  const you = snapshot.you;
  const left = (you.seat + 1) % 4;
  const partner = (you.seat + 2) % 4;
  const right = (you.seat + 3) % 4;

  return h(
    'div',
    {},
    connectionBanner(state),
    snapshot.room.expiryWarning
      ? h('div', { class: 'banner', role: 'status' }, 'This room closes soon unless someone acts.')
      : null,
    h(
      'main',
      { id: 'main', class: 'screen' },
      h('h1', {}, snapshot.room.status === 'lobby' ? 'Lobby' : 'Table'),
      notice(state, actions),
      snapshot.room.status === 'lobby'
        ? lobbyPanel(state, actions)
        : fragment(
            statusLine(snapshot),
            h(
              'div',
              { class: 'table' },
              seatBox(snapshot, partner, 'partner'),
              seatBox(snapshot, left, 'left'),
              trickArea(snapshot),
              seatBox(snapshot, right, 'right'),
              seatBox(snapshot, you.seat, 'you'),
            ),
            actionPanel(state, actions),
            handPanel(state, actions),
            state.log.length > 0
              ? h(
                  'details',
                  { class: 'rules' },
                  h('summary', {}, 'Recent actions'),
                  h('ul', { class: 'log' }, ...state.log.slice(-20).reverse().map((line) => h('li', {}, line))),
                )
              : null,
          ),
      rulesDrawer(),
      h(
        'p',
        { class: 'hint' },
        `You are ${you.name}, ${seatLabel(you.seat)}, ${TEAM_NAMES[you.team]}. Rules version ${snapshot.room.rulesVersion}.`,
      ),
    ),
  );
}
