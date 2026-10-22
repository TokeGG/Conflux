// What to show an account. Pure, so it is tested without a page. The server still checks every action.
import type { AccountInfo } from './session.ts';

/**
 * Whether the dev panel exists. Only an account with dev (or the owner) gets it in a production build; local development
 * (`import.meta.env.DEV`) keeps the old `?dev` shortcut.
 */
export function devPanelAllowed(account: AccountInfo | null, localDev: boolean, shortcut: boolean): boolean {
  return !!account?.dev || (localDev && shortcut);
}

/** The Admin page (accounts, grants, log) is the owner's. */
export function adminPageAllowed(account: AccountInfo | null): boolean {
  return account?.role === 'owner';
}

/** The text on the account chip. */
export function chipText(account: AccountInfo | null, serverThere: boolean): string {
  if (account) return account.role === 'owner' ? `${account.name} (owner)` : account.dev ? `${account.name} (dev)` : account.name;
  return serverThere ? 'Sign in' : 'Guest';
}

/** Checks a sign-in form before it is sent. Null when fine. */
export function formError(mode: 'login' | 'register', name: string, password: string): string | null {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return 'Names are 3-16 letters, numbers or underscores.';
  if (mode === 'register' && (password.length < 8 || password.length > 128)) return 'Passwords are 8-128 characters.';
  if (!password) return 'Enter your password.';
  return null;
}
