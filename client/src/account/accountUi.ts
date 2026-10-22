// The account chip on the main menu and its sign-in dialog. The dialog talks to AccountSession; a successful sign-in or sign-out reloads
// the page, so the dev panel (decided at boot) matches the account.
import './account.css';
import { chipText, formError } from './logic.ts';
import type { AccountSession } from './session.ts';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

export class AccountChip {
  readonly root: HTMLButtonElement;
  private dialog: HTMLElement | null = null;

  constructor(private session: AccountSession, private serverThere: boolean, private reload: () => void = () => location.reload()) {
    this.root = h('button', { id: 'accountchip', type: 'button' });
    this.root.addEventListener('click', () => (this.session.account ? this.openAccount() : this.openSignIn()));
    this.paint();
    document.body.append(this.root);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (!on) this.close();
  }

  private paint(): void {
    this.root.textContent = chipText(this.session.account, this.serverThere);
    this.root.title = this.session.account ? 'Your account' : this.serverThere ? 'Sign in or create an account' : 'Playing as a guest (no account server here)';
  }

  private close(): void {
    this.dialog?.remove();
    this.dialog = null;
  }

  private shell(title: string, ...body: (Node | string)[]): HTMLElement {
    this.close();
    const close = h('button', { type: 'button', class: 'plain', id: 'acct-close' }, 'Close');
    close.addEventListener('click', () => this.close());
    const box = h('div', { class: 'acct-box' }, h('h2', {}, title), ...body, close);
    this.dialog = h('div', { id: 'acctdialog' }, box);
    document.body.append(this.dialog);
    return box;
  }

  private openAccount(): void {
    const a = this.session.account!;
    const out = h('button', { type: 'button', class: 'plain', id: 'acct-signout' }, 'Sign out');
    out.addEventListener('click', () => void this.session.logout().then(this.reload));
    const rights = a.role === 'owner' ? 'Owner: dev tools and the Admin page.' : a.dev ? 'Dev access: the dev tools.' : 'No special access.';
    this.shell(a.name, h('p', {}, rights), out);
  }

  private openSignIn(): void {
    let mode: 'login' | 'register' = 'login';
    const name = h('input', { id: 'acct-name', autocomplete: 'username', maxlength: '16', placeholder: 'Name' });
    const pass = h('input', { id: 'acct-pass', type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    const code = h('input', { id: 'acct-code', type: 'password', autocomplete: 'off', placeholder: 'Owner code (only for a reserved name)' });
    const msg = h('p', { class: 'acct-msg', id: 'acct-msg' });
    const go = h('button', { type: 'button', class: 'go', id: 'acct-go' });
    const swap = h('button', { type: 'button', class: 'plain', id: 'acct-swap' });
    const sync = (): void => {
      go.textContent = mode === 'login' ? 'Sign in' : 'Create account';
      swap.textContent = mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in';
      code.hidden = mode === 'login';
      pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    };
    swap.addEventListener('click', () => ((mode = mode === 'login' ? 'register' : 'login'), sync()));
    const submit = async (): Promise<void> => {
      const bad = formError(mode, name.value.trim(), pass.value);
      if (bad) return void (msg.textContent = bad);
      msg.textContent = '...';
      const r = mode === 'login' ? await this.session.login(name.value.trim(), pass.value) : await this.session.register(name.value.trim(), pass.value, code.value || undefined);
      if (!r.ok) return void (msg.textContent = r.error);
      this.reload();
    };
    go.addEventListener('click', () => void submit());
    for (const i of [name, pass, code]) i.addEventListener('keydown', (e) => e.key === 'Enter' && void submit());
    // keys typed here must not reach the game
    this.shell(this.serverThere ? 'Account' : 'Guest', h('p', {}, this.serverThere ? 'Sign in to keep your name and, if you are a developer, get the tools.' : 'There is no account server here, so you play as a guest.'), ...(this.serverThere ? [name, pass, code, msg, go, swap] : []));
    this.dialog!.addEventListener('keydown', (e) => e.stopPropagation());
    sync();
    name.focus();
  }
}
