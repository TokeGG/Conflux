// The DOM of the Element reactions guide (matrix and list). The words and the filtering live in reactionGuide.ts.
import type { GameData } from '@conflux/shared';
import { elementColour, elementIcon, iconEl } from './icons.ts';
import { filterGuide, guideMatrix, guideRows, heldPairs, type GuideRow } from './reactionGuide.ts';
import './reactionGuide.css';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

/** `held` are the elements the player has equipped in a run (empty from the main menu); their reactions are marked. */
export function buildReactionGuide(data: GameData, held: readonly string[] = []): HTMLElement {
  const order = data.elements.order as string[];
  const rows = guideRows(data);
  const mine = heldPairs(rows, held);
  const matrix = guideMatrix(data);
  let view: 'matrix' | 'list' = 'matrix';
  let element: string | null = null;
  let query = '';
  let selected: GuideRow | null = null;

  const root = h('div', 'rguide');
  const body = h('div', 'rg-body');
  const detail = h('div', 'rg-detail');
  const tint = <T extends HTMLElement>(e: T, a: string, b = a): T => (e.style.setProperty('--ca', elementColour(a)), e.style.setProperty('--cb', elementColour(b)), e);

  const showDetail = (r: GuideRow | null): void => {
    detail.replaceChildren();
    if (!r) return void detail.append(h('span', 'pair', 'Hover or click a reaction to read it.'));
    const heldNote = mine.has(r.id) ? ' You hold both.' : '';
    detail.append(h('b', '', r.name), h('span', 'pair', `${cap(r.a)} + ${cap(r.b)}, either order.${heldNote}`), h('div', '', r.text));
  };

  const pairIcons = (r: GuideRow) => h('span', 'pairs', iconEl(elementIcon(r.a), elementColour(r.a)), '+', iconEl(elementIcon(r.b), elementColour(r.b)));

  const draw = (): void => {
    root.querySelectorAll('.rg-tab').forEach((t) => t.classList.toggle('on', (t as HTMLElement).dataset.view === view));
    root.querySelectorAll('.rg-chip').forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.el === (element ?? '')));
    body.replaceChildren();
    if (view === 'matrix') {
      const table = h('table', 'rg-grid');
      const head = h('tr', '', h('th'));
      for (const e of order) {
        const b = h('button', '', iconEl(elementIcon(e)), e);
        b.type = 'button';
        b.style.setProperty('--ec', elementColour(e));
        b.title = `Show every ${e} reaction`;
        b.addEventListener('click', () => ((view = 'list'), (element = e), draw()));
        head.append(h('th', '', b));
      }
      table.append(head);
      order.forEach((ra, i) => {
        const tr = h('tr');
        const lb = h('button', '', iconEl(elementIcon(ra)), ra);
        lb.type = 'button';
        lb.style.setProperty('--ec', elementColour(ra));
        lb.title = `Show every ${ra} reaction`;
        lb.addEventListener('click', () => ((view = 'list'), (element = ra), draw()));
        tr.append(h('th', '', lb));
        order.forEach((_, j) => {
          const r = matrix[i][j];
          if (!r) return void tr.append(h('td', 'diag'));
          const b = tint(h('button', `${mine.has(r.id) ? 'held' : ''}${selected === r ? ' sel' : ''}`, r.name), order[i], order[j]);
          b.type = 'button';
          b.title = `${r.name}: ${cap(r.a)} + ${cap(r.b)}`;
          b.addEventListener('mouseenter', () => showDetail(r));
          b.addEventListener('focus', () => showDetail(r));
          b.addEventListener('click', () => ((selected = r), draw(), showDetail(r)));
          tr.append(h('td', '', b));
        });
        table.append(tr);
      });
      body.append(h('div', 'rg-scroll', table), detail);
      showDetail(selected);
    } else {
      const found = filterGuide(rows, { element, query });
      const list = h('div', 'rg-list');
      for (const r of found) {
        const partner = element ? r.partner(element) : null;
        const sub = partner ? `with ${cap(partner)}` : `${cap(r.a)} + ${cap(r.b)}`;
        const item = tint(h('div', `rg-item${mine.has(r.id) ? ' held' : ''}`, pairIcons(r), h('div', 'nm', r.name, h('small', '', sub)), h('div', 'tx', r.text)), partner ?? r.a);
        list.append(item);
      }
      if (!found.length) list.append(h('div', 'rg-empty', 'No reaction matches that.'));
      body.append(list);
    }
  };

  const tab = (v: 'matrix' | 'list', label: string) => {
    const b = h('button', 'rg-tab', label);
    b.type = 'button';
    b.dataset.view = v;
    b.addEventListener('click', () => ((view = v), draw()));
    return b;
  };
  const search = h('input', 'rg-search');
  search.type = 'search';
  search.placeholder = 'Search reactions';
  search.setAttribute('aria-label', 'Search reactions');
  search.addEventListener('input', () => {
    query = search.value;
    if (query && view === 'matrix') view = 'list';
    draw();
  });
  // keys must not reach the game while typing
  search.addEventListener('keydown', (e) => e.stopPropagation());
  const chips = h('div', 'rg-bar');
  const chip = (e: string | null) => {
    const b = h('button', 'rg-chip', ...(e ? [iconEl(elementIcon(e)), cap(e)] : ['All']));
    b.type = 'button';
    b.dataset.el = e ?? '';
    b.style.setProperty('--ec', e ? elementColour(e) : 'var(--ember)');
    b.addEventListener('click', () => {
      element = e;
      if (e && view === 'matrix') view = 'list';
      draw();
    });
    return b;
  };
  chips.append(chip(null), ...order.map(chip));

  root.append(h('div', 'rg-bar', tab('matrix', 'Matrix'), tab('list', 'List'), search), chips);
  if (held.length) root.append(h('p', 'rg-note', `You hold ${held.map(cap).join(', ')}. Reactions you can make now are outlined in green.`));
  root.append(body);
  draw();
  return root;
}
