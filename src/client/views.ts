import { SUITS, rankOf, suitOf, type CardId, type Suit } from '../engine';
import type { Snapshot } from '../shared/wire';
import { h, fragment } from './dom';
import { rulesSections, t } from './text';

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

function clubHeader(): HTMLElement {
  return h('header', { class: 'club-header' },
    h('a', { class: 'club-brand', href: '/', 'aria-label': t('header.homeLabel') }, t('app.brand'),
      h('span', {}, t('header.tagline'))),
    h('span', { class: 'club-private' }, t('header.private')),
  );
}

function teamName(team: number): string {
  return t(`teams.${team}`);
}

function seatLabel(seat: number): string {
  return t('seat.label', { n: seat + 1 });
}

function suitName(suit: string): string {
  return t(`suits.${suit}.name`);
}

function suitSymbol(suit: string): string {
  return t(`suits.${suit}.symbol`);
}

function cardAccessibleLabel(cardId: CardId): string {
  return t('card.label', { rank: t(`ranks.${rankOf(cardId)}`), suit: suitName(suitOf(cardId)) });
}

function cardsCount(count: number): string {
  return t('card.count', { count });
}

function seatWithTeam(seat: number, team: number): string {
  return t('seat.withTeam', { seat: seatLabel(seat), team: teamName(team) });
}

function notice(state: UiState, actions: Actions): HTMLElement | null {
  if (!state.notice) return null;
  return h(
    'div',
    { class: `notice ${state.notice.level}`, role: state.notice.level === 'error' ? 'alert' : 'status' },
    h('p', {}, state.notice.message),
    h('button', { onClick: () => actions.dismissNotice(), 'data-focus': 'dismiss-notice' }, t('common.dismiss')),
  );
}

function rulesDrawer(): HTMLElement {
  return h(
    'details',
    { class: 'rules' },
    h('summary', {}, t('rules.summary')),
    ...rulesSections().map((section) =>
      fragment(
        h('h3', {}, section.heading),
        h('ul', {}, ...section.points.map((point) => h('li', {}, point))),
      ),
    ) as unknown as HTMLElement[],
  );
}

function card(cardId: CardId, options: { played?: boolean; reserved?: boolean } = {}): HTMLElement {
  const rank = t(`rankFaces.${rankOf(cardId)}`);
  const suit = cardId[0] as Suit;
  return h(
    'span',
    {
      class: `card suit-${suit}${options.played ? ' played' : ''}${options.reserved ? ' reserved' : ''}`,
      role: 'img',
      'aria-label': cardAccessibleLabel(cardId),
    },
    h('span', { class: 'rank', 'aria-hidden': 'true' }, rank),
    h('span', { class: 'suit', 'aria-hidden': 'true' }, suitSymbol(suit)),
  );
}

function cardButton(
  cardId: CardId,
  options: { selected: boolean; disabled: boolean; onSelect: () => void },
): HTMLElement {
  const rank = t(`rankFaces.${rankOf(cardId)}`);
  const suit = cardId[0] as Suit;
  return h(
    'button',
    {
      class: `card suit-${suit}`,
      type: 'button',
      'aria-pressed': options.selected ? 'true' : 'false',
      'aria-label': `${cardAccessibleLabel(cardId)}${options.disabled ? t('card.notPlayableSuffix') : ''}`,
      'data-focus': `card-${cardId}`,
      disabled: options.disabled,
      onClick: options.onSelect,
    },
    h('span', { class: 'rank', 'aria-hidden': 'true' }, rank),
    h('span', { class: 'suit', 'aria-hidden': 'true' }, suitSymbol(suit)),
  );
}

export function homeView(state: UiState, actions: Actions): HTMLElement {
  return h('main', { id: 'main', class: 'screen home-screen' },
    clubHeader(),
    notice(state, actions),
    h('div', { class: 'home-layout' },
      h('section', { class: 'home-copy' },
        h('p', { class: 'eyebrow' }, t('home.eyebrow')),
        h('h1', {}, t('home.headlineLine1'), h('br', {}), t('home.headlineLine2')),
        h('p', { class: 'lede' }, t('home.lede')),
        h('p', { class: 'hint' }, t('home.hint')),
        h('button', { class: 'primary home-create', 'data-focus': 'create', onClick: () => actions.navigate('/create') }, t('home.createButton'), h('span', { 'aria-hidden': 'true' }, t('home.createArrow'))),
        h('section', { class: 'home-join' },
          h('h2', {}, t('home.joinHeading')),
          h('p', { class: 'hint' }, t('home.joinHint')),
          h('form', {
            onSubmit: (event: SubmitEvent) => {
              event.preventDefault();
              const input = (event.target as HTMLFormElement).elements.namedItem('room') as HTMLInputElement;
              const value = input.value.trim().replace(/^.*\/room\//, '');
              if (value) actions.navigate(`/room/${value}`);
            },
          },
            h('label', { for: 'room' }, t('home.joinLabel')),
            h('div', { class: 'join-row' },
              h('input', { id: 'room', name: 'room', type: 'text', placeholder: t('home.joinPlaceholder'), 'data-focus': 'room', autocomplete: 'off' }),
              h('button', { type: 'submit' }, t('home.joinButton')),
            ),
          ),
        ),
      ),
      h('div', { class: 'home-art', 'aria-hidden': 'true' },
        h('div', { class: 'art-cards' }, card('SJ'), card('H9'), card('CA')),
        h('span', { class: 'art-caption' }, t('home.artCaption')),
      ),
    ),
    rulesDrawer(),
    h('footer', { class: 'club-footer' }, t('footer.left'), h('span', {}, t('footer.right'))),
  );
}

export function createView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    clubHeader(),
    h('h1', {}, t('create.heading')),
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
        h('label', { for: 'name' }, t('common.screenName')),
        h('input', {
          id: 'name',
          name: 'name',
          type: 'text',
          maxlength: '24',
          required: true,
          autocomplete: 'nickname',
          'data-focus': 'name',
        }),
        h('span', { class: 'hint' }, t('create.nameHint')),
      ),
      h(
        'fieldset',
        { class: 'field' },
        h('legend', {}, t('create.seatLegend')),
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
            seatWithTeam(seat, seat % 2),
          ),
        ),
        h('span', { class: 'hint' }, t('create.seatHint')),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, t('create.submit')),
    ),
    h('button', { onClick: () => actions.navigate('/') }, t('common.back')),
  );
}

export function gateView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    clubHeader(),
    h('h1', {}, t('gate.heading')),
    h('p', { class: 'lede' }, t('gate.lede')),
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
        h('label', { for: 'password' }, t('gate.passwordLabel')),
        h('input', {
          id: 'password',
          name: 'password',
          type: 'password',
          required: true,
          autocomplete: 'off',
          spellcheck: 'false',
          'data-focus': 'password',
        }),
        h('span', { class: 'hint' }, t('gate.passwordHint')),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, t('gate.submit')),
    ),
    h(
      'details',
      { class: 'rules' },
      h('summary', {}, t('gate.lostSeatSummary')),
      h('p', {}, t('gate.lostSeatBody')),
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
          h('label', { for: 'code' }, t('gate.recoveryLabel')),
          h('input', { id: 'code', name: 'code', type: 'text', autocomplete: 'off', 'data-focus': 'code' }),
        ),
        h('button', { type: 'submit' }, t('gate.recoverButton')),
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
    clubHeader(),
    h('h1', {}, t('join.heading')),
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
        h('label', { for: 'name' }, t('common.screenName')),
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
        h('legend', {}, t('join.freeSeats')),
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
                seatWithTeam(seat.seat, seat.team),
              )
            : h(
                'p',
                { class: 'hint' },
                t('seat.takenBy', { seat: seatLabel(seat.seat), team: teamName(seat.team), name: seat.name }),
              ),
        ),
      ),
      free.length === 0
        ? h('p', { class: 'notice error' }, t('join.full'))
        : h('button', { class: 'primary', type: 'submit', disabled: state.busy }, t('join.submit')),
    ),
    rulesDrawer(),
  );
}

export function recoverView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    clubHeader(),
    h('h1', {}, t('recover.heading')),
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
        h('label', { for: 'code' }, t('recover.codeLabel')),
        h('input', { id: 'code', name: 'code', type: 'text', required: true, 'data-focus': 'code' }),
        h('span', { class: 'hint' }, t('recover.codeHint')),
      ),
      h('button', { class: 'primary', type: 'submit', disabled: state.busy }, t('recover.submit')),
    ),
  );
}

export function closedView(state: UiState, actions: Actions): HTMLElement {
  return h(
    'main',
    { id: 'main', class: 'screen' },
    clubHeader(),
    h('h1', {}, t('closed.heading')),
    h(
      'p',
      {},
      state.statusDetail === 'expired'
        ? t('closed.expired')
        : t('closed.closed'),
    ),
    h('button', { class: 'primary', 'data-focus': 'home', onClick: () => actions.navigate('/') }, t('closed.home')),
  );
}

function connectionBanner(state: UiState): HTMLElement | null {
  if (state.status === 'open') return null;
  const message =
    state.status === 'reconnecting'
      ? t('connection.reconnecting')
      : state.status === 'connecting'
        ? t('connection.connecting')
        : state.statusDetail === 'replaced'
          ? t('connection.replaced')
          : t('connection.disconnected');
  return h('div', { class: 'banner', role: 'status' }, message);
}

function lobbyPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const you = snapshot.you;
  const seats = snapshot.seats;
  return h(
    'div',
    {},
    h('h2', {}, t('lobby.heading')),
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
            h('strong', {}, seat.name ?? t('common.empty')),
            ' ',
            h('span', { class: 'tag' }, t('seat.short', { seat: seatLabel(seat.seat), team: teamName(seat.team) })),
          ),
          h(
            'span',
            {},
            seat.isHost ? h('span', { class: 'tag' }, t('lobby.host')) : null,
            ' ',
            seat.name ? h('span', { class: 'tag' }, seat.connected ? t('lobby.connected') : t('lobby.away')) : null,
            ' ',
            seat.name ? h('span', { class: 'tag' }, seat.ready ? t('lobby.ready') : t('lobby.notReady')) : null,
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'card-panel' },
      h('h3', {}, t('lobby.detailsHeading')),
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
          h('label', { for: 'newname' }, t('common.screenName')),
          h('input', {
            id: 'newname',
            name: 'newname',
            type: 'text',
            maxlength: '24',
            value: you.name,
            'data-focus': 'newname',
          }),
        ),
        h('button', { type: 'submit' }, t('lobby.changeName')),
      ),
      h('p', { class: 'hint' }, t('lobby.clearsReady')),
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
              t('lobby.moveTo', { seat: seatLabel(seat.seat), team: teamName(seat.team) }),
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
          you.ready ? t('lobby.unreadyButton') : t('lobby.readyButton'),
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
    h('h3', {}, t('host.heading')),
    h('p', {}, t('host.shareHint')),
    h('p', {}, h('code', { class: 'secret' }, link)),
    h(
      'div',
      { class: 'button-row' },
      h('button', { 'data-focus': 'copy-link', onClick: () => actions.copy(t('host.roomLinkLabel'), link) }, t('host.copyLink')),
      password
        ? h(
            'button',
            { 'data-focus': 'copy-pass', onClick: () => actions.copy(t('host.roomPasswordLabel'), password) },
            t('host.copyPassword'),
          )
        : null,
    ),
    password
      ? h(
          'details',
          { class: 'rules' },
          h('summary', {}, t('host.showPassword')),
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
        t('host.start'),
      ),
      h('button', { onClick: () => actions.send('rotatePassword') }, t('host.newPassword')),
      h('button', { class: 'danger', onClick: () => actions.send('closeRoom') }, t('host.closeRoom')),
    ),
    !snapshot.canStart
      ? h('p', { class: 'hint' }, t('host.startHint'))
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
            t('host.remove', { name: seat.name ?? '' }),
          ),
        ),
    ),
    state.recovery
      ? h(
          'div',
          { class: 'notice' },
          h('p', {}, t('host.recoveryFor', { seat: seatLabel(state.recovery.seat) })),
          h('p', {}, h('code', { class: 'secret' }, state.recovery.code)),
          h('p', { class: 'hint' }, t('host.recoveryGive')),
        )
      : null,
  );
}

function statusLine(snapshot: Snapshot): HTMLElement {
  const match = snapshot.match;
  const hand = match?.hand ?? null;
  const trumpText =
    hand === null
      ? t('status.trumpNone')
      : hand.trumpStatus === 'revealed'
        ? t('status.trumpRevealed', { suit: suitName(hand.trump as Suit), symbol: suitSymbol(hand.trump as Suit) })
        : hand.trumpStatus === 'hidden'
          ? hand.trump
            ? t('status.trumpHiddenYours', { suit: suitName(hand.trump) })
            : t('status.trumpHidden')
          : t('status.trumpNotChosen');
  return h(
    'ul',
    { class: 'status-line' },
    h('li', {}, `${t('status.hand')} `, h('strong', {}, String(match?.handNumber ?? 1))),
    h('li', {}, `${t('status.dealer')} `, h('strong', {}, seatLabel(match?.dealer ?? 0))),
    h(
      'li',
      {},
      `${t('status.contract')} `,
      h('strong', {}, hand?.bid ? t('status.contractValue', { bid: hand.bid, seat: seatLabel(hand.bidder as number) }) : t('status.contractAuction')),
    ),
    h('li', {}, `${t('status.stake')} `, h('strong', {}, t('status.stakeValue', { stake: hand?.stake ?? 1 }))),
    h('li', {}, `${t('status.trump')} `, h('strong', {}, trumpText)),
    h('li', {}, `${t('status.trick')} `, h('strong', {}, t('status.trickValue', { n: hand?.trickNumber ?? 1 }))),
    h('li', {}, `${teamName(0)} `, h('strong', {}, String(match?.scores[0] ?? 0))),
    h('li', {}, `${teamName(1)} `, h('strong', {}, String(match?.scores[1] ?? 0))),
  );
}

function seatBox(snapshot: Snapshot, seat: number, position: string): HTMLElement {
  const info = snapshot.seats[seat];
  const match = snapshot.match;
  const hand = match?.hand ?? null;
  const isTurn = hand?.turn === seat && match?.phase === 'PLAYING';
  const flags: string[] = [];
  if (match && match.dealer === seat) flags.push(t('table.dealer'));
  if (hand?.bidder === seat) flags.push(t('table.contract'));
  if (info && !info.connected) flags.push(t('table.away'));
  const acknowledged = hand?.ack?.acknowledged.includes(seat as 0 | 1 | 2 | 3);
  if (hand?.ack) flags.push(acknowledged ? t('table.readyNext') : t('table.confirming'));
  return h(
    'div',
    {
      class: `seat-box ${position}${isTurn ? ' turn' : ''}`,
      'aria-current': isTurn ? 'true' : null,
    },
    h('span', { class: 'seat-avatar', 'aria-hidden': 'true' }, info?.name?.trim().slice(0, 2).toUpperCase() || '·'),
    h('span', { class: 'seat-name' }, info?.name ?? t('common.empty')),
    h('span', { class: 'flags' }, t('seat.short', { seat: seatLabel(seat), team: teamName(seat % 2) })),
    hand ? h('span', { class: 'flags' }, cardsCount(hand.cardCounts[seat as 0 | 1 | 2 | 3] ?? 0)) : null,
    flags.length > 0 ? h('span', { class: 'flags' }, flags.join(' · ')) : null,
    isTurn ? h('span', { class: 'flags turn-label' }, t('table.toPlay')) : null,
  );
}

function trickArea(snapshot: Snapshot): HTMLElement {
  const hand = snapshot.match?.hand;
  const plays = hand?.currentTrick.plays ?? [];
  return h(
    'div',
    { class: 'trick', 'aria-label': t('table.trickLabel') },
    ...(plays.length === 0
      ? [h('span', { class: 'flags' }, t('table.noCards'))]
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
      h('h2', {}, t('actions.paused.heading')),
      h(
        'p',
        {},
        t('actions.paused.waiting', { names: (snapshot.paused?.seats ?? []).map((seat) => snapshot.seats[seat]?.name ?? seatLabel(seat)).join(', ') }),
      ),
      h(
        'p',
        { class: 'hint' },
        t('actions.paused.hint'),
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
                  t('actions.paused.recoveryFor', { seat: seatLabel(seat) }),
                ),
              ),
            )
          : null,
        h('button', { class: 'danger', onClick: () => actions.send('abandonMatch') }, t('actions.paused.endMatch')),
      ),
      state.recovery
        ? h(
            'div',
            { class: 'notice' },
            h('p', {}, t('actions.paused.recoveryShown', { seat: seatLabel(state.recovery.seat) })),
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
          h('h2', {}, t('actions.auction.heading')),
          h('p', {}, t('actions.auction.waiting', { name: snapshot.seats[hand?.auction.turn ?? 0]?.name ?? t('actions.auction.nextPlayer') })),
          auctionHistory(snapshot),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, t('actions.auction.yourBid')),
        h(
          'div',
          { class: 'bid-grid', role: 'group', 'aria-label': t('actions.auction.bidsLabel') },
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
            state.selectedBid === null ? t('actions.auction.bid') : t('actions.auction.bidValue', { value: state.selectedBid }),
          ),
          h('button', { 'data-focus': 'pass', onClick: () => actions.send('pass') }, t('common.pass')),
        ),
        auctionHistory(snapshot),
      );
    }
    case 'CHOOSE_TRUMP': {
      if (!available.canChooseTrump) {
        return h(
          'div',
          { class: 'card-panel', role: 'status' },
          h('h2', {}, t('actions.trump.heading')),
          h('p', {}, t('actions.trump.waiting', { name: snapshot.seats[hand?.bidder ?? 0]?.name ?? t('actions.trump.contractHolder') })),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, t('actions.trump.choose')),
        h('p', { class: 'hint' }, t('actions.trump.secretHint')),
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
              t('status.trumpRevealed', { suit: suitName(suit), symbol: suitSymbol(suit) }),
            ),
          ),
          h(
            'button',
            { class: 'primary', 'data-focus': 'trump-seventh', onClick: () => actions.send('chooseTrump', { mode: 'seventh' }) },
            t('actions.trump.seventhButton'),
          ),
        ),
        h(
          'p',
          { class: 'hint' },
          t('actions.trump.seventhHint'),
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
          h('h2', {}, isRedouble ? t('actions.redouble.headingWait') : t('actions.double.headingWait')),
          h('p', {}, t('actions.waitingDecision', { name: actor === null ? t('actions.aDecision') : (snapshot.seats[actor]?.name ?? seatLabel(actor)) })),
        );
      }
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, isRedouble ? t('actions.redouble.headingAsk') : t('actions.double.headingAsk')),
        h(
          'p',
          {},
          isRedouble
            ? t('actions.redouble.explain')
            : t('actions.double.explain'),
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
            isRedouble ? t('actions.redouble.button') : t('actions.double.button'),
          ),
          h(
            'button',
            {
              'data-focus': 'pass-double',
              onClick: () => actions.send(isRedouble ? 'passRedouble' : 'passDouble'),
            },
            t('common.pass'),
          ),
        ),
      );
    }
    case 'PLAYING': {
      if (hand?.ack) {
        return h(
          'div',
          { class: 'card-panel' },
          h('h2', {}, t('actions.between.heading')),
          h(
            'p',
            {},
            t('actions.between.won', { seat: seatLabel(hand.tricks[hand.ack.trickIndex]?.winner ?? 0), n: hand.ack.trickIndex + 1, points: hand.tricks[hand.ack.trickIndex]?.points ?? 0 }),
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
              available.canContinueTrick ? t('actions.between.continue') : t('actions.between.waitingOthers'),
            ),
            available.canDeclarePair
              ? h(
                  'button',
                  { 'data-focus': 'declare', onClick: () => actions.send('declarePair') },
                  t('actions.between.declare'),
                )
              : null,
          ),
          h(
            'p',
            { class: 'hint' },
            t('actions.between.confirmed', { count: hand.ack.acknowledged.length }),
          ),
        );
      }
      const yourTurn = available.legalCards.length > 0;
      return h(
        'div',
        { class: 'card-panel' },
        h('h2', {}, yourTurn ? t('actions.play.headingYourTurn') : t('actions.play.headingPlay')),
        h(
          'p',
          { role: 'status' },
          yourTurn
            ? state.selectedCard
              ? t('actions.play.selected', { card: cardAccessibleLabel(state.selectedCard) })
              : t('actions.play.chooseCard')
            : t('actions.play.waiting', { name: snapshot.seats[hand?.turn ?? 0]?.name ?? t('actions.auction.nextPlayer') }),
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
            t('actions.play.button'),
          ),
          available.canRevealTrump
            ? h(
                'button',
                { 'data-focus': 'reveal', onClick: () => actions.send('revealTrump') },
                t('actions.play.reveal'),
              )
            : null,
        ),
        available.canRevealTrump
          ? h(
              'p',
              { class: 'hint' },
              t('actions.play.revealHint'),
            )
          : null,
      );
    }
    case 'HAND_RESULT':
      return handResultPanel(state, actions);
    case 'MATCH_RESULT':
      return matchResultPanel(state, actions);
    default:
      return h('div', { class: 'card-panel', role: 'status' }, h('p', {}, t('actions.dealing')));
  }
}

function auctionHistory(snapshot: Snapshot): HTMLElement {
  const history = snapshot.match?.hand?.auction.history ?? [];
  if (history.length === 0) return h('p', { class: 'hint' }, t('actions.auction.noBids'));
  return h(
    'ol',
    { class: 'log' },
    ...history.map((entry) =>
      h(
        'li',
        {},
        entry.action === 'pass'
          ? t('actions.auction.entryPassed', { player: snapshot.seats[entry.seat]?.name ?? seatLabel(entry.seat) })
          : t(entry.forced ? 'actions.auction.entryBidForced' : 'actions.auction.entryBid', {
              player: snapshot.seats[entry.seat]?.name ?? seatLabel(entry.seat),
              value: entry.value as number,
            }),
      ),
    ),
  );
}

function handResultPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  const result = match?.hand?.result ?? match?.history.at(-1) ?? null;
  if (!result) return h('div', { class: 'card-panel' }, h('p', {}, t('result.scoring')));
  const rows: [string, string][] = result.annulled
    ? [
        [t('result.bid'), t('result.bidValue', { bid: result.bid, seat: seatLabel(result.bidder) })],
        [t('result.outcome'), t('result.annulledOutcome')],
        [t('result.matchPoints'), t('result.noChange')],
      ]
    : [
        [t('result.bid'), t('result.bidValueTeam', { bid: result.bid, seat: seatLabel(result.bidder), team: teamName(result.bidderTeam) })],
        [t('result.pairAdjustment'), result.pairAdjustment === 0 ? t('result.none') : `${result.pairAdjustment > 0 ? '+' : ''}${result.pairAdjustment}`],
        [t('result.target'), String(result.target)],
        [t('result.cardPoints', { team: teamName(0) }), String(result.capturedPoints[0])],
        [t('result.cardPoints', { team: teamName(1) }), String(result.capturedPoints[1])],
        [t('result.stake'), t('status.stakeValue', { stake: result.stake })],
        [t('result.contract'), result.contractMade ? t('result.made') : t('result.failed')],
        [
          t('result.matchPoints'),
          t('result.deltas', {
            team0: teamName(0),
            delta0: `${result.scoreDelta[0] >= 0 ? '+' : ''}${result.scoreDelta[0]}`,
            team1: teamName(1),
            delta1: `${result.scoreDelta[1] >= 0 ? '+' : ''}${result.scoreDelta[1]}`,
          }),
        ],
        [
          t('result.scoreNow'),
          t('result.scoreNowValue', { team0: teamName(0), score0: result.scoresAfter[0], team1: teamName(1), score1: result.scoresAfter[1] }),
        ],
      ];
  return h(
    'div',
    { class: 'card-panel' },
    h('h2', {}, t('result.heading', { n: result.handNumber })),
    h(
      'table',
      { class: 'scores' },
      h('tbody', {}, ...rows.map(([label, value]) => h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value)))),
    ),
    match?.matchResult
      ? h('p', {}, t('result.matchWon', { team: teamName(match.matchResult.winner) }))
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
        match?.actions.canNextHand ? t('result.nextHand') : t('result.waitingOthers'),
      ),
    ),
    h('p', { class: 'hint' }, t('result.readyCount', { count: match?.continues.length ?? 0 })),
  );
}

function matchResultPanel(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot as Snapshot;
  const match = snapshot.match;
  const winner = match?.matchResult?.winner ?? 0;
  return h(
    'div',
    { class: 'card-panel' },
    h('h2', {}, t('matchResult.heading', { team: teamName(winner) })),
    h('p', {}, t('matchResult.finalScore', { team0: teamName(0), score0: match?.scores[0] ?? 0, team1: teamName(1), score1: match?.scores[1] ?? 0 })),
    h(
      'table',
      { class: 'scores' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, t('matchResult.colHand')),
          h('th', { scope: 'col' }, t('matchResult.colContract')),
          h('th', { scope: 'col' }, t('matchResult.colResult')),
          h('th', { scope: 'col' }, t('matchResult.colScore')),
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
            h('td', {}, t('matchResult.contractValue', { bid: entry.bid, seat: seatLabel(entry.bidder), stake: entry.stake })),
            h('td', {}, entry.annulled ? t('matchResult.annulled') : entry.contractMade ? t('matchResult.made') : t('matchResult.failed')),
            h('td', {}, t('matchResult.scoreValue', { a: entry.scoresAfter[0], b: entry.scoresAfter[1] })),
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
        match?.actions.canRematch ? t('matchResult.rematch') : t('matchResult.waitingOthers'),
      ),
      h('button', { onClick: () => actions.navigate('/') }, t('matchResult.leave')),
    ),
    h('p', { class: 'hint' }, t('matchResult.rematchHint')),
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
    { class: 'hand-panel', 'aria-label': t('hand.heading') },
    h('h2', {}, t('hand.heading')),
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
          h('span', { class: 'hint' }, t('card.reservedLabel')),
          card(hand.reservedCard.card as CardId, { reserved: true }),
          h('span', { class: 'hint' }, t('card.reservedTrump', { suit: suitName(hand.reservedCard.suit) })),
        )
      : null,
  );
}

export function roomView(state: UiState, actions: Actions): HTMLElement {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return h('main', { id: 'main', class: 'screen' }, clubHeader(), h('h1', {}, t('app.brand')), h('p', {}, t('app.loadingTable')));
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
      ? h('div', { class: 'banner', role: 'status' }, t('connection.expiryWarning'))
      : null,
    h(
      'main',
      { id: 'main', class: 'screen' },
      clubHeader(),
      h('h1', {}, snapshot.room.status === 'lobby' ? t('room.headingLobby') : t('room.headingTable')),
      notice(state, actions),
      snapshot.room.status === 'lobby'
        ? lobbyPanel(state, actions)
        : fragment(
            statusLine(snapshot),
            h('div', { class: 'game-layout' },
              h('div', { class: 'game-table-column' },
                h('div', { class: 'table' },
                  seatBox(snapshot, partner, 'partner'),
                  seatBox(snapshot, left, 'left'),
                  trickArea(snapshot),
                  seatBox(snapshot, right, 'right'),
                  seatBox(snapshot, you.seat, 'you'),
                ),
                handPanel(state, actions),
              ),
              h('aside', { class: 'game-actions', 'aria-label': t('actions.regionLabel') }, actionPanel(state, actions)),
            ),
            state.log.length > 0
              ? h(
                  'details',
                  { class: 'rules' },
                  h('summary', {}, t('room.recentActions')),
                  h('ul', { class: 'log' }, ...state.log.slice(-20).reverse().map((line) => h('li', {}, line))),
                )
              : null,
          ),
      rulesDrawer(),
      h(
        'p',
        { class: 'hint' },
        t('room.youAre', { name: you.name, seat: seatLabel(you.seat), team: teamName(you.team), version: snapshot.room.rulesVersion }),
      ),
    ),
  );
}
