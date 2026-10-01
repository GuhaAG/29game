/**
 * Text lookup shared by the browser and the server. The words themselves live in
 * locales/<code>.json; this file only knows how to find and fill them in.
 */

export type TextTree = { [key: string]: unknown };

/** Overlays `over` on `base`, so a partial translation falls back to English. */
export function mergeText(base: TextTree, over: TextTree): TextTree {
  const out: TextTree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      current && typeof current === 'object' && !Array.isArray(current)
    ) {
      out[key] = mergeText(current as TextTree, value as TextTree);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function lookupText(tree: TextTree, key: string): unknown {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export type TextVars = Record<string, string | number>;

function fill(template: string, vars: TextVars): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Looks up `key` and fills `{name}` placeholders. A value shaped like
 * { "one": "...", "other": "..." } is chosen by `vars.count`. A missing key
 * shows the key itself, so a gap is obvious rather than blank.
 */
export function translate(tree: TextTree, key: string, vars: TextVars = {}): string {
  let value = lookupText(tree, key);
  if (value && typeof value === 'object' && !Array.isArray(value) && 'other' in value) {
    const forms = value as Record<string, unknown>;
    value = vars.count === 1 && typeof forms.one === 'string' ? forms.one : forms.other;
  }
  if (typeof value !== 'string') return key;
  return fill(value, vars);
}
