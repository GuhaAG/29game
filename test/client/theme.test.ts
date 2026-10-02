import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeTheme, themeToggle } from '../../src/client/theme';
import { setText } from '../../src/client/text';

it('switches themes without replacing form inputs and restores the saved choice', () => {
  const dom = new JSDOM('<input value="Player name">', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
  setText(JSON.parse(readFileSync(join(__dirname, '../../../locales/en.json'), 'utf8')));
  initializeTheme();
  assert.equal(document.documentElement.dataset.theme, 'light');
  const input = document.querySelector('input');
  const toggle = themeToggle();
  document.body.append(toggle);
  assert.equal(toggle.textContent, '');
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to dark mode');
  toggle.click();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(toggle.getAttribute('aria-label'), 'Switch to light mode');
  assert.equal(document.querySelector('input'), input);
  assert.equal(dom.window.localStorage.getItem('29.theme'), 'dark');
  document.documentElement.dataset.theme = 'light';
  initializeTheme();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  const nextToggle = themeToggle();
  assert.equal(nextToggle.getAttribute('aria-label'), 'Switch to light mode');
  nextToggle.click();
  assert.equal(dom.window.localStorage.getItem('29.theme'), 'light');
});

it('still switches themes when browser storage is unavailable', () => {
  const dom = new JSDOM(''); // Opaque origins cannot use localStorage.
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node });
  initializeTheme();
  assert.equal(document.documentElement.dataset.theme, 'light');
  const toggle = themeToggle();
  toggle.click();
  assert.equal(document.documentElement.dataset.theme, 'dark');
});
