import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';

process.env.NODE_ENV = 'test';
process.env.SKIP_DOTENV = '1';
// Each test file runs in its own process, so derive a distinct fixed port from
// the pid: fixed, because restart tests must come back on the same address.
process.env.PORT = process.env.TEST_PORT ?? String(40000 + (process.pid % 20000));
process.env.SECURE_COOKIES = '0';
process.env.REQUIRE_HTTPS = '0';
process.env.LOG_LEVEL = 'error';
process.env.SWEEP_INTERVAL_MS = '250';
process.env.LIMIT_ROOM_CREATE = '500';
process.env.LIMIT_JOIN_IP = '500';
process.env.HOST_TRANSFER_AFTER_MS = '800';
process.env.RECOVERY_TTL_MS = '60000';

// Required after the environment is prepared: config is read at import time.
/* eslint-disable @typescript-eslint/no-var-requires */
const serverModule = require('../../src/server/index') as typeof import('../../src/server/index');
/* eslint-enable @typescript-eslint/no-var-requires */

export interface ServerHandle {
  baseUrl: string;
  stop(): Promise<void>;
}

let started = false;

/** Restarts the server on the same port. Rooms live in memory, so they are gone. */
export async function restartServer(): Promise<void> {
  await serverModule.stop();
  await serverModule.start();
}

export async function startServer(): Promise<ServerHandle> {
  if (!started) {
    await serverModule.start();
    started = true;
  }
  const address = serverModule.server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async stop() {
      await serverModule.stop();
      started = false;
    },
  };
}

export interface RecordedMessage {
  type: string;
  raw: string;
  data: Record<string, unknown>;
}

/** One browser: its own cookie jar, its own socket, its own recorded traffic. */
export class TestClient {
  cookie: string | null = null;
  csrfToken: string | null = null;
  admission: string | null = null;
  roomId: string | null = null;
  seat: number | null = null;
  snapshot: any = null;
  readonly received: RecordedMessage[] = [];
  private socket: WebSocket | null = null;
  private waiters: { predicate: () => boolean; resolve: () => void; reject: (error: Error) => void }[] = [];
  private acks = new Map<string, (value: Record<string, unknown>) => void>();

  constructor(
    public readonly baseUrl: string,
    public readonly name: string,
  ) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: any }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}),
        ...(this.admission ? { 'x-admission': this.admission } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] as string;
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  async createRoom(seat: number): Promise<{ roomId: string; password: string }> {
    const result = await this.request('POST', '/api/rooms', { name: this.name, seat });
    if (result.status !== 201) throw new Error(`create failed: ${JSON.stringify(result.body)}`);
    this.roomId = result.body.roomId;
    this.csrfToken = result.body.csrfToken;
    this.seat = seat;
    return { roomId: result.body.roomId, password: result.body.password };
  }

  async join(roomId: string, password: string, seat: number): Promise<void> {
    this.roomId = roomId;
    const admission = await this.request('POST', `/api/rooms/${roomId}/admission`, { password });
    if (admission.status !== 201) throw new Error(`admission failed: ${JSON.stringify(admission.body)}`);
    this.admission = admission.body.token;
    const claim = await this.request('POST', `/api/rooms/${roomId}/claim`, { name: this.name, seat });
    if (claim.status !== 201) throw new Error(`claim failed: ${JSON.stringify(claim.body)}`);
    this.admission = null;
    this.csrfToken = claim.body.csrfToken;
    this.seat = seat;
  }

  async connect(): Promise<void> {
    const roomId = this.roomId as string;
    const url = `${this.baseUrl.replace('http', 'ws')}/api/rooms/${roomId}/socket`;
    const socket = new WebSocket(url, { headers: { cookie: this.cookie ?? '', origin: this.baseUrl } });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    socket.on('message', (raw) => {
      const text = raw.toString();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return;
      }
      this.received.push({ type: String(data.type), raw: text, data });
      if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (data.type === 'snapshot' || data.type === 'update') {
        this.snapshot = data.snapshot;
      }
      if ((data.type === 'ack' || data.type === 'error') && typeof data.commandId === 'string') {
        const resolver = this.acks.get(data.commandId);
        if (resolver) {
          this.acks.delete(data.commandId);
          resolver(data);
        }
      }
      this.check();
    });
    socket.send(JSON.stringify({ type: 'snapshot' }));
    await this.waitUntil(() => this.snapshot !== null, 'first snapshot');
  }

  private check(): void {
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.predicate()) return true;
      waiter.resolve();
      return false;
    });
  }

  waitUntil(predicate: () => boolean, label = 'condition', timeoutMs = 5000): Promise<void> {
    if (predicate()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== wrappedResolve);
        reject(new Error(`timeout waiting for ${label} (${this.name})`));
      }, timeoutMs);
      const wrappedResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.push({ predicate, resolve: wrappedResolve, reject });
      this.check();
    });
  }

  /** Sends a command and resolves with the ack or error frame for it. */
  send(
    action: string,
    payload: Record<string, unknown> = {},
    options: { commandId?: string; expectedRevision?: number | null } = {},
  ): Promise<Record<string, unknown>> {
    const commandId = options.commandId ?? `cmd-${Math.random().toString(36).slice(2)}`;
    // Mirrors the client: only turn-exclusive commands pin a revision.
    const expectedRevision = options.expectedRevision === undefined ? null : options.expectedRevision;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response to ${action}`)), 5000);
      this.acks.set(commandId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    this.socket?.send(JSON.stringify({ type: 'command', commandId, expectedRevision, action, payload }));
    return promise;
  }

  sendRaw(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

export async function seatedTable(baseUrl: string): Promise<{ clients: TestClient[]; roomId: string; password: string }> {
  const host = new TestClient(baseUrl, 'Host Hana');
  const { roomId, password } = await host.createRoom(0);
  const guests = [
    new TestClient(baseUrl, 'Guest Gita'),
    new TestClient(baseUrl, 'Guest Gopal'),
    new TestClient(baseUrl, 'Guest Grace'),
  ];
  await guests[0]?.join(roomId, password, 1);
  await guests[1]?.join(roomId, password, 2);
  await guests[2]?.join(roomId, password, 3);
  const clients = [host, ...guests];
  for (const client of clients) await client.connect();
  return { clients, roomId, password };
}

/** Brings a seated table to the first playing phase with everyone ready. */
export async function startedMatch(baseUrl: string): Promise<{ clients: TestClient[]; roomId: string; password: string }> {
  const table = await seatedTable(baseUrl);
  for (const client of table.clients) await client.send('ready', { ready: true });
  const host = table.clients[0] as TestClient;
  await host.waitUntil(() => host.snapshot?.canStart === true, 'ready to start');
  await host.send('start');
  for (const client of table.clients) {
    await client.waitUntil(() => client.snapshot?.match?.phase === 'BIDDING', 'bidding');
  }
  return table;
}
