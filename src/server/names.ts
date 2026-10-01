import { t } from './text';

/** Screen-name rules from SPEC.md section 3: 1-24 visible characters, no control
 *  or bidirectional-override characters, unique per room case-insensitively. */

const FORBIDDEN =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/u;

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

export const MAX_NAME_LENGTH = 24;

export function visibleLength(value: string): number {
  if (segmenter) return [...segmenter.segment(value)].length;
  return [...value].length;
}

export interface NameCheck {
  ok: boolean;
  name: string;
  key: string;
  reason?: string;
}

/** Normalizes and validates a screen name, returning the comparison key too. */
export function checkDisplayName(input: unknown): NameCheck {
  if (typeof input !== 'string') {
    return { ok: false, name: '', key: '', reason: t('server.nameEmpty') };
  }
  const name = input.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (name.length === 0) {
    return { ok: false, name, key: '', reason: t('server.nameEmpty') };
  }
  if (FORBIDDEN.test(name)) {
    return { ok: false, name, key: '', reason: t('server.nameBadChars') };
  }
  const length = visibleLength(name);
  if (length > MAX_NAME_LENGTH) {
    return { ok: false, name, key: '', reason: t('server.nameTooLong', { max: MAX_NAME_LENGTH }) };
  }
  return { ok: true, name, key: name.normalize('NFKC').toLowerCase() };
}
