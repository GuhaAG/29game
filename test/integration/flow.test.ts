import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FULL_DECK, RANKS } from '../../src/engine';
import { type ServerHandle, TestClient, restartServer, startServer, startedMatch } from './harness';

let server: ServerHandle;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.stop();
});

/** Plays whatever is legal for whoever is on turn until the phase changes. */
/** Strongest first, using the profile's ranking. */
function byStrength(cards: string[]): string[] {
  return [...cards].sort((a, b) => RANKS.indexOf(a.slice(1) as never) - RANKS.indexOf(b.slice(1) as never));
}

async function driveUntil(
  clients: TestClient[],
  done: () => boolean,
  options: {
    revealOnce?: boolean;
    revealEveryHand?: boolean;
    teamBAlwaysBids?: boolean;
    /** The contract side throws every trick, so the hand fails predictably. */
    forceContractFailure?: boolean;
  } = {},
): Promise<void> {
  let revealed = false;
  const revealedHands = new Set<number>();
  for (let step = 0; step < 20000 && !done(); step += 1) {
    let acted = false;
    for (const client of clients) {
      const match = client.snapshot?.match;
      if (!match) continue;
      const actions = match.actions;
      if (actions.canNextHand) {
        await client.send('nextHand');
        acted = true;
        continue;
      }
      if (actions.canRematch) {
        if (options.revealEveryHand) {
          await client.send('rematch');
          acted = true;
        }
        continue;
      }
      if (actions.canContinueTrick) {
        await client.send('continueTrick');
        acted = true;
        continue;
      }
      if (actions.bids?.length > 0) {
        // Optionally keep the contract on one team, so the match reaches a
        // boundary in a handful of hands instead of wandering there.
        const wantsContract = options.teamBAlwaysBids ? (client.seat as number) % 2 === 1 : true;
        const takeIt = wantsContract && match.hand.auction.highBid === null;
        await client.send(takeIt ? 'bid' : 'pass', { value: 16 });
        acted = true;
        continue;
      }
      if (actions.canChooseTrump) {
        await client.send('chooseTrump', { mode: 'suit', suit: 'S' });
        acted = true;
        continue;
      }
      if (actions.canDouble) {
        await client.send('passDouble');
        acted = true;
        continue;
      }
      if (actions.canRedouble) {
        await client.send('passRedouble');
        acted = true;
        continue;
      }
      const handNumber = match.handNumber as number;
      const wantsReveal = options.revealEveryHand
        ? !revealedHands.has(handNumber)
        : Boolean(options.revealOnce) && !revealed;
      if (wantsReveal && actions.canRevealTrump) {
        revealed = true;
        revealedHands.add(handNumber);
        await client.send('revealTrump');
        acted = true;
        continue;
      }
      if (actions.legalCards?.length > 0) {
        // The contract side plays high and the defenders low, so contracts
        // usually make and the score moves in one direction.
        const ranked = byStrength(actions.legalCards as string[]);
        const bidderTeam = match.hand.bidderTeam as number | null;
        const onContractSide = bidderTeam !== null && (client.seat as number) % 2 === bidderTeam;
        // Making a contract depends on the deal; throwing one does not. The
        // contract side plays its lowest card and the defenders their highest,
        // so the hand fails and the score moves one way every time.
        const playHigh = options.forceContractFailure ? !onContractSide : onContractSide || bidderTeam === null;
        await client.send('playCard', { card: playHigh ? ranked[0] : ranked.at(-1) });
        acted = true;
        continue;
      }
    }
    if (!acted) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(done(), 'the table did not reach the expected state');
}

describe('four browsers playing a hand', () => {
  it('runs auction, trump, doubling, play, scoring and the next deal', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient, TestClient, TestClient, TestClient];

    await driveUntil(clients, () => host.snapshot?.match?.phase === 'HAND_RESULT', { revealOnce: true });

    const result = host.snapshot.match.hand.result;
    assert.equal(result.annulled, false, 'trump was revealed, so the hand scores');
    assert.equal(result.capturedPoints[0] + result.capturedPoints[1], 28);
    assert.ok([1, 2, 4].includes(result.stake));

    // Every player confirms before the next deal.
    for (const client of clients) {
      await client.waitUntil(() => client.snapshot.match.phase === 'HAND_RESULT', 'hand result');
    }
    for (const client of clients) await client.send('nextHand');
    for (const client of clients) {
      await client.waitUntil(() => client.snapshot.match.handNumber === 2, 'second hand');
    }
    assert.equal(host.snapshot.match.phase, 'BIDDING');
    assert.equal(host.snapshot.match.hand.yourCards.length, 4);
  });

  it('never sends a player another player’s cards, the deck or hidden trump', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];
    await driveUntil(clients, () => host.snapshot?.match?.phase === 'HAND_RESULT', { revealOnce: true });
    // Every seat must hold the finished hand before its traffic is inspected.
    for (const client of clients) {
      await client.waitUntil(
        () => client.snapshot?.match?.phase === 'HAND_RESULT' && client.snapshot.match.hand.tricks.length === 8,
        'final trick delivered',
      );
    }

    for (const client of clients) {
      const seat = client.seat as number;
      const traffic = client.received.map((message) => message.raw).join('\n');
      assert.equal(traffic.includes('"deck"'), false, 'the deck never leaves the server');
      assert.equal(traffic.includes('password_verifier'), false);
      assert.equal(traffic.includes('"hands"'), false, 'no other hands are serialised');

      // Cards this player never saw must not appear in anything sent to them,
      // except as cards actually played to a trick.
      const playedCards = new Set<string>();
      for (const trick of client.snapshot.match.hand.tricks) {
        for (const play of trick.plays) playedCards.add(play.card);
      }
      const ownCards = new Set<string>(
        client.received
          .flatMap((message) => {
            const snapshot = (message.data.snapshot ?? null) as { match?: { hand?: { yourCards?: string[] } } } | null;
            return snapshot?.match?.hand?.yourCards ?? [];
          })
          .concat(client.snapshot.match.hand.yourCards as string[]),
      );
      for (const card of FULL_DECK) {
        if (playedCards.has(card) || ownCards.has(card)) continue;
        assert.equal(
          traffic.includes(`"${card}"`),
          false,
          `seat ${seat} received card ${card} it never should have seen`,
        );
      }
    }
  });

  it('plays a whole match to a boundary and then a rematch', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];

    // Team B takes every contract and deliberately throws it, so the match
    // reaches the -6 boundary in exactly six hands rather than wandering there.
    await driveUntil(clients, () => host.snapshot?.match?.phase === 'MATCH_RESULT', {
      revealEveryHand: true,
      teamBAlwaysBids: true,
      forceContractFailure: true,
    });
    const winner = host.snapshot.match.matchResult.winner as number;
    const scores = host.snapshot.match.scores as [number, number];
    const winnerScore = winner === 0 ? scores[0] : scores[1];
    const loserScore = winner === 0 ? scores[1] : scores[0];
    assert.ok(winnerScore >= 6 || loserScore <= -6, `match ended on a boundary: ${scores.join(', ')}`);
    assert.ok(host.snapshot.match.history.length >= 6, 'every hand is summarised');
    assert.ok(
      host.snapshot.match.history.every((entry: any) => entry.bidderTeam === 1),
      'the contract stayed with team B',
    );
    assert.equal(winner, 0, 'the defending team wins when every contract fails');

    for (const client of clients) {
      await client.waitUntil(() => client.snapshot.match.phase === 'MATCH_RESULT', 'match result');
    }
    for (const client of clients) await client.send('rematch');
    for (const client of clients) {
      await client.waitUntil(() => client.snapshot.match.phase === 'BIDDING', 'rematch dealt');
    }
    assert.deepEqual(host.snapshot.match.scores, [0, 0], 'a rematch resets the scores');
    assert.equal(host.snapshot.match.handNumber, 1);
    assert.equal(host.snapshot.you.seat, 0, 'seats are retained');
    for (const client of clients) client.close();
  });

  it('is idempotent for retried commands and rejects stale revisions', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];
    const auctionSeat = clients.find((client) => client.snapshot.match.actions.bids.length > 0) as TestClient;

    const commandId = 'retry-1';
    const first = await auctionSeat.send('bid', { value: 18 }, { commandId });
    assert.equal(first.type, 'ack');
    const replay = await auctionSeat.send('bid', { value: 18 }, { commandId });
    assert.equal(replay.type, 'ack');
    assert.equal(replay.duplicate, true);
    assert.equal(replay.revision, first.revision, 'the original result is returned unchanged');

    const conflicting = await auctionSeat.send('bid', { value: 20 }, { commandId });
    assert.equal(conflicting.type, 'error');
    assert.equal(conflicting.code, 'INVALID');

    const stale = await host.send('ready', { ready: true }, { expectedRevision: 1 });
    assert.equal(stale.type, 'error');
    assert.equal(stale.code, 'STALE_STATE');
  });

  it('pauses gameplay while a seat is disconnected and resumes on reconnect', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];
    const bidder = clients.find((client) => client.snapshot.match.actions.bids.length > 0) as TestClient;
    // Whoever leaves must not be the player on turn, so the paused command has an actor.
    const away = clients.find((client) => client !== bidder && client !== host) as TestClient;
    away.close();
    await host.waitUntil(() => host.snapshot.paused !== null, 'pause');
    const rejected = await bidder.send('bid', { value: 17 });
    assert.equal(rejected.type, 'error');
    assert.equal(rejected.code, 'WRONG_PHASE');

    await away.connect();
    await host.waitUntil(() => host.snapshot.paused === null, 'resume');
    const accepted = await bidder.send('bid', { value: 17 });
    assert.equal(accepted.type, 'ack', JSON.stringify(accepted));
  });

  it('ends games cleanly when the server restarts, rather than half-restoring them', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];
    const roomId = host.roomId as string;
    for (const client of clients) client.close();

    await restartServer();

    // Nothing was persisted, so the room is simply gone and says so.
    const state = await host.request('GET', `/api/rooms/${roomId}/state`);
    assert.equal(state.status, 404);
    assert.equal(state.body.error.code, 'NOT_FOUND');
    await assert.rejects(host.connect(), 'the socket is refused too');
  });

  it('restores the same seat and hand after a reload', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host] = clients as [TestClient];
    const before = [...host.snapshot.match.hand.yourCards].sort();
    host.close();
    await host.connect();
    const after = [...host.snapshot.match.hand.yourCards].sort();
    assert.deepEqual(after, before, 'the private hand is unchanged after reconnecting');
    assert.equal(host.snapshot.you.seat, 0);
  });
});
