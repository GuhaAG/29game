# Browser-based 29

A private, account-free table of **29** for exactly four people, implemented against
[`SPEC.md`](SPEC.md) (rule profile `rulesVersion=1`). One host creates a room, shares a link and a
generated password, everybody picks their own screen name and seat, and the server enforces every
rule. Browsers are views and input devices only.

**Played and forgotten.** There is no database and nothing is written to disk. A room lives in the
server's memory, and when it ends, expires, or the process stops, it is gone. No accounts, no match
history, no analytics.

- TypeScript rules engine, pure and deterministic, with randomness injected.
- TypeScript server: HTTP + WebSocket on one origin, all state in process.
- Zero-dependency browser client (no framework), built with esbuild.
- One runtime dependency in total: `ws`.

## Quick start

```bash
npm install
npm run build
npm start          # http://localhost:3000
```

That is the whole setup — no database, no migrations, no configuration. Open
`http://localhost:3000`, choose **Create game**, enter your own name, pick a seat, then send the room
link and the password to three other people **separately**. Everyone marks **Ready**; the host
starts.

For development, `npm run watch:client` rebuilds the browser bundle on change; restart the server
with `npm run build:server && npm start`.

### What is kept, and for how long

| In memory while a room lives | Notes |
| --- | --- |
| Room id, status, password verifier, revision counters | The host's readable copy of the password is dropped the moment play starts |
| Seats, screen names, ready and connection flags | |
| Session verifiers, admission grants, recovery grants | Grants expire in five minutes |
| The live game: deck order, each hand, hidden trump, reserved seventh card, tricks, scores | Never sent to a player who is not entitled to it |
| Command receipts (so a retried click cannot play a card twice) | |

A lobby is forgotten after 30 minutes without an action, an active room after 2 hours, and every room
after 24 hours at the latest. Players are warned five minutes before that, and the room is erased a
few minutes after it closes. A restart or crash ends any game in progress: players see "this room no
longer exists" rather than a half-restored table.

### Configuration

Optional; see [`.env.example`](.env.example). Behind TLS set `REQUIRE_HTTPS=1`, `SECURE_COOKIES=1`,
`TRUST_PROXY=1` and `ALLOWED_ORIGINS=https://your.host`. Abuse limits and every timing above are
environment-tunable (`LIMIT_*`, `LOBBY_IDLE_MS`, `ACTIVE_IDLE_MS`, …).

Session cookies are `HttpOnly`, `SameSite=Strict` and scoped to `/api/rooms/{id}`; the socket
authenticates from the same cookie, never from the URL. Credential verifiers are keyed with a random
key generated at boot — since no room outlives the process, there is no key to manage.

### Deployment

**Live instance:** https://134-209-100-100.sslip.io — a $4/month DigitalOcean droplet
(`twentynine`, 512 MB, Singapore). Deploy a change with:

```bash
./scripts/deploy.sh          # build, ship, restart, verify health
```

How that box is put together, should it ever need rebuilding:

- **Caddy** terminates TLS on ports 80/443 and reverse-proxies to the app. It obtains and renews a
  real Let's Encrypt certificate automatically. The hostname is an `sslip.io` name that resolves to
  the droplet's own IP, so no domain purchase is needed; point a real domain at the IP and change the
  first line of `/etc/caddy/Caddyfile` to use it instead.
- **The app** runs under systemd as the unprivileged `twentynine` user, bound to `127.0.0.1:3000`
  only, with `NODE_ENV=production` (so HTTPS is required and cookies are Secure) and `TRUST_PROXY=1`
  so Caddy's `X-Forwarded-Proto` is honoured. `ufw` allows only SSH, 80 and 443.
- **Deploys** go over SSH as a separate `deploy` account whose sudo rights are exactly
  `systemctl restart twentynine` — it cannot touch anything else on the machine. Its key is its own,
  so it can be revoked without affecting your personal access.
- Only the built artefacts ship (`dist`, `public`, the two manifests); `npm ci --omit=dev` on the
  droplet installs the single runtime dependency. The whole install is under 1.3 MB and the running
  process uses ~17 MB, which is why the smallest droplet is enough.

**Deploying on push** is wired up in `.github/workflows/deploy.yml`: it runs the full test suite,
then ships and restarts exactly as the script does, then checks `/healthz` came back. It skips
cleanly until two repository secrets exist, so CI stays green in the meantime:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `134.209.100.100` |
| `DEPLOY_SSH_KEY` | contents of `~/.ssh/twentynine_deploy` (the CI-only private key) |

Set them without the key ever passing through a terminal:
`gh secret set DEPLOY_SSH_KEY < ~/.ssh/twentynine_deploy`

A `Dockerfile` is also included if you would rather run it as a container anywhere else. It sets
`NODE_ENV=production` and `TRUST_PROXY=1`, so it expects to sit behind a TLS-terminating proxy; a
request arriving over plain HTTP is refused with *"A secure connection is required."*

Also worth knowing:

- Run **one** instance. Rooms are held in that process, so a second instance would not see them.
- Restarting ends games in progress — deploy between games.
- Health: `GET /healthz`, `GET /readyz`, `GET /metrics` (counters only, no room data).

## What is implemented

| Area | Where |
| --- | --- |
| Cards, ranking, points | `src/engine/cards.ts` |
| Frozen rule profile and the rules text the UI shows | `src/engine/profile.ts` |
| State machine, auction, trump, doubling, play, marriage, scoring | `src/engine/engine.ts` |
| Legal-move computation | `src/engine/legal.ts` |
| Per-seat projections (private information is dropped here) | `src/engine/projection.ts` |
| The store: rooms, seats, sessions, grants, per-room lock | `src/server/state.ts` |
| Room creation, admission, seat claims, recovery | `src/server/rooms.ts` |
| Command pipeline: receipts, revisions, events | `src/server/commands.ts` |
| Sockets, presence, fan-out | `src/server/hub.ts`, `src/server/index.ts` |
| Host transfer, expiry warnings, expiry, forgetting | `src/server/lifecycle.ts` |
| Wire types shared by both sides | `src/shared/wire.ts` |
| Browser client | `src/client/`, `public/` |

Concurrency without a database: every mutation runs inside `withRoom`, a per-room async mutex, and the
store is synchronous, so a handler validates and then mutates with no possible interleaving. Two
browsers racing for the same seat cannot both win.

### Rule profile (rulesVersion 1)

32 cards (J 9 A 10 K Q 8 7), 28 card points, clockwise, bids 16–28, three opening passes force the
dealer to 16, no last-trick point. Secret trump or **seventh card**; optional reveal only when unable
to follow, and the revealer must then trump if able; trump applies to the whole current trick and
never to completed ones; a hand where trump is never revealed is annulled. Marriage (trump K+Q)
adjusts the target by ∓4 within 16–28. Double and redouble set the stake to 2 or 4 and affect match
points only. A team reaching +6 wins; a team reaching −6 loses.

The rules drawer in the UI renders `RULES_TEXT` from the same module the engine uses, so displayed
rules and enforced rules cannot drift.

## Tests

```bash
npm test              # 95 tests: engine, client screens, integration
npm run test:engine   # deterministic rules fixtures and invariants
npm run test:client   # screen rendering and accessibility affordances, via jsdom
npm run test:integration
npm run typecheck     # server/engine and browser bundle
```

Nothing external is required — the integration suite starts the real server on a free port inside the
test process and drives four independent clients over HTTP and WebSocket.

Coverage highlights, mapped to `SPEC.md` §11:

- **Engine** — deck uniqueness and 28 points; auction termination including three opening passes,
  raises after passing, and the maximum bid; follow-suit enforcement; reveal only when void and never
  while leading; forced trump after a reveal; trump applying to already-played cards of the reveal
  trick; completed tricks unchanged; annulment; marriage in all its edge cases (split honours, honour
  already played, wrong-team trick, skipped then later declared, duplicates, clamped targets);
  seventh-card indexing, withheld preview, follow-suit before and after release, reveal by another
  player, automatic final-card release, marriage using the released card; the full double/redouble
  matrix with ±1/±2/±4 outcomes, annulled-and-doubled scoring zero, and overshooting both boundaries.
- **Integration** — a complete hand, and a complete match to a boundary followed by a rematch;
  payload inspection from all four seats proving no other hand, deck or hidden trump is ever sent;
  duplicate command ids returning the original result; `STALE_STATE`; pause on disconnect and resume;
  a restart ending games cleanly; simultaneous seat claims; duplicate names; a fifth browser;
  unauthorised host actions; seat moves; readiness cleared by an edit and Start blocked; connection
  replacement; cross-origin sockets and cross-room sessions; forged actor ids; password rotation
  invalidating admission grants; join throttling; one-use recovery codes revoking the old session;
  host transfer; room closure; static assets and their headers; expiry warning, expiry and erasure.

### Still to do by hand

Four real browsers, a touch device and a screen reader are not simulated here. Before you rely on it,
run the manual passes in `SPEC.md` §11: a four-browser match, the same flows on a 360 px viewport and
with keyboard and screen reader only, and a load test if you expect many concurrent rooms.

Two spec items are deliberately not met by this build, because they only exist to survive a restart:
durable state across a process restart (§6, §8) and running more than one instance (§8). Everything
else in the specification is implemented.

## Privacy and trust model

The room password authorises its holder to take a free seat. It proves nothing about identity, and
anyone who is given or forwarded it can try to enter — the host verifies the four names before
starting. Players can still show each other their cards or collude outside the app. What the server
does guarantee: no roster or game state without a valid credential, no seat takeover, no cross-room
disclosure, and no private card knowledge in any payload a player is not entitled to.

Logs carry room pseudonyms, action types, revisions and timings only. Hands, unrevealed trump,
passwords, cookies, recovery codes and raw command bodies are redacted at the logger. When the
process exits, there is nothing left to leak.
