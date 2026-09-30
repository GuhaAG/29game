# Browser-based 29 — product and engineering specification

Version: 1.1 · Date: 2026-09-29 · Status: specification complete; base rules, optional reveal, marriage, seventh-card trump, and double/redouble confirmed by the user.

## 1. Purpose and scope

Build a private browser game for exactly four human players. A host creates a game instance and shares a generated access password. Each player, including the host, enters their own screen name and chooses an available seat. The host starts when all four players join and mark themselves ready. No accounts, email addresses, installation, public matchmaking, or login screen are required. Each person plays on their own browser/device.

An “instance” means an isolated room with its own roster, secrets, state, and match history, not a separate deployment. One service can run many rooms. The host is one of the four players. Two teams consist of opposite seats. The browser is a view and input device; the server enforces every rule.

V1 includes room creation, protected joining, player-selected seats locked during play, bidding, hidden/seventh-card trump, marriage, double/redouble, eight-trick hands, scoring, rematches, reconnection, and an in-game rules reference. Excluded: bots, spectators, accounts, rankings, payments, chat/voice, tournaments, public room listings, and play with fewer than four people.

## 2. Rule research and confirmed profile

Sources accessed September 29, 2026:

- [Pagat: Twenty-Nine](https://www.pagat.com/jass/29.html): documents regional differences, optional last-trick scoring, marriage, and alternative trump-reveal rules.
- [Arkadium: Twenty Nine rules](https://support.arkadium.com/en/support/solutions/articles/44002652194--twenty-nine-how-to-play-tips-scoring): describes its own implementation, including card order, dealing, bidding, and hidden trump. It is corroborating evidence, not an authoritative universal ruleset.

There is no single uniform rule set across these sources. The profile below records the user’s choices and specifies remaining implementation details. It does not claim that every group plays this way.

### Confirmed rules

Four players form opposite-seat teams. Use 32 cards, ranks J, 9, A, 10, K, Q, 8, 7 in descending strength. Jacks score 3, nines 2, aces and tens 1, others zero. Deal four cards each, bid, select secret trump, then deal four more. Follow suit when possible; trick winners lead next. These fundamentals are described by [Arkadium](https://support.arkadium.com/en/support/solutions/articles/44002652194--twenty-nine-how-to-play-tips-scoring).

Confirmed house choices: clockwise; bids 16–28; no last-trick point; three opening passes force dealer to 16. Subsequent three consecutive passes end bidding; passing does not permanently withdraw a player. A bid of 28 ends immediately. Dealer rotates each hand; the player to dealer’s left opens bidding and play.

Trump reveal is optional only when unable to follow suit. The revealer must trump if able. Trump applies to the entire current trick, including already-played cards, but never changes completed tricks. Unrevealed trump has no special power. If never revealed, annul the hand. Pair means one player still holds trump K and Q; declare after their team wins a trick on/after reveal. Adjust contract −4 for bidders, +4 for defenders, bounded to 16–28. Bidder team gains/loses the stake (1 normally, 2 doubled, 4 redoubled); other score stays unchanged. Reaching or exceeding +6 wins; reaching or falling below −6 loses. These choices adapt variants documented by [Pagat](https://www.pagat.com/jass/29.html).

### Decision register

| ID | Confirmed choice |
| --- | --- |
| R1 | 28 card points, clockwise, bids 16–28, forced dealer bid after three opening passes, base stake 1, match boundaries ±6 |
| R2 | Optional reveal when unable to follow suit; revealer must trump if able, subject to following suit after seventh-card release |
| R3 | Include marriage/pair, seventh-card trump, and double/redouble |

The user confirmed these choices in chat. The timing and edge cases in section 5 are the specified implementation of those choices. No-trump, reverse, single-hand, special redeals, automatic doubling, “set,” and extra loss penalties remain excluded. Freeze this profile as `rulesVersion=1`; record it on every match. V1 implements this profile, not a runtime rule-customization system.

## 3. Room creation and joining

### Host flow

1. Open the site and choose **Create game**.
2. Enter your own screen name. Names are 1–24 visible Unicode characters after trimming/normalization, unique within the room under case-insensitive comparison. Reject control and bidirectional override characters; render as text.
3. Choose your own seat from a table preview: seats 0 and 2 are Team A; seats 1 and 3 are Team B. The other three seats remain empty for guests to choose.
4. Create the room atomically. Claim the host seat and issue its session. Generate an opaque room ID and password server-side.
5. Display **Copy room link** and **Copy password** separately, with instructions to share privately. Password can be revealed by the host in the lobby; it is never embedded in the URL.
6. Show joins live. Each participant marks **Ready** after reviewing teams and rules. Host chooses **Start** only when four distinct seats are occupied, connected, and ready.

### Guest flow

1. Open `/room/{roomId}` and enter the generated password. No account creation.
2. After successful authorization, enter your own screen name and choose an empty seat from the live table preview. Show occupied seats with their players’ chosen names and label each seat’s team. Confirm “Join as {name} in seat {seat}.”
3. Validate name uniqueness and claim the seat in one transaction: if two browsers choose the same seat or name, exactly one succeeds. The other sees refreshed availability and an actionable error; no partial claim is created.
4. Issue a private seat session. Show the lobby, team, and rules. The display name is never an authentication credential.

The room password authorizes its holder to choose a screen name and claim any vacant seat; it does not prove real-world identity. The host verifies the four names before starting. Anyone given or forwarded the password can attempt entry. Preventing password sharing is outside the account-free trust model.

### Lobby controls

- Every participant can edit only their own screen name and move only themselves to an empty seat before the match starts. A seat move atomically claims the new seat and releases the old one; the membership and session remain attached to the same person. Occupied seats cannot be taken or swapped unilaterally.
- Any name or seat change clears all Ready flags so everyone reviews the updated roster and teams. Seat changes update team membership according to opposite-seat partnerships.
- The host has the same name/seat controls for themselves and cannot name, rename, assign, or move other players. Host administration allows removing an incorrect participant, rotating the password, or closing the room before starting.
- Removing a participant revokes their session immediately. The UI offers password rotation because removal alone cannot invalidate a known shared password.
- Start locks screen names, seats, teams, and admission. Name edits and seat moves race safely with Start under the room transaction lock: a change committed first clears readiness and blocks Start; Start committed first rejects the change. The room password cannot reclaim a seat or join a running match.
- No player can see another hand or hidden trump through host controls.

## 4. Access protection and session lifecycle

Use a cryptographically secure random 128-bit opaque room identifier and an independently generated 20-character Base32 room password (100 bits of entropy). Accept case-insensitive passwords with optional grouping hyphens; generate no user-chosen weak passwords.

Store only a keyed verifier for password checks; keep any host-display copy encrypted with a separate application key, and erase that copy when play starts. Never log credentials. Issue random 256-bit seat-session credentials in Secure, HttpOnly, SameSite cookies scoped to `/api/rooms/{id}` (covering the room HTTP endpoints and socket handshake). Store session verifiers server-side. Sessions expire with the room and are rotated on recovery. Do not put credentials in localStorage, query strings, analytics, or WebSocket URLs.

Require HTTPS/WSS, same-origin mutation requests, CSRF defenses, and validated WebSocket Origin. Authorize every HTTP operation and every socket command against room membership, seat, role, phase, and session status. A room ID alone grants no roster, game state, socket subscription, or admission.

Initial abuse limits: 5 room creations per IP per 10 minutes; 10 failed joins per room/IP pair per 10 minutes plus 50 per IP per 10 minutes across rooms; 20 gameplay commands per session per second with a burst of 40. Return generic invalid/expired-access errors and bounded cooldowns. Use additional edge throttling for distributed abuse; avoid a global room lockout that lets strangers deny access to everyone. Configure limits without code changes.

One active controlling connection per seat. Opening a second tab with the same session replaces the first connection; the old tab becomes inert with an explanation. A different browser cannot take a seat using its name and the room password.

On normal refresh or temporary disconnection, the cookie restores the same seat and private hand. For a lost browser session, the connected host may issue a one-use, 128-bit recovery code for that occupied seat after verifying the person out of band. Code expires in five minutes, is submitted in a POST body, and atomically revokes all prior seat credentials on redemption. The match stays paused during recovery. A host whose credentials are lost cannot self-recover by name or room password; a transferred host can recover them, otherwise create a new room.

Security promise: resist unauthorized guessing, seat takeover, and cross-room disclosure. This does not prevent participants from sharing credentials, showing cards to one another, or colluding outside the app.

## 5. Game engine behavior

### State machine

`LOBBY → DEAL_FIRST → BIDDING → CHOOSE_TRUMP → DOUBLE_WINDOW → [REDOUBLE_WINDOW] → DEAL_SECOND → PLAYING → HAND_RESULT → DEAL_FIRST … → MATCH_RESULT`

`PAUSED` is an overlay preserving the exact previous phase. `CLOSED` and `EXPIRED` are terminal. Automatic transitions run only on the server. No client command may skip a phase.

### Deal and auction

- Choose the first dealer securely at random; rotate by one seat after every completed or annulled hand.
- Shuffle all 32 unique card IDs using unbiased Fisher–Yates with cryptographically secure random indices. Persist the resulting hidden deck before dealing; never reshuffle on reconnect.
- Deal one card at a time in clockwise seat order, starting left of dealer, until each player has four. The remaining cards stay exclusively server-side until the second deal.
- Bid commands contain an integer target or pass. Server supplies legal choices from the confirmed profile. A raise resets consecutive passes. Auction winner and target are public.
- The winning bidder chooses a suit privately or selects **Seventh card**, exactly once. The selection mode is public; the chosen suit remains private. Doubling decisions finish before the second deal or any seventh-card preview.

### Double and redouble

After trump selection, ask the two defenders in clockwise order starting after the bidder to **Double** or **Pass**. Each gets one decision; the first double closes this window. If both pass, set stake to 1 and proceed to the second deal. After a double, ask the bidder and then their partner to **Redouble** or **Pass**. The first redouble sets stake to 4 and closes the window; two passes leave stake at 2. Choices are public and have no automatic timeout. Disconnects pause the current decision.

The stake affects match points only, never the bid, captured card points, or marriage adjustment. No further raises are possible. Evaluate success as `capturedPoints >= clamp(bid + pairAdjustment, 16, 28)`; apply `+stake` on success or `−stake` on failure to the bidding team only. An annulled hand scores zero regardless of stake. Check match boundaries with inequalities so overshooting ±6 ends the match. Example: a team on +4 making a doubled contract reaches +6 and wins; a team on −4 failing a redoubled contract reaches −8 and loses.

### Seventh-card trump

This optional choice uses the suit of the bidder’s seventh card in personal deal order (third card in their second batch), not the seventh card dealt across the whole table. Keep that card reserved outside their playable hand until reveal. After the second deal the bidder privately sees seven playable cards plus a distinct reserved-card preview and its suit; opponents see eight cards remaining in total. The preview is unavailable before doubling finishes.

While reserved, the card cannot be discarded or used to follow suit and does not count when checking whether the bidder can follow. On any legal reveal, atomically publish trump and move the reserved card into the bidder’s playable hand. Recompute legal cards after release: following the led suit takes priority; otherwise the requesting player must play trump if able. Example: if the reserved card is the bidder’s only heart and hearts are led, the bidder may discard without revealing, or reveal and then must follow with that heart.

If the bidder has only the reserved card left on their final turn, reveal and release it automatically before their required play, including when they lead. This is the sole exception to the prohibition on revealing while leading. It prevents a stuck final trick and makes trump active for that entire trick. Reserved cards count toward card-conservation checks, remaining-card displays, and pair eligibility after release, but not playable-hand eligibility before release.

No additional cancellation occurs for weak trump holdings, no scoring trumps, or opponents having few/no trumps. This intentionally retains the confirmed base profile rather than adding regional redeal rules. The seventh-card reservation and doubling sequence follow the variants described by [Pagat](https://www.pagat.com/jass/29.html), with explicit application timing defined here.

### Play and reveal

- Server computes each seat’s legal cards from its hand, lead suit, turn, and any reveal obligation. Reject illegal plays without changing state.
- Before reveal, the bidder alone receives the trump suit. Other players receive only `trumpStatus=hidden`.
- **Reveal trump** is enabled only on the acting player’s turn when that player cannot follow the lead. It is unavailable while leading except for automatic final-card release in seventh-card mode. Revealing commits public trump and the pending forced-trump obligation atomically; playing follows as a separate command.
- A player unable to follow suit may discard without revealing under this profile. After reveal, ordinary void players may discard or trump; only the player requesting reveal has the immediate forced-trump obligation.
- Resolve a four-card trick by the strongest trump if revealed for that trick, otherwise strongest lead-suit card. Record winner, four cards, and card points exactly once.
- Play all eight tricks even when a contract is already certain. No undo after a committed action, manual score edits, concessions, or automatic play in V1.

### Pair declaration window

After every non-final trick, open the same between-trick acknowledgment phase for all four players. Everyone receives **Continue**; an eligible holder additionally receives **Declare pair**. Eligibility requires revealed trump, that holder’s team winning this trick, and both trump K and Q in the holder’s playable hand. A reserved seventh card becomes eligible only after release. A declaration also acknowledges that player’s continuation; begin the next trick only when all four have acknowledged. This uniform window avoids revealing pair eligibility just by whether the game pauses.

Skipping a declaration does not prevent a later declaration after another qualifying win while both cards remain held. Record the pair at most once per hand, show the two cards and adjusted target publicly, and retain the cards in the holder’s hand. No declaration is possible after a required card has been played. Marriage adjusts the target only; doubling multiplies only the match-point outcome. Example: bid 20 with bidder-side marriage requires 16 captured points; if redoubled, success earns 4 match points and failure loses 4.

### Results

Hand result shows the bid, adjustment, final target, each team’s captured points, stake multiplier, contract outcome, and match-score change. If trump was never revealed, display “Hand annulled: trump was not revealed,” award no match points, and rotate dealer. No other redeal conditions apply to this profile.

All four players select **Next hand** before continuing. On match end, show winning team and hand summaries. All four may select **Rematch** to reset scores and randomly select a new first dealer while retaining seats. Otherwise they can leave or close the room. Secrets and hands are never exposed in a public replay; V1 history contains only public actions and completed trick records.

## 6. Disconnects, host changes, and expiry

- Heartbeat every 10 seconds; consider a connection lost after 30 seconds without response. Show reconnecting immediately on a detected transport failure. Pause game commands when a player is marked disconnected.
- Preserve turn, auction, doubling decision, reserved seventh card, cards, between-trick acknowledgments, and scores. No bot, forced pass, or timer-based card choice. Reconnect with exponential backoff and jitter, capped at 10 seconds.
- On reconnection, fetch a fresh authorized snapshot before enabling input. Resume when all four are connected. Do not require another Ready cycle for a routine reconnect.
- After a host has been absent for 60 seconds, transfer host controls to the longest-connected remaining participant, breaking ties by seat index. Host is an administrative role, never engine authority. Returning former host remains a player.
- A missing player’s seat is reserved. Mid-match replacements are excluded. Remaining players can wait, recover that same person, or unanimously end the match with no winner. A lone remaining player cannot alter the other players’ scores.
- Lobby expires after 30 minutes without a successful user action; active room after two hours without one; all rooms have a 24-hour absolute lifetime. Heartbeats and rejected requests do not extend lifetime. Warn connected players 5 minutes before scheduled expiry.
- Closing/expiry revokes sessions and recovery codes, stops sockets, and removes game secrets. Explain expiry rather than attempting an unsafe partial restore.
- Persist state so a process restart restores an unexpired room at its last committed revision. If durable state is unavailable or corrupted, stop play and show an error; never fabricate cards or advance scores.

## 7. Browser interface and accessibility

Required screens: home/create, password gate, screen-name entry and seat selector, lobby, game table, hand result, match result, reconnect/pause, and expired/closed room.

The table displays the local player at bottom, partner opposite, opponents left/right, team scores, dealer, current bidder/contract, stake (×1/×2/×4), turn indicator, trump status, trick number, current trick, and personal hand. Rotate presentation per viewer without changing canonical seat order. Show opponents’ card counts only. Use clear card ranks and suit symbols; do not rely on red/black color alone.

Only legal actions are enabled. On touch, tap a card to select, then **Play card** to commit; desktop uses the same explicit confirmation. Bidding uses discrete legal values with **Bid** and **Pass**. Trump selection offers four suits and **Seventh card**. Doubling windows show the acting player and permitted choices. The bidder’s reserved seventh card is visibly separated and cannot be selected for ordinary play. Hidden trump has no suit hint for other players. A rules drawer shows the exact confirmed profile and ranking/point reference.

Support portrait phones at 360 CSS pixels and desktop layouts, keyboard navigation, visible focus, screen-reader card/action labels, reduced motion, and 44-pixel touch targets. Announce public turn/trick changes without leaking private data into shared notifications. Sound is optional and off by default. Preserve selected input on harmless updates; clear it on turn changes or stale-state rejection.

Display “Reconnecting—actions paused,” “That seat was just taken,” and other actionable errors. Avoid showing raw server errors, credentials, stack traces, or implementation terminology to players.

## 8. Architecture and persistence

Recommended implementation shape: TypeScript browser client, TypeScript authoritative backend, same-origin HTTP plus WebSocket transport, and transactional SQL persistence. Framework and hosting provider selection remain implementation choices; behavior here is the contract. One application container plus PostgreSQL is sufficient for an initial deployment; no container is spawned per room.

Separate the pure deterministic rules engine from transport, storage, and UI. Engine input is validated state plus a command; output is new state and domain events. Inject shuffle results rather than generating randomness inside rule transitions. Pin a rules version for running rooms across deployments.

Core entities:

| Entity | Required information |
| --- | --- |
| Room | ID, status, creation/expiry timestamps, host membership, password verifier/version, rules version |
| Membership | ID, room, canonical seat, display name, team, readiness, connection timestamps |
| Session | verifier, membership, issue/expiry/revocation timestamps |
| Match | ID, room, rules snapshot, scores, dealer, hand number, result |
| Hand | deck order, dealt hands, bidder/target, trump mode, private trump, reserved seventh card, reveal state/obligation, doubling actor/decisions, stake, tricks, captured points, pair state, between-trick acknowledgments |
| Command receipt | membership, command ID, result, committed revision |
| Event | room/match, sequence, action, actor, public payload or classified private payload |
| Recovery grant | verifier, seat, expiry, consumed/revoked status |

Persist command receipt, state mutation, event, and score effects in one transaction. Serialize commands per room using a transaction lock or equivalent; a process-local queue alone is insufficient if multiple servers are deployed. Commit before acknowledgment and broadcast. Reconnect snapshots repair missed broadcasts. Encrypt storage/backups, restrict operator access, and keep encryption keys outside the database.

If horizontally scaled, add shared socket fan-out and database-enforced single-writer semantics per room. Sticky sessions alone do not prevent conflicting writes. During database failure reject mutations with a retryable error and keep the last confirmed client state visible.

## 9. API and synchronization contract

Illustrative endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/rooms` | Create four-seat room using only the host’s own screen name and chosen seat |
| `POST /api/rooms/{id}/admission` | Validate password; issue a five-minute admission grant |
| `GET /api/rooms/{id}/seats` | List names/availability for a valid admission grant |
| `POST /api/rooms/{id}/claim` | Consume admission grant, validate chosen screen name, and atomically claim the chosen seat |
| `GET /api/rooms/{id}/state` | Return member-specific current snapshot |
| `POST /api/rooms/{id}/recover` | Redeem one-use recovery code |
| `GET /api/rooms/{id}/socket` | Upgrade authenticated member connection |

Admission grants are room/password-version bound and expire on rotation, start, or use. Claim rechecks admission, screen-name validity/uniqueness, seat availability, and lobby state in the transaction. Never let a cached roster authorize admission.

Socket command envelope: `{commandId, expectedRevision, type, payload}`. Derive actor and room from the authenticated connection, never from a trusted client-supplied seat. Commands include updateOwnName, moveOwnSeat, ready, start, bid, pass, chooseTrump, double, passDouble, redouble, passRedouble, revealTrump, playCard, declarePair, continueTrick, nextHand, rematch, and authorized lobby/recovery controls.

Every accepted mutation increments a monotonic room revision. Duplicate command IDs return the original result without replaying effects, even if the revision has since changed; reject reuse of an ID with different payload. Stale revisions return `STALE_STATE` and a fresh permitted snapshot. Connection presence updates use a separate presence version so heartbeats do not invalidate gameplay commands.

Events include revision, type, and recipient-filtered payload. If a client detects a sequence gap, it requests a snapshot. Prefer snapshots over replaying private history on reconnect. Error codes include `UNAUTHORIZED`, `ROOM_UNAVAILABLE`, `SEAT_TAKEN`, `WRONG_PHASE`, `NOT_YOUR_TURN`, `ILLEGAL_MOVE`, `STALE_STATE`, and `RATE_LIMITED`.

Projection rules apply before serialization: each player receives only their own cards, publicly played cards, and permitted trump knowledge. Never send the full deck, other hands, hidden trump, password verifiers, or other sessions and rely on UI hiding. Do not expose legal actions computed for other players.

## 10. Quality targets and operations

- Target 100 concurrent rooms / 400 connected players for initial capacity validation.
- At that load, backend command handling p95 below 100 ms; action-to-other-player display p95 below 500 ms when client/server round-trip latency is at most 150 ms.
- Initial usable page under 3 seconds on a representative midrange phone and 4G connection; reconnect state recovery under 5 seconds after transport reconnect under normal service conditions.
- Test current stable Chrome, Firefox, Safari, Edge, iOS Safari, and Android Chrome at release time.
- Log room pseudonyms, action types, revisions, timing, and sanitized failures; never hands, unrevealed trump, passwords, cookies, recovery codes, or unfiltered command bodies.
- Monitor active rooms, join failures, rejected actions, reconnect frequency, command latency, database failures, and expiry cleanup. Provide health/readiness endpoints without room data.
- Expired room data is deleted from live storage within one hour. Operational logs retain 7 days; encrypted rolling backups retain at most 7 days. Restores must reapply expiry/revocation and never revive expired credentials.
- Deploy with environment-managed database and cryptographic keys, automatic TLS, database migrations, and graceful socket draining. Planned restarts preserve durable games; incompatible rules changes apply only to newly created matches.

## 11. Acceptance criteria and verification

### Product acceptance

1. Four people on four devices create and complete a match without accounts; each person enters their own screen name and chooses their own seat, including the host. The host cannot rename or move another player.
2. Wrong password and room ID alone reveal no roster or game state. A fifth browser cannot enter a full/running game. A name and password cannot steal an occupied seat.
3. Host cannot start with fewer than four connected, ready players. Teams remain fixed during a match.
4. Every game phase, legal action, score, and end condition follows the user-confirmed profile. The interface’s rules text matches the engine version.
5. Refresh, duplicate clicks, delayed packets, and reconnects never duplicate cards, plays, or scoring. Server restart preserves the committed game.
6. A complete game can be played on a phone and by keyboard without requiring hover or drag gestures.

### Engine verification

Use deterministic fixtures and invariant/property tests for deck uniqueness, card conservation, legal turn order, following suit, auction termination, trump visibility, winner ranking, score totals, annulment, and match boundaries. Cover three opening passes, raises after earlier passes, maximum bid, bidder revealing, revealing with/without trump available, earlier trump cards within the reveal trick, and completed tricks remaining unchanged.

Pair tests cover split K/Q across partners, one card already played, wrong-team trick win, reveal timing, skipped declarations, duplicate attempts, and target bounds. In a normal completed hand all 32 cards appear exactly once and total captured card points equal 28 under this profile.

Seventh-card tests cover personal deal indexing, withheld preview during doubling, seven playable plus one reserved card, following suit before/after release, reveal by another player, marriage using the released card, final-card forced release when leading or following, and reconnect without losing/duplicating the reserved card. Verify no extra regional cancellation conditions are applied.

Double/redouble tests cover both defenders passing, either defender doubling, either bidder-side player redoubling, illegal actors, repeated raises, second deal blocked until decisions finish, ±1/±2/±4 outcomes, marriage interaction, annulment scoring zero, and overshooting positive/negative match boundaries. Between-trick tests verify identical public acknowledgment windows regardless of pair eligibility.

### Integration and adversarial verification

Exercise simultaneous seat/name claims, duplicate-name edits, unauthorized edits to other players, atomic moves to empty seats, rejected moves to occupied seats, readiness resets, Start racing with name/seat changes, concurrent commands, reconnect while committing a play, session replacement, admission grants after password rotation, expired/reused recovery codes, host transfer, room closure, cross-room commands, forged actor IDs, cross-origin sockets, stale revisions, and mutation retries after lost acknowledgments. Inspect actual network payloads from all four seats to verify private-information isolation.

### End-to-end and operational verification

Run a four-browser deterministic match covering bidding through rematch, then a real shuffled match. Repeat key flows on a touch viewport and with keyboard/screen reader. Restart the backend mid-hand, simulate network loss, and interrupt the database during a command. Load-test the stated capacity and latency targets. Verify expiry removes sessions and secrets and that log collection redacts credentials.

## 12. Implementation sequence and completion gate

1. Completed: record the user’s R1–R3 choices and freeze the playable profile in this specification.
2. Implement/test the deterministic engine and private state projections.
3. Build room creation, access protection, atomic seat claims, lobby, and persistence.
4. Add realtime transport, complete table UI, all gameplay phases, and scoring.
5. Add reconnect/recovery, expiry, responsive/accessibility behavior, and operations.
6. Complete acceptance, security, failure-recovery, and load checks; deliver deployment and local-run instructions.

This request produces the specification only. No game implementation or deployment is implied. The requested rule review is complete and the specification includes the confirmed choices. Implementation can proceed from this document when requested.
