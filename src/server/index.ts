import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROFILE, RULES_VERSION, type Seat } from '../engine';
import { handleCommand } from './commands';
import { config } from './config';
import { AppError, unauthorized } from './errors';
import {
  assertMutationAllowed,
  clientIp,
  originAllowed,
  parseCookies,
  readJson,
  sendError,
  sendJson,
  sessionCookieHeader,
  toAppError,
} from './http';
import { hub } from './hub';
import { startLifecycle, stopLifecycle } from './lifecycle';
import { log, metrics, pseudonym, recordCommandLatency } from './logger';
import {
  SESSION_COOKIE,
  authenticate,
  claimSeat,
  createRoom,
  listSeats,
  redeemRecovery,
  requestAdmission,
  snapshotFor,
} from './rooms';
import { buildSnapshot } from './snapshot';
import { activeRoomCount, clearAll, getRoom } from './state';
import { locale, t, textTree } from './text';

/** Resolves whether the server runs from dist/src/server or from src/server. */
function resolvePublicDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'public'),
    join(__dirname, '..', '..', 'public'),
    join(process.cwd(), 'public'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? (candidates[0] as string);
}

const PUBLIC_DIR = resolvePublicDir();

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function serveStatic(res: ServerResponse, relativePath: string): void {
  const safe = normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }
  const extension = filePath.slice(filePath.lastIndexOf('.'));
  if (extension === '.html') {
    // Page text is written as {{key}} in the HTML and filled in from locales/.
    const page = readFileSync(filePath, 'utf8').replace(/\{\{([\w.]+)\}\}/g, (_whole, key: string) =>
      escapeHtml(key === 'locale' ? locale : t(key)),
    );
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extension] as string,
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    });
    res.end(page);
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': extension === '.html' ? 'no-store' : 'no-cache',
    ...SECURITY_HEADERS,
  });
  createReadStream(filePath).pipe(res);
}

function roomIdFrom(pathname: string): string | null {
  const match = /^\/api\/rooms\/([a-z0-9]{10,40})(\/[a-z]+)?$/.exec(pathname);
  return match ? (match[1] as string) : null;
}

function requireCsrf(req: IncomingMessage, roomId: string, cookies: Record<string, string>): void {
  const cookie = cookies[SESSION_COOKIE];
  if (!cookie) return;
  const header = req.headers['x-csrf-token'];
  const token = Array.isArray(header) ? header[0] : header;
  const context = authenticate(roomId, cookie);
  if (!token || token !== context.session.csrfToken) {
    throw unauthorized(t('server.csrf'));
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const cookies = parseCookies(req.headers.cookie);
  const ip = clientIp(req);

  if (url.pathname === '/api/rules' && method === 'GET') {
    const sections = (textTree().rules as { sections?: unknown } | undefined)?.sections ?? [];
    sendJson(res, 200, { rulesVersion: RULES_VERSION, profile: PROFILE, sections });
    return;
  }

  if (url.pathname === '/api/text' && method === 'GET') {
    sendJson(res, 200, { locale, strings: textTree() }, { 'cache-control': 'no-store' });
    return;
  }

  if (url.pathname === '/api/rooms' && method === 'POST') {
    assertMutationAllowed(req);
    const body = await readJson(req);
    const created = await createRoom({ name: body.name, seat: body.seat, ip });
    log.info('room created', { room: pseudonym(created.roomId) });
    sendJson(
      res,
      201,
      {
        roomId: created.roomId,
        password: created.password,
        seat: created.seat,
        name: created.name,
        csrfToken: created.session.csrfToken,
      },
      {
        'set-cookie': sessionCookieHeader(
          created.roomId,
          created.session.cookieValue,
          config.timings.absoluteLifetimeMs,
        ),
      },
    );
    return;
  }

  const roomId = roomIdFrom(url.pathname);
  if (!roomId) {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: t('server.notFound') } });
    return;
  }
  const action = url.pathname.slice(`/api/rooms/${roomId}`.length);
  const admissionHeader = req.headers['x-admission'];
  const grant = Array.isArray(admissionHeader) ? admissionHeader[0] : admissionHeader;

  if (action === '/admission' && method === 'POST') {
    assertMutationAllowed(req);
    const body = await readJson(req);
    try {
      sendJson(res, 201, await requestAdmission({ roomId, password: body.password, ip }));
    } catch (error) {
      metrics.joinFailures += 1;
      throw error;
    }
    return;
  }

  if (action === '/seats' && method === 'GET') {
    sendJson(res, 200, await listSeats({ roomId, grant }));
    return;
  }

  if (action === '/claim' && method === 'POST') {
    assertMutationAllowed(req);
    requireCsrf(req, roomId, cookies);
    const body = await readJson(req);
    const claim = await claimSeat({ roomId, grant, name: body.name, seat: body.seat });
    hub.refresh(roomId);
    sendJson(
      res,
      201,
      { seat: claim.seat, name: claim.name, csrfToken: claim.session.csrfToken },
      {
        'set-cookie': sessionCookieHeader(roomId, claim.session.cookieValue, config.timings.absoluteLifetimeMs),
      },
    );
    return;
  }

  if (action === '/state' && method === 'GET') {
    sendJson(res, 200, snapshotFor(roomId, cookies[SESSION_COOKIE]));
    return;
  }

  if (action === '/recover' && method === 'POST') {
    assertMutationAllowed(req);
    const body = await readJson(req);
    const recovered = await redeemRecovery({ roomId, code: body.code, ip });
    hub.refresh(roomId);
    sendJson(
      res,
      201,
      { seat: recovered.seat, csrfToken: recovered.session.csrfToken },
      {
        'set-cookie': sessionCookieHeader(roomId, recovered.session.cookieValue, config.timings.absoluteLifetimeMs),
      },
    );
    return;
  }

  sendJson(res, 404, { error: { code: 'NOT_FOUND', message: t('server.notFound') } });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (url.pathname === '/metrics') {
      sendJson(res, 200, {
        ...metrics,
        activeRooms: activeRoomCount(),
        commandLatencyAvgMs:
          metrics.commandCount === 0 ? 0 : Math.round(metrics.commandLatencyTotalMs / metrics.commandCount),
        connections: hub.connectionCount(),
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname === '/' || /^\/room\/[a-z0-9]+$/.test(url.pathname) || url.pathname === '/create') {
      serveStatic(res, 'index.html');
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    if (!(error instanceof AppError)) {
      log.error('request failed', { path: url.pathname, message: (error as Error).message });
    }
    sendError(res, error);
  }
}

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const match = /^\/api\/rooms\/([a-z0-9]{10,40})\/socket$/.exec(url.pathname);
  if (!match || !originAllowed(req)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const roomId = match[1] as string;
  const cookies = parseCookies(req.headers.cookie);
  try {
    // Credentials travel in the cookie, never in the socket URL.
    const context = authenticate(roomId, cookies[SESSION_COOKIE]);
    const seat = context.membership.seat;
    const membershipId = context.membership.id;
    wss.handleUpgrade(req, socket, head, (ws) => {
      attach(ws, roomId, membershipId, seat);
    });
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

function attach(ws: WebSocket, roomId: string, membershipId: string, seat: Seat): void {
  const connection = hub.register(
    roomId,
    membershipId,
    seat,
    ws as unknown as { send(data: string): void; close(code?: number, reason?: string): void; readyState: number },
  );
  metrics.reconnects += 1;

  void hub
    .setPresence(roomId, membershipId, true, connection.id)
    .catch((error: unknown) => log.warn('presence update failed', { message: (error as Error).message }));

  ws.on('message', (raw) => {
    void handleSocketMessage(connection.id, roomId, membershipId, raw.toString(), ws);
  });

  ws.on('pong', () => {
    connection.lastSeen = Date.now();
  });

  ws.on('close', () => {
    if (!hub.isCurrent(connection)) return; // replaced by a newer tab
    hub.remove(connection);
    void hub.setPresence(roomId, membershipId, false, null).catch(() => undefined);
  });
}

function sendSnapshot(membershipId: string, roomId: string, ws: WebSocket): void {
  const room = getRoom(roomId);
  const membership = room?.memberships.get(membershipId);
  if (!room || !membership) return;
  ws.send(JSON.stringify({ type: 'snapshot', snapshot: buildSnapshot(room, membership) }));
}

async function handleSocketMessage(
  connectionId: string,
  roomId: string,
  membershipId: string,
  raw: string,
  ws: WebSocket,
): Promise<void> {
  let message: {
    type?: string;
    commandId?: string;
    expectedRevision?: number;
    /** The gameplay or lobby command name; `type` is the envelope kind. */
    action?: string;
    payload?: Record<string, unknown>;
  };
  try {
    message = JSON.parse(raw) as typeof message;
  } catch {
    ws.send(JSON.stringify({ type: 'error', code: 'INVALID', message: t('server.malformed') }));
    return;
  }
  const connection = hub.connectionsIn(roomId).find((entry) => entry.id === connectionId);
  if (!connection) return;
  connection.lastSeen = Date.now();

  if (message.type === 'pong' || message.type === 'ping') return;

  if (message.type === 'snapshot') {
    sendSnapshot(membershipId, roomId, ws);
    return;
  }

  if (message.type !== 'command') {
    ws.send(JSON.stringify({ type: 'error', code: 'INVALID', message: t('server.unknownRequest') }));
    return;
  }

  if (!connection.bucket.take()) {
    ws.send(
      JSON.stringify({
        type: 'error',
        commandId: message.commandId,
        code: 'RATE_LIMITED',
        message: t('server.slowDown'),
      }),
    );
    return;
  }

  const started = Date.now();
  try {
    const outcome = await handleCommand(roomId, membershipId, {
      commandId: message.commandId as string,
      expectedRevision: message.expectedRevision,
      type: message.action ?? '',
      payload: message.payload,
    });
    recordCommandLatency(Date.now() - started);
    ws.send(
      JSON.stringify({
        type: 'ack',
        commandId: message.commandId,
        revision: outcome.revision,
        duplicate: outcome.duplicate,
        reply: outcome.privateReply ?? null,
      }),
    );
    if (outcome.duplicate) {
      sendSnapshot(membershipId, roomId, ws);
    } else {
      hub.broadcast(outcome.room, {
        events: outcome.events.map(publicEventFor),
        lastSeq: outcome.events.at(-1)?.seq,
      });
      if (outcome.room.status === 'closed') {
        hub.closeRoomConnections(roomId, 'closed', t('server.roomClosed'));
      }
    }
  } catch (error) {
    metrics.rejectedActions += 1;
    const appError = toAppError(error);
    if (!(error instanceof AppError)) {
      log.error('command failed', { room: pseudonym(roomId), message: (error as Error).message });
    }
    ws.send(
      JSON.stringify({
        type: 'error',
        commandId: message.commandId,
        code: appError.code,
        message: appError.message,
        retryAfterMs: appError.retryAfterMs ?? null,
      }),
    );
    if (appError.code === 'STALE_STATE' || appError.code === 'ILLEGAL_MOVE' || appError.code === 'WRONG_PHASE') {
      sendSnapshot(membershipId, roomId, ws);
    }
  }
}

function publicEventFor(event: { seq: number; type: string; actorSeat: Seat | null; publicPayload: unknown }): unknown {
  return { seq: event.seq, type: event.type, actorSeat: event.actorSeat, payload: event.publicPayload };
}

export async function start(): Promise<void> {
  startLifecycle();
  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, resolve);
  });
  log.info('listening', { port: config.port });
}

export async function stop(options: { forget?: boolean } = {}): Promise<void> {
  stopLifecycle();
  for (const connection of hub.everyConnection()) {
    try {
      connection.socket.close(1001, 'server shutting down');
    } catch {
      // already gone
    }
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (options.forget !== false) clearAll();
}

if (require.main === module) {
  void start();
  const shutdown = () => {
    // Rooms live only in memory, so a shutdown ends every game in progress.
    log.info('shutting down', { rooms: metrics.activeRooms });
    void stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export { server };
