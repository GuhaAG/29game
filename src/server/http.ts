import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config';
import { AppError } from './errors';

const MAX_BODY_BYTES = 16 * 1024;

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first) return first.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AppError('INVALID', 'That request was too large.');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError('INVALID', 'Malformed request.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID', 'Malformed request.');
  }
}

function expectedOrigins(req: IncomingMessage): string[] {
  if (config.allowedOrigins.length > 0) return config.allowedOrigins;
  const host = req.headers.host;
  if (!host) return [];
  const scheme = isSecureRequest(req) ? 'https' : 'http';
  return [`${scheme}://${host}`, `http://${host}`, `https://${host}`];
}

export function isSecureRequest(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  if (config.trustProxy && req.headers['x-forwarded-proto'] === 'https') return true;
  return false;
}

/** Same-origin requirement for every mutation and for the socket upgrade. */
export function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client or same-origin navigation
  return expectedOrigins(req).includes(origin);
}

export function assertMutationAllowed(req: IncomingMessage): void {
  if (config.requireHttps && !isSecureRequest(req)) {
    throw new AppError('INVALID', 'A secure connection is required.');
  }
  if (!originAllowed(req)) throw new AppError('UNAUTHORIZED', 'That request came from an unexpected origin.');
}

export function sessionCookieHeader(roomId: string, value: string, maxAgeMs: number): string {
  const parts = [
    `seat_session=${encodeURIComponent(value)}`,
    `Path=/api/rooms/${roomId}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(payload);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError('SERVER_ERROR', 'Something went wrong. Please try again.');
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof AppError) {
    const headers: Record<string, string> = {};
    if (error.retryAfterMs) headers['retry-after'] = String(Math.ceil(error.retryAfterMs / 1000));
    sendJson(res, error.status, { error: { code: error.code, message: error.message } }, headers);
    return;
  }
  const mapped = toAppError(error);
  const headers: Record<string, string> = {};
  if (mapped.retryAfterMs) headers['retry-after'] = String(Math.ceil(mapped.retryAfterMs / 1000));
  sendJson(res, mapped.status, { error: { code: mapped.code, message: mapped.message } }, headers);
}
