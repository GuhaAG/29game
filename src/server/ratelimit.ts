import { config, type RateLimitRule } from './config';
import { AppError } from './errors';
import { t } from './text';

interface Window {
  start: number;
  count: number;
}

/** Fixed-window counters, held in this process alongside the rooms. */
const windows = new Map<string, Window>();

export interface LimitOutcome {
  allowed: boolean;
  retryAfterMs: number;
}

export function hit(bucket: string, rule: RateLimitRule): LimitOutcome {
  const now = Date.now();
  const existing = windows.get(bucket);
  const window =
    existing && now - existing.start < rule.windowMs ? existing : { start: now, count: 0 };
  window.count += 1;
  windows.set(bucket, window);
  return {
    allowed: window.count <= rule.limit,
    retryAfterMs: Math.max(1_000, rule.windowMs - (now - window.start)),
  };
}

export async function enforce(bucket: string, rule: RateLimitRule): Promise<void> {
  const outcome = hit(bucket, rule);
  if (!outcome.allowed) {
    throw new AppError(
      'RATE_LIMITED',
      t('server.tooManyAttempts'),
      outcome.retryAfterMs,
    );
  }
}

/** Reads a bucket without consuming from it, for limits that count only failures. */
export async function checkOnly(bucket: string, rule: RateLimitRule): Promise<void> {
  const window = windows.get(bucket);
  if (!window) return;
  const elapsed = Date.now() - window.start;
  if (elapsed >= rule.windowMs) return;
  if (window.count >= rule.limit) {
    throw new AppError(
      'RATE_LIMITED',
      t('server.tooManyAttempts'),
      Math.max(1_000, rule.windowMs - elapsed),
    );
  }
}

export async function recordFailure(bucket: string, rule: RateLimitRule): Promise<void> {
  hit(bucket, rule);
}

export function purgeStaleBuckets(): void {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [bucket, window] of windows) {
    if (window.start < cutoff) windows.delete(bucket);
  }
}

export function clearAllBuckets(): void {
  windows.clear();
}

/**
 * Per-connection token bucket for gameplay commands. A socket lives in one
 * process, so this needs no shared state.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly perSecond = config.limits.commandsPerSecond,
    private readonly burst = config.limits.commandBurst,
  ) {
    this.tokens = burst;
  }

  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
