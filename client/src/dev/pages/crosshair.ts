import type { CrosshairCfg } from '../../crosshair.ts';
import { buildCrosshairEditor } from '../../crosshairEditor.ts';
import { el } from '../dom.ts';
import type { DevPage } from '../page.ts';

/** The crosshair editor: every change is drawn on the HUD at once and remembered in this browser. The controls are shared with the Esc menu. */
export class CrosshairPage implements DevPage {
  readonly id = 'crosshair';
  readonly title = 'Crosshair';

  constructor(
    private get: () => CrosshairCfg,
    private set: (c: CrosshairCfg) => void,
  ) {}

  render(host: HTMLElement): void {
    host.replaceChildren();
    const section = el('div', { class: 'dev-section' });
    section.append(el('h4', {}, 'Crosshair'));
    const body = el('div');
    section.append(body);
    host.append(section);
    buildCrosshairEditor(body, this.get, this.set);
  }
}
