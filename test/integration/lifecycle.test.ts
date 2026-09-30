// Short lifetimes, set before the harness reads the configuration.
process.env.LOBBY_IDLE_MS = '2000';
process.env.ACTIVE_IDLE_MS = '2000';
process.env.EXPIRY_WARNING_MS = '1200';
process.env.PURGE_EXPIRED_AFTER_MS = '1500';
process.env.SWEEP_INTERVAL_MS = '200';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { type ServerHandle, TestClient, startServer } from './harness';
import { getRoom } from '../../src/server/state';

let server: ServerHandle;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.stop();
});

describe('room lifetime', () => {
  it('warns, expires, revokes sessions, drops secrets and then purges', async () => {
    const host = new TestClient(server.baseUrl, 'Idle Host');
    const { roomId } = await host.createRoom(0);
    await host.connect();

    await host.waitUntil(
      () => host.received.some((message) => message.type === 'notice' && message.data.level === 'warning'),
      'expiry warning',
      6000,
    );

    await host.waitUntil(
      () => host.received.some((message) => message.type === 'closed' && message.data.reason === 'expired'),
      'expiry',
      6000,
    );

    const state = await host.request('GET', `/api/rooms/${roomId}/state`);
    assert.equal(state.status, 401, 'sessions are revoked on expiry');

    const expired = getRoom(roomId);
    if (expired) {
      assert.equal(expired.status, 'expired');
      assert.equal(expired.password, null, 'the readable password is gone');
      assert.equal(expired.match, null, 'the game state is gone');
    }

    // The room itself is forgotten shortly afterwards.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && getRoom(roomId)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(getRoom(roomId), undefined, 'nothing is left of the room');
  });

  it('keeps the room alive while people are acting', async () => {
    const host = new TestClient(server.baseUrl, 'Busy Host');
    const { roomId } = await host.createRoom(0);
    await host.connect();
    for (let tick = 0; tick < 5; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const response = await host.send('ready', { ready: tick % 2 === 0 });
      assert.equal(response.type, 'ack');
    }
    const state = await host.request('GET', `/api/rooms/${roomId}/state`);
    assert.equal(state.status, 200, 'user actions keep extending the lifetime');
    host.close();
  });
});
