import { type TextTree, type TextVars, lookupText, translate } from '../shared/text';

let tree: TextTree = {};

/** Fetches the text for the server's configured language before the first render. */
export async function loadText(): Promise<void> {
  try {
    const response = await fetch('/api/text', { credentials: 'same-origin' });
    if (response.ok) {
      const body = (await response.json()) as { locale?: string; strings?: TextTree };
      tree = body.strings ?? {};
      if (body.locale) document.documentElement.lang = body.locale;
    }
  } catch {
    // Without text the app shows its keys, which is still usable.
  }
}

export function setText(next: TextTree): void {
  tree = next;
}

export function t(key: string, vars?: TextVars): string {
  return translate(tree, key, vars);
}

/** The rules drawer is a list of sections, not a single string. */
export function rulesSections(): { heading: string; points: string[] }[] {
  const value = lookupText(tree, 'rules.sections');
  return Array.isArray(value) ? (value as { heading: string; points: string[] }[]) : [];
}
