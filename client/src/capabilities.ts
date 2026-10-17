// What the browser can do, and a readable message when it cannot run the game.
export interface Capabilities {
  webgl2: boolean;
  workers: boolean;
  indexedDb: boolean;
}

export interface Probe {
  webgl2(): boolean;
  workers(): boolean;
  indexedDb(): boolean;
}

const browserProbe: Probe = {
  webgl2() {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  },
  workers: () => typeof Worker !== 'undefined',
  indexedDb: () => typeof indexedDB !== 'undefined' && indexedDB !== null,
};

const safe = (f: () => boolean): boolean => {
  try {
    return !!f();
  } catch {
    return false;
  }
};

export function detectCapabilities(probe: Probe = browserProbe): Capabilities {
  return { webgl2: safe(probe.webgl2), workers: safe(probe.workers), indexedDb: safe(probe.indexedDb) };
}

/** The message for a missing capability that stops the game, or null. Missing storage only disables uploads and saves. */
export function fatalMessage(c: Capabilities): string | null {
  const problems: string[] = [];
  if (!c.webgl2) problems.push('WebGL 2 is not available. Try a recent Chrome, Edge or Firefox, and make sure hardware acceleration is turned on.');
  if (!c.workers) problems.push('Web Workers are not available, and the game needs them to run its simulation.');
  return problems.length ? `Conflux cannot start here. ${problems.join(' ')}` : null;
}

export function showFatal(message: string): void {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.id = 'fatal';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'font: 18px/1.5 system-ui, sans-serif; color: #f3e9d2; background: #1a1410; margin: 0; padding: 48px; height: 100vh; box-sizing: border-box;';
  box.textContent = message;
  document.body.append(box);
}
