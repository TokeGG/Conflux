// The player's graphics settings, saved in the browser. Anything unreadable falls back to the profile's defaults.
import { CHUNKY, clampScale, type RenderProfile } from './renderer/profile.ts';

export interface Settings {
  renderScale: number;
  antialias: boolean;
  shadows: boolean;
  effects: { sprites: boolean; particles: boolean; shaders: boolean };
  /** 0 means no limit. */
  maxEnemies: number;
}

const KEY = 'conflux.settings';

export const defaultSettings = (): Settings => ({ renderScale: CHUNKY.renderScale, antialias: CHUNKY.antialias, shadows: CHUNKY.shadows, effects: { ...CHUNKY.effects }, maxEnemies: 0 });

const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function loadSettings(storage: { getItem(k: string): string | null } | null): Settings {
  const d = defaultSettings();
  let raw: Record<string, any> | null = null;
  try {
    const text = storage?.getItem(KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== 'object') return d;
  const fx = raw.effects && typeof raw.effects === 'object' ? raw.effects : {};
  return {
    renderScale: typeof raw.renderScale === 'number' ? clampScale(raw.renderScale) : d.renderScale,
    antialias: bool(raw.antialias, d.antialias),
    shadows: bool(raw.shadows, d.shadows),
    effects: { sprites: bool(fx.sprites, d.effects.sprites), particles: bool(fx.particles, d.effects.particles), shaders: bool(fx.shaders, d.effects.shaders) },
    maxEnemies: Number.isInteger(raw.maxEnemies) && raw.maxEnemies >= 0 ? raw.maxEnemies : 0,
  };
}

export function saveSettings(storage: { setItem(k: string, v: string): void } | null, s: Settings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* blocked storage: the settings simply last for this visit */
  }
}

/** The chunky profile with the player's settings on top. */
export function profileFromSettings(s: Settings): RenderProfile {
  return { ...CHUNKY, renderScale: s.renderScale, antialias: s.antialias, shadows: s.shadows, effects: { ...s.effects } };
}

/** localStorage, or null when the browser blocks it. */
export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
