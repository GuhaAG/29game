import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger';
import { type TextTree, type TextVars, mergeText, translate } from '../shared/text';

/** Resolves whether the server runs from dist/src/server or from src/server. */
function resolveLocalesDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'locales'),
    join(__dirname, '..', '..', 'locales'),
    join(process.cwd(), 'locales'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'en.json'))) ?? (candidates[0] as string);
}

const LOCALES_DIR = resolveLocalesDir();

export const locale = (process.env.LOCALE ?? '').trim() || 'en';

function readLocale(code: string): { tree: TextTree; stamp: number } | null {
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;
  const file = join(LOCALES_DIR, `${code}.json`);
  try {
    return { tree: JSON.parse(readFileSync(file, 'utf8')) as TextTree, stamp: statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

let cache: { tree: TextTree; stamp: string } | null = null;

function stampOf(code: string): string {
  const parts: string[] = [];
  for (const name of code === 'en' ? ['en'] : ['en', code]) {
    try {
      parts.push(String(statSync(join(LOCALES_DIR, `${name}.json`)).mtimeMs));
    } catch {
      parts.push('x');
    }
  }
  return parts.join('/');
}

/**
 * The current text, with the chosen language laid over English. The file is
 * re-read whenever it changes on disk, so edits show up without a restart.
 */
export function textTree(): TextTree {
  const stamp = stampOf(locale);
  if (cache && cache.stamp === stamp) return cache.tree;
  const english = readLocale('en')?.tree ?? {};
  if (Object.keys(english).length === 0) log.error('locales/en.json is missing or invalid', { dir: LOCALES_DIR });
  const chosen = locale === 'en' ? null : readLocale(locale)?.tree ?? null;
  const tree = chosen ? mergeText(english, chosen) : english;
  cache = { tree, stamp };
  return tree;
}

export function t(key: string, vars?: TextVars): string {
  return translate(textTree(), key, vars);
}
