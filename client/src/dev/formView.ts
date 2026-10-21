// Draws form rows (buildForm) as inputs and sends what the person types to the staging area.
import type { DataPatch } from '@conflux/shared';
import { el } from './dom.ts';
import { patchFor, rowIsChanged, type FormGroup, type FormRow } from './form.ts';
import type { DevState } from './devstate.ts';

const show = (v: number | boolean): string => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(Math.round(v * 1e4) / 1e4));

export interface FormViewOptions {
  state: DevState;
  /** Called after any change so the toolbar can update its count. */
  changed(): void;
}

/** One row: label, input, unit, the file's value, and a button that puts this value back. */
function drawRow(row: FormRow, o: FormViewOptions): HTMLElement {
  const staged = o.state.staged.find((p) => p.path === row.path);
  const live = staged ? staged.value : row.value;
  const wrap = el('div', { class: `dev-row${rowIsChanged(row) || staged ? ' dev-changed' : ''}`, 'data-path': row.path });
  const label = el('label', { title: row.path }, row.label);
  const input = el('input', row.boolean ? { type: 'checkbox' } : { type: 'number', step: String(row.step), min: String(row.min), max: String(row.max), value: String(live) });
  if (row.boolean) (input as HTMLInputElement).checked = live === true;
  const unit = el('span', { class: 'dev-unit' }, row.unit);
  const file = el('span', { class: 'dev-file' }, `file: ${show(row.fileValue)}`);
  const msg = el('span', { class: 'dev-rowmsg' }, staged ? 'not tried yet' : '');
  const reset = el('button', { title: 'Put this value back to the file\'s', class: 'dev-reset' }, '↺');
  input.addEventListener('change', () => {
    const raw = row.boolean ? (input as HTMLInputElement).checked : (input as HTMLInputElement).value;
    const patch = patchFor(row, raw);
    if (typeof patch === 'string') {
      msg.textContent = patch;
      return;
    }
    const err = o.state.stage(patch as DataPatch);
    msg.textContent = err ?? 'not tried yet';
    wrap.classList.toggle('dev-changed', !err);
    o.changed();
  });
  reset.addEventListener('click', () => {
    o.state.revertPath(row.path);
    if (row.boolean) (input as HTMLInputElement).checked = row.fileValue === true;
    else (input as HTMLInputElement).value = String(row.fileValue);
    msg.textContent = 'put back';
    wrap.classList.remove('dev-changed');
    o.changed();
  });
  wrap.append(label, input, unit, file, reset, msg);
  return wrap;
}

export function drawGroups(host: HTMLElement, groups: FormGroup[], filter: string, o: FormViewOptions): void {
  host.replaceChildren();
  const f = filter.trim().toLowerCase();
  for (const g of groups) {
    const rows = g.rows.filter((r) => !f || r.label.toLowerCase().includes(f) || r.path.toLowerCase().includes(f));
    if (!rows.length) continue;
    const box = el('div', { class: 'dev-group' });
    box.append(el('h4', {}, g.title));
    for (const r of rows) box.append(drawRow(r, o));
    host.append(box);
  }
  if (!host.childElementCount) host.append(el('div', { class: 'dev-empty' }, 'Nothing matches.'));
}
