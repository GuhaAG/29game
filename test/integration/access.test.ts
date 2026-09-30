import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { WebSocket } from 'ws';
import { type ServerHandle, TestClient, seatedTable, startServer, startedMatch } from './harness';

let server: ServerHandle;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.stop();
});

async function freshRoom(): Promise<{ host: TestClient; roomId: string; password: string }> {
  const host = new TestClient(server.baseUrl, `Host ${Math.random().toString(36).slice(2, 7)}`);
  const { roomId, password } = await host.createRoom(0);
  return { host, roomId, password };
}

describe('access protection', () => {
  it('reveals nothing to a room id without a password or session', async () => {
    const { roomId } = await freshRoom();
    const stranger = new TestClient(server.baseUrl, 'Stranger');
    stranger.roomId = roomId;

    const seats = await stranger.request('GET', `/api/rooms/${roomId}/seats`);
    assert.equal(seats.status, 401);
    assert.equal(JSON.stringify(seats.body).includes('Host'), false);

    const state = await stranger.request('GET', `/api/rooms/${roomId}/state`);
    assert.equal(state.status, 401);

    const wrong = await stranger.request('POST', `/api/rooms/${roomId}/admission`, { password: 'AAAAA-BBBBB-CCCCC-DDDDD' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'UNAUTHORIZED');
    assert.equal(JSON.stringify(wrong.body).toLowerCase().includes('seat'), false);
  });

  it('answers an unknown room exactly like a wrong password', async () => {
    const stranger = new TestClient(server.baseUrl, 'Stranger');
    const missingRoomId = `zz${Math.random().toString(36).slice(2, 10)}${'z'.repeat(16)}`.slice(0, 26);
    const unknown = await stranger.request('POST', `/api/rooms/${missingRoomId}/admission`, {
      password: 'AAAAA-BBBBB-CCCCC-DDDDD',
    });
    const { roomId } = await freshRoom();
    const wrong = await stranger.request('POST', `/api/rooms/${roomId}/admission`, {
      password: 'AAAAA-BBBBB-CCCCC-DDDDE',
    });
    assert.equal(unknown.status, wrong.status);
    assert.deepEqual(unknown.body, wrong.body);
  });

  it('gives the seat to exactly one of two simultaneous claims', async () => {
    const { roomId, password } = await freshRoom();
    const first = new TestClient(server.baseUrl, 'Racer One');
    const second = new TestClient(server.baseUrl, 'Racer Two');
    for (const client of [first, second]) {
      client.roomId = roomId;
      const admission = await client.request('POST', `/api/rooms/${roomId}/admission`, { password });
      client.admission = admission.body.token;
    }
    const results = await Promise.all([
      first.request('POST', `/api/rooms/${roomId}/claim`, { name: first.name, seat: 2 }),
      second.request('POST', `/api/rooms/${roomId}/claim`, { name: second.name, seat: 2 }),
    ]);
    const created = results.filter((result) => result.status === 201);
    const rejected = results.filter((result) => result.status !== 201);
    assert.equal(created.length, 1, 'exactly one claim succeeds');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.body.error.code, 'SEAT_TAKEN');
  });

  it('rejects a duplicate screen name regardless of case', async () => {
    const { roomId, password } = await freshRoom();
    const guest = new TestClient(server.baseUrl, 'Ravi');
    await guest.join(roomId, password, 1);
    const twin = new TestClient(server.baseUrl, 'RAVI');
    twin.roomId = roomId;
    const admission = await twin.request('POST', `/api/rooms/${roomId}/admission`, { password });
    twin.admission = admission.body.token;
    const claim = await twin.request('POST', `/api/rooms/${roomId}/claim`, { name: 'RAVI', seat: 2 });
    assert.equal(claim.status, 409);
    assert.equal(claim.body.error.code, 'NAME_TAKEN');
  });

  it('refuses a fifth player and refuses entry once the match starts', async () => {
    const { clients, roomId, password } = await seatedTable(server.baseUrl);
    const fifth = new TestClient(server.baseUrl, 'Fifth Wheel');
    fifth.roomId = roomId;
    const full = await fifth.request('POST', `/api/rooms/${roomId}/admission`, { password });
    assert.equal(full.status, 409);
    assert.equal(full.body.error.code, 'ROOM_UNAVAILABLE');

    for (const client of clients) await client.send('ready', { ready: true });
    const host = clients[0] as TestClient;
    await host.waitUntil(() => host.snapshot.canStart === true, 'ready');
    await host.send('start');
    await host.waitUntil(() => host.snapshot.room.status === 'active', 'started');
    const late = await fifth.request('POST', `/api/rooms/${roomId}/admission`, { password });
    assert.equal(late.status, 409);
    for (const client of clients) client.close();
  });

  it('keeps host powers to the host and personal edits to their owner', async () => {
    const { clients } = await seatedTable(server.baseUrl);
    const [host, guest] = clients as [TestClient, TestClient];

    const start = await guest.send('start');
    assert.equal(start.code, 'UNAUTHORIZED');
    const rotate = await guest.send('rotatePassword');
    assert.equal(rotate.code, 'UNAUTHORIZED');
    const remove = await guest.send('removeMember', { seat: 0 });
    assert.equal(remove.code, 'UNAUTHORIZED');

    // The host renaming "another player" can only ever rename themselves.
    await host.send('updateOwnName', { name: 'Renamed Host', seat: 1 });
    await guest.waitUntil(() => guest.snapshot.seats[0].name === 'Renamed Host', 'host renamed');
    assert.equal(guest.snapshot.seats[1].name, guest.name, 'the guest keeps their own name');
    for (const client of clients) client.close();
  });

  it('moves a player to an empty seat atomically and refuses an occupied one', async () => {
    const { host, roomId, password } = await freshRoom();
    await host.connect();
    const guest = new TestClient(server.baseUrl, 'Mover');
    await guest.join(roomId, password, 1);
    await guest.connect();

    const blocked = await guest.send('moveOwnSeat', { seat: 0 });
    assert.equal(blocked.code, 'SEAT_TAKEN');

    await guest.send('moveOwnSeat', { seat: 3 });
    await host.waitUntil(() => host.snapshot.seats[3].name === 'Mover', 'moved');
    assert.equal(host.snapshot.seats[1].name, null, 'the old seat is released in the same step');
    host.close();
    guest.close();
  });

  it('clears readiness on a name change and blocks Start until everyone re-confirms', async () => {
    const { clients } = await seatedTable(server.baseUrl);
    const [host, guest] = clients as [TestClient, TestClient];
    for (const client of clients) await client.send('ready', { ready: true });
    await host.waitUntil(() => host.snapshot.canStart === true, 'ready');

    await guest.send('updateOwnName', { name: 'Renamed Guest' });
    await host.waitUntil(() => host.snapshot.canStart === false, 'readiness cleared');
    const start = await host.send('start');
    assert.equal(start.type, 'error');
    assert.equal(start.code, 'WRONG_PHASE');
    for (const client of clients) client.close();
  });

  it('replaces an earlier connection for the same seat', async () => {
    const { host } = await freshRoom();
    await host.connect();
    const secondTab = new TestClient(server.baseUrl, host.name);
    secondTab.roomId = host.roomId;
    secondTab.cookie = host.cookie;
    await secondTab.connect();
    await host.waitUntil(() => host.received.some((message) => message.type === 'replaced'), 'replacement notice');
    assert.equal(host.open, false, 'the first tab is closed');
    secondTab.close();
  });

  it('refuses a socket from another origin and a session from another room', async () => {
    const { host } = await freshRoom();
    const other = await freshRoom();

    const crossOrigin = new WebSocket(
      `${server.baseUrl.replace('http', 'ws')}/api/rooms/${host.roomId}/socket`,
      { headers: { cookie: host.cookie ?? '', origin: 'http://evil.example' } },
    );
    await assert.rejects(
      new Promise((resolve, reject) => {
        crossOrigin.once('open', resolve);
        crossOrigin.once('error', reject);
      }),
    );

    const crossRoom = new WebSocket(
      `${server.baseUrl.replace('http', 'ws')}/api/rooms/${other.roomId}/socket`,
      { headers: { cookie: host.cookie ?? '', origin: server.baseUrl } },
    );
    await assert.rejects(
      new Promise((resolve, reject) => {
        crossRoom.once('open', resolve);
        crossRoom.once('error', reject);
      }),
      'a session for one room cannot open another room',
    );
  });

  it('derives the actor from the connection, not from the payload', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const notOnTurn = clients.find((client) => client.snapshot.match.actions.bids.length === 0) as TestClient;
    const forged = await notOnTurn.send('bid', { value: 20, seat: notOnTurn.snapshot.match.hand.auction.turn });
    assert.equal(forged.type, 'error');
    assert.equal(forged.code, 'NOT_YOUR_TURN');
    for (const client of clients) client.close();
  });

  it('expires admission grants when the host rotates the password', async () => {
    const { host, roomId, password } = await freshRoom();
    await host.connect();
    const guest = new TestClient(server.baseUrl, 'Late Guest');
    guest.roomId = roomId;
    const admission = await guest.request('POST', `/api/rooms/${roomId}/admission`, { password });
    guest.admission = admission.body.token;

    const rotated = await host.send('rotatePassword');
    assert.equal(rotated.type, 'ack');
    const newPassword = String((rotated.reply as Record<string, unknown>).password);
    assert.notEqual(newPassword, password);

    const claim = await guest.request('POST', `/api/rooms/${roomId}/claim`, { name: guest.name, seat: 1 });
    assert.equal(claim.status, 401);

    const old = await guest.request('POST', `/api/rooms/${roomId}/admission`, { password });
    assert.equal(old.status, 401);
    const fresh = await guest.request('POST', `/api/rooms/${roomId}/admission`, { password: newPassword });
    assert.equal(fresh.status, 201);
    host.close();
  });

  it('rate-limits repeated wrong passwords for a room', async () => {
    const { roomId } = await freshRoom();
    const attacker = new TestClient(server.baseUrl, 'Guesser');
    let limited = false;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const response = await attacker.request('POST', `/api/rooms/${roomId}/admission`, {
        password: `WRONG-${attempt}`,
      });
      if (response.status === 429) {
        limited = true;
        assert.equal(response.body.error.code, 'RATE_LIMITED');
        break;
      }
    }
    assert.ok(limited, 'repeated failures are throttled');
  });

  it('recovers a lost seat once, revoking the earlier session', async () => {
    const { clients } = await startedMatch(server.baseUrl);
    const [host, , , lost] = clients as [TestClient, TestClient, TestClient, TestClient];
    const lostCookie = lost.cookie;
    lost.close();
    await host.waitUntil(() => host.snapshot.paused !== null, 'paused');

    const issued = await host.send('issueRecovery', { seat: 3 });
    assert.equal(issued.type, 'ack');
    const code = String((issued.reply as Record<string, unknown>).recoveryCode);

    const replacement = new TestClient(server.baseUrl, lost.name);
    replacement.roomId = lost.roomId;
    const redeemed = await replacement.request('POST', `/api/rooms/${lost.roomId}/recover`, { code });
    assert.equal(redeemed.status, 201);
    assert.equal(redeemed.body.seat, 3);
    await replacement.connect();
    assert.equal(replacement.snapshot.you.seat, 3);
    assert.equal(replacement.snapshot.match.hand.yourCards.length > 0, true, 'the same hand comes back');

    const reuse = await replacement.request('POST', `/api/rooms/${lost.roomId}/recover`, { code });
    assert.equal(reuse.status, 401, 'a recovery code works once');

    const ghost = new TestClient(server.baseUrl, 'Ghost');
    ghost.roomId = lost.roomId;
    ghost.cookie = lostCookie;
    const ghostState = await ghost.request('GET', `/api/rooms/${lost.roomId}/state`);
    assert.equal(ghostState.status, 401, 'the old credential is revoked');

    for (const client of [...clients, replacement]) client.close();
  });

  it('transfers the host role after the host stays away', async () => {
    const { clients } = await seatedTable(server.baseUrl);
    const [host, guest] = clients as [TestClient, TestClient];
    host.close();
    await guest.waitUntil(() => guest.snapshot.seats.some((seat: any) => seat.isHost && seat.seat !== 0), 'transfer', 8000);
    assert.equal(guest.snapshot.you.isHost, true, 'the longest-connected player takes over');
    for (const client of clients) client.close();
  });

  it('serves the application shell with hardened headers and no path traversal', async () => {
    const anonymous = new TestClient(server.baseUrl, 'Browser');
    for (const path of ['/', '/room/abcdefghijkl', '/app.js', '/styles.css']) {
      const response = await fetch(`${server.baseUrl}${path}`);
      assert.equal(response.status, 200, `${path} is served`);
      assert.ok(response.headers.get('content-security-policy'), `${path} carries a CSP`);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
    }
    const traversal = await fetch(`${server.baseUrl}/../package.json`);
    assert.notEqual(traversal.status, 200, 'paths cannot escape the public directory');
    const missing = await anonymous.request('GET', '/api/rooms/abcdefghijkl/nonsense');
    assert.equal(missing.status, 404);
  });

  it('closes the room on the host’s command and revokes every session', async () => {
    const { clients } = await seatedTable(server.baseUrl);
    const [host, guest] = clients as [TestClient, TestClient];
    await host.send('closeRoom');
    await guest.waitUntil(() => guest.snapshot.room.status === 'closed', 'closed');
    const state = await guest.request('GET', `/api/rooms/${guest.roomId}/state`);
    assert.equal(state.status, 401);
    for (const client of clients) client.close();
  });
});
