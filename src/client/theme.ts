import { h } from './dom';
import { t } from './text';

const storageKey = '29.theme';

export function initializeTheme(): void {
  let theme = 'light';
  try {
    if (window.localStorage.getItem(storageKey) === 'dark') theme = 'dark';
  } catch {
    // Theme switching still works when browser storage is unavailable.
  }
  document.documentElement.dataset.theme = theme;
}

export function themeToggle(): HTMLButtonElement {
  const button = h('button', {
    class: 'theme-toggle', type: 'button', 'data-focus': 'theme-toggle',
    onClick: () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      try {
        window.localStorage.setItem(storageKey, theme);
      } catch {
        // Keep the chosen theme for this page even if it cannot be saved.
      }
      updateLabel();
    },
  });
  // Fixed decorative SVGs; no player or translated content is parsed as HTML.
  button.innerHTML = '<svg class="sun-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg class="moon-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg>';
  function updateLabel(): void {
    const label = t(document.documentElement.dataset.theme === 'dark' ? 'header.lightMode' : 'header.darkMode');
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  updateLabel();
  return button;
}
