import { createHash } from 'node:crypto';
import { config } from './config';

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? 20;

/** Stable pseudonym for a room or member, so logs never carry the real identifier. */
export function pseudonym(value: string): string {
  return createHash('sha256').update(`log ${value}`).digest('base64url').slice(0, 10);
}

const FORBIDDEN_KEYS = /password|cookie|token|verifier|secret|code|deck|hand|cards|trump/i;

/**
 * Drops anything that could carry a credential or private card knowledge.
 * Logging is for action types, revisions and timings only.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = FORBIDDEN_KEYS.test(key) ? '[redacted]' : sanitize(entry, depth + 1);
  }
  return output;
}

function write(level: string, message: string, fields?: Record<string, unknown>): void {
  if ((LEVELS[level] ?? 0) < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ? (sanitize(fields) as Record<string, unknown>) : {}),
  };
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : (level as 'info' | 'warn' | 'error')](JSON.stringify(line));
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};

export const metrics = {
  activeRooms: 0,
  connectedPlayers: 0,
  joinFailures: 0,
  rejectedActions: 0,
  reconnects: 0,
  databaseFailures: 0,
  expiredRooms: 0,
  commandCount: 0,
  commandLatencyTotalMs: 0,
  commandLatencyMax: 0,
};

export function recordCommandLatency(ms: number): void {
  metrics.commandCount += 1;
  metrics.commandLatencyTotalMs += ms;
  metrics.commandLatencyMax = Math.max(metrics.commandLatencyMax, ms);
}
