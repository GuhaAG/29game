type Child = Node | string | number | null | undefined | false;

export interface Props {
  [key: string]: unknown;
  class?: string;
  onClick?: (event: MouseEvent) => void;
  onSubmit?: (event: SubmitEvent) => void;
  onInput?: (event: Event) => void;
}

/** Minimal element helper: attributes are set literally, text is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      element.className = String(value);
    } else if (key === 'onClick') {
      element.addEventListener('click', value as EventListener);
    } else if (key === 'onSubmit') {
      element.addEventListener('submit', value as EventListener);
    } else if (key === 'onInput') {
      element.addEventListener('input', value as EventListener);
    } else if (key === 'onChange') {
      element.addEventListener('change', value as EventListener);
    } else if (key === 'value') {
      (element as HTMLInputElement).value = String(value);
    } else if (key === 'disabled') {
      if (value) element.setAttribute('disabled', 'disabled');
    } else if (value === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function fragment(...children: Child[]): DocumentFragment {
  const container = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    container.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return container;
}

/** Re-renders the app shell while keeping keyboard focus where the player left it. */
export function mount(root: HTMLElement, next: HTMLElement): void {
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset?.focus ?? null;
  const selectionStart = active instanceof HTMLInputElement ? active.selectionStart : null;
  root.replaceChildren(next);
  if (focusKey) {
    const restored = root.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (restored instanceof HTMLInputElement && selectionStart !== null) {
        try {
          restored.setSelectionRange(selectionStart, selectionStart);
        } catch {
          // non-text input
        }
      }
    }
  }
}

export function announce(message: string): void {
  const node = document.getElementById('announcer');
  if (node) node.textContent = message;
}

export function alertNow(message: string): void {
  const node = document.getElementById('alerts');
  if (node) node.textContent = message;
}
