import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { mergeText, translate, type TextTree } from '../../src/shared/text';

const dir = join(__dirname, '..', '..', '..', 'locales');

function keysOf(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (Array.isArray(node)) return [prefix];
  if (node && typeof node === 'object') {
    const forms = node as Record<string, unknown>;
    if ('other' in forms) return [prefix];
    return Object.entries(forms).flatMap(([key, value]) => keysOf(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

describe('text lookup', () => {
  const tree: TextTree = { a: { b: 'Hello {name}' }, n: { one: '{count} card', other: '{count} cards' } };

  it('fills placeholders and leaves unknown ones visible', () => {
    assert.equal(translate(tree, 'a.b', { name: 'Ann' }), 'Hello Ann');
    assert.equal(translate(tree, 'a.b'), 'Hello {name}');
  });

  it('picks the plural form from count', () => {
    assert.equal(translate(tree, 'n', { count: 1 }), '1 card');
    assert.equal(translate(tree, 'n', { count: 3 }), '3 cards');
  });

  it('shows the key when text is missing, and merges partial translations', () => {
    assert.equal(translate(tree, 'nope.key'), 'nope.key');
    assert.equal(translate(mergeText(tree, { a: { b: 'Salut {name}' } }), 'a.b', { name: 'Ann' }), 'Salut Ann');
    assert.equal(translate(mergeText(tree, { a: { b: 'Salut' } }), 'n', { count: 2 }), '2 cards');
  });
});

describe('locale files', () => {
  const english = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as TextTree;

  it('every locale is valid JSON and only uses keys that English defines', () => {
    const known = new Set(keysOf(english));
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')) as TextTree;
      for (const key of keysOf(parsed)) assert.ok(known.has(key), `${file}: unknown key ${key}`);
    }
  });
});
