// Tiny DOM builder for the dev panel.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}
