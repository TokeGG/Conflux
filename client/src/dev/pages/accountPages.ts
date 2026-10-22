// Two dev panel pages that need the account server: Tuning (publish your kept edits so every player's game uses them) and
// Admin (owner only: accounts, grants, log).
import type { DataLayers } from '@conflux/shared';
import type { AccountSession } from '../../account/session.ts';
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';

const say = (host: HTMLElement, text: string): void => {
  host.querySelector('.acct-say')!.textContent = text;
};

/** Tuning for everyone: the server layer, and a button that publishes your own kept or tried edits into it. */
export class TuningPage implements DevPage {
  readonly id = 'tuning';
  readonly title = 'Tuning';
  constructor(private session: AccountSession, private layers: DataLayers, private refresh: () => void, private sendData: () => void) {}

  render(host: HTMLElement): void {
    host.replaceChildren();
    const sec = el('div', { class: 'dev-section' });
    sec.append(el('h4', {}, 'Tuning for everyone'));
    sec.append(el('p', {}, `Published now: ${this.layers.serverPatches().length} edit(s). Every player's game applies them at load, and runs on tuned numbers never count toward unlocks.`));
    sec.append(el('p', { class: 'acct-say' }, ''));
    const publish = el('button', { id: 'tuning-publish' }, 'Publish my edits to everyone');
    publish.addEventListener('click', async () => {
      const merged = new Map(this.layers.serverPatches().map((p) => [p.path, p]));
      for (const p of this.layers.patches()) merged.set(p.path, p);
      const r = await this.session.saveTuning([...merged.values()]);
      if (!r.ok) return say(host, r.error);
      this.layers.setServer(r.value.patches);
      this.refresh();
      this.sendData();
      say(host, `Published ${r.value.patches.length} edit(s).`);
      this.render(host);
    });
    const clear = el('button', { id: 'tuning-clear' }, 'Remove all published tuning');
    clear.addEventListener('click', async () => {
      const r = await this.session.saveTuning([]);
      if (!r.ok) return say(host, r.error);
      this.layers.setServer([]);
      this.refresh();
      this.sendData();
      this.render(host);
      say(host, 'Removed.');
    });
    sec.append(publish, ' ', clear);
    const list = el('div', {});
    for (const p of this.layers.serverPatches()) list.append(el('div', {}, `${p.path} = ${String(p.value)}`));
    sec.append(list);
    host.append(sec);
  }
}

interface Row {
  name: string;
  role: string;
  grants: string[];
}

/** Owner only: every account with a dev switch, and the log. */
export class AdminPage implements DevPage {
  readonly id = 'admin';
  readonly title = 'Admin';
  constructor(private session: AccountSession) {}

  render(host: HTMLElement): void {
    host.replaceChildren();
    const sec = el('div', { class: 'dev-section' });
    sec.append(el('h4', {}, 'Accounts'), el('p', { class: 'acct-say' }, 'Loading...'));
    const table = el('div', { id: 'admin-accounts' });
    const log = el('div', { id: 'admin-log' });
    sec.append(table, el('h4', {}, 'Log'), log);
    host.append(sec);
    void this.load(host, table, log);
  }

  private async load(host: HTMLElement, table: HTMLElement, log: HTMLElement): Promise<void> {
    const [a, l] = await Promise.all([this.session.call<{ accounts: Row[] }>('GET', 'admin/accounts'), this.session.call<{ log: { at: number; text: string }[] }>('GET', 'admin/log')]);
    if (!a.ok) return say(host, a.error);
    say(host, `${a.value.accounts.length} account(s).`);
    table.replaceChildren(
      ...a.value.accounts.map((acc) => {
        const row = el('div', { class: 'dev-row' });
        row.append(el('span', { class: 'dev-label' }, `${acc.name}${acc.role === 'owner' ? ' (owner)' : ''}`));
        if (acc.role !== 'owner') {
          const has = acc.grants.includes('dev');
          const b = el('button', { class: 'admin-dev', 'data-name': acc.name }, has ? 'Revoke dev' : 'Grant dev');
          b.addEventListener('click', async () => {
            const r = await this.session.call('POST', 'admin/grant', { name: acc.name, grant: 'dev', on: !has });
            if (!r.ok) return say(host, r.error);
            this.render(host);
          });
          row.append(b);
        }
        return row;
      }),
    );
    log.replaceChildren(...(l.ok ? l.value.log.slice(0, 100).map((e) => el('div', {}, `${new Date(e.at).toLocaleString()}  ${e.text}`)) : []));
  }
}
