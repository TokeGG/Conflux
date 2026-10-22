// Which key does what, and changing it. Pure functions over the controller's `Bindings`, so the Esc menu and the tests share them.
import { defaultBindings, type Bindings } from './input.ts';

export type ActionId = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'dodge' | 'utility' | 'interact' | 'cycle' | 'element1' | 'element2' | 'element3';

export const ACTIONS: { id: ActionId; label: string }[] = [
  { id: 'forward', label: 'Move forward' },
  { id: 'back', label: 'Move back' },
  { id: 'left', label: 'Move left' },
  { id: 'right', label: 'Move right' },
  { id: 'jump', label: 'Jump' },
  { id: 'dodge', label: 'Dash' },
  { id: 'utility', label: 'Utility skill' },
  { id: 'interact', label: 'Interact' },
  { id: 'element1', label: 'Element 1' },
  { id: 'element2', label: 'Element 2' },
  { id: 'element3', label: 'Element 3' },
  { id: 'cycle', label: 'Next element' },
];

const KEY = 'conflux.keys';
const ELEMENT = /^element([1-3])$/;

export function keyFor(b: Bindings, action: ActionId): string {
  const m = ELEMENT.exec(action);
  return m ? b.elements[Number(m[1]) - 1] : b[action as Exclude<ActionId, `element${number}`>];
}

function withKey(b: Bindings, action: ActionId, code: string): Bindings {
  const m = ELEMENT.exec(action);
  if (m) {
    const elements = [...b.elements] as Bindings['elements'];
    elements[Number(m[1]) - 1] = code;
    return { ...b, elements };
  }
  return { ...b, [action]: code };
}

/** Binds `code` to `action`. A key another action holds goes to this action's old key, so nothing is left unbound. Escape is refused. */
export function rebind(b: Bindings, action: ActionId, code: string): { bindings: Bindings; error?: string } {
  if (code === 'Escape') return { bindings: b, error: 'Esc opens this menu, so it cannot be bound.' };
  const old = keyFor(b, action);
  const other = ACTIONS.find((a) => a.id !== action && keyFor(b, a.id) === code);
  let out = withKey(b, action, code);
  if (other) out = withKey(out, other.id, old);
  return { bindings: out };
}

export function saveBindings(storage: { setItem(k: string, v: string): void } | null, b: Bindings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(b));
  } catch {
    /* blocked storage: the keys last for this visit */
  }
}

/** The saved keys, or the defaults when nothing usable is saved (missing, corrupt, incomplete, a repeated key, or Escape). */
export function loadBindings(storage: { getItem(k: string): string | null } | null): Bindings {
  const d = defaultBindings();
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Bindings>;
    // a set saved when there were four element keys keeps its first three
    if (Array.isArray(parsed.elements) && (parsed.elements as unknown[]).length === 4) parsed.elements = parsed.elements.slice(0, 3) as Bindings['elements'];
    const b: Bindings = { ...d, ...parsed, elements: Array.isArray(parsed.elements) ? (parsed.elements as Bindings['elements']) : d.elements };
    const keys = ACTIONS.map((a) => keyFor(b, a.id));
    const complete = Object.keys(d).every((k) => k in parsed || k === 'elements') && Array.isArray(parsed.elements) && parsed.elements.length === 3;
    if (!complete || keys.some((k) => typeof k !== 'string' || !k || k === 'Escape') || new Set(keys).size !== keys.length) return d;
    return b;
  } catch {
    return d;
  }
}

/** A key code as a player reads it ("KeyW" is W, "ShiftLeft" is Shift). */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const arrow = /^Arrow(Up|Down|Left|Right)$/.exec(code);
  if (arrow) return arrow[1];
  return code.replace(/(Left|Right)$/, '').replace(/^Control$/, 'Ctrl') || code;
}
