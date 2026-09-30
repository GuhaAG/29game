import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from './config';

/** Crockford-style Base32 without the ambiguous letters I, L, O and U. */
const BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function toBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** 128-bit opaque room identifier; no structure a guesser could exploit. */
export function generateRoomId(): string {
  return toBase32(randomBytes(16)).slice(0, 26).toLowerCase();
}

/** 20 Base32 characters (about 100 bits of entropy), grouped for reading aloud. */
export function generateRoomPassword(): string {
  const raw = toBase32(randomBytes(16)).slice(0, 20);
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}`;
}

/** Accepts case-insensitive input with optional grouping hyphens or spaces. */
export function normalizePassword(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed verifier: the stored value alone cannot be replayed against another server. */
export function verifierFor(purpose: string, secret: string, salt = ''): Buffer {
  return createHmac('sha256', config.verifierKey).update(`${purpose} ${salt} ${secret}`).digest();
}

export function verifierMatches(
  purpose: string,
  secret: string,
  stored: Buffer | Uint8Array,
  salt = '',
): boolean {
  const computed = verifierFor(purpose, secret, salt);
  const storedBuffer = Buffer.from(stored);
  if (storedBuffer.length !== computed.length) return false;
  return timingSafeEqual(computed, storedBuffer);
}

/** Human-transcribable one-use seat recovery code carrying 128 bits. */
export function generateRecoveryCode(): string {
  const raw = toBase32(randomBytes(16)).slice(0, 26);
  return `${raw.slice(0, 6)}-${raw.slice(6, 12)}-${raw.slice(12, 18)}-${raw.slice(18, 26)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Uniform index source for the engine's Fisher-Yates shuffle. */
export function secureRandomIndex(exclusiveMax: number): number {
  return randomInt(exclusiveMax);
}
