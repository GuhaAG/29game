import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Loads .env if present. Values already in the environment always win. */
function loadDotEnv(): void {
  if (process.env.SKIP_DOTENV === '1') return;
  for (const candidate of [join(process.cwd(), '.env'), join(__dirname, '..', '..', '..', '.env')]) {
    let contents: string;
    try {
      contents = readFileSync(candidate, 'utf8');
    } catch {
      continue;
    }
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

loadDotEnv();

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function int(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = env(name);
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const minutes = 60_000;
const hours = 60 * minutes;

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const config = {
  port: int('PORT', 3000),
  host: env('HOST') ?? '0.0.0.0',
  /** Comma-separated list of origins permitted for mutations and socket upgrades. */
  allowedOrigins: (env('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  /** Off only for local plain-HTTP development. */
  secureCookies: bool('SECURE_COOKIES', process.env.NODE_ENV === 'production'),
  requireHttps: bool('REQUIRE_HTTPS', process.env.NODE_ENV === 'production'),
  trustProxy: bool('TRUST_PROXY', false),
  logLevel: env('LOG_LEVEL') ?? 'info',
  /**
   * Keys the verifiers for room passwords, sessions, admission and recovery
   * grants, so no credential is held in its usable form. Rooms never outlive the
   * process, so the key is generated at boot and needs no configuration.
   */
  verifierKey: randomBytes(32),
  limits: {
    roomCreatePerIp: {
      limit: int('LIMIT_ROOM_CREATE', 5),
      windowMs: int('LIMIT_ROOM_CREATE_WINDOW_MS', 10 * minutes),
    } as RateLimitRule,
    failedJoinPerRoomIp: {
      limit: int('LIMIT_JOIN_ROOM_IP', 10),
      windowMs: int('LIMIT_JOIN_ROOM_IP_WINDOW_MS', 10 * minutes),
    } as RateLimitRule,
    failedJoinPerIp: {
      limit: int('LIMIT_JOIN_IP', 50),
      windowMs: int('LIMIT_JOIN_IP_WINDOW_MS', 10 * minutes),
    } as RateLimitRule,
    commandsPerSecond: int('LIMIT_COMMANDS_PER_SECOND', 20),
    commandBurst: int('LIMIT_COMMAND_BURST', 40),
  },
  timings: {
    heartbeatMs: int('HEARTBEAT_MS', 10_000),
    disconnectAfterMs: int('DISCONNECT_AFTER_MS', 30_000),
    hostTransferAfterMs: int('HOST_TRANSFER_AFTER_MS', 60_000),
    admissionTtlMs: int('ADMISSION_TTL_MS', 5 * minutes),
    recoveryTtlMs: int('RECOVERY_TTL_MS', 5 * minutes),
    lobbyIdleMs: int('LOBBY_IDLE_MS', 30 * minutes),
    activeIdleMs: int('ACTIVE_IDLE_MS', 2 * hours),
    absoluteLifetimeMs: int('ABSOLUTE_LIFETIME_MS', 24 * hours),
    expiryWarningMs: int('EXPIRY_WARNING_MS', 5 * minutes),
    purgeExpiredAfterMs: int('PURGE_EXPIRED_AFTER_MS', 5 * minutes),
    sweepIntervalMs: int('SWEEP_INTERVAL_MS', 5_000),
  },
} as const;

export type Config = typeof config;
