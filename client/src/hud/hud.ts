// The heads-up display: a crosshair, the held element and its three skills with cooldowns, health, and above each enemy its
// health and a ring icon per status. Plain HTML over the canvas; the game reads nothing back from it.
import * as THREE from 'three';
import { crosshairSvg, defaultCrosshair, type CrosshairCfg } from '../crosshair.ts';
import { ELEMENTS, MARK_IDS, STATUS_IDS, type GameData, type MarkId, type Snapshot, type Vec3 } from '@conflux/shared';
import { formatCooldown, skillLabel, statusRing } from './format.ts';
import { MARK_ICONS, STATUS_ICONS, type Icon } from './statusIcons.ts';
import { elementColour, elementIcon, iconEl, roomIcon, shapeIcon, statusArt } from './icons.ts';
import './theme.css';
import './hud.css';

const KEYS = ['LMB', 'RMB', 'Q'];
const NUMBER_LIFE = 0.9;

const div = (cls: string, text = ''): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
};

interface Tag {
  root: HTMLDivElement;
  fill: HTMLElement;
  icons: HTMLDivElement;
  ai: HTMLDivElement;
  shown: string;
  markTotals: Partial<Record<MarkId, number>>;
}

export class Hud {
  readonly root: HTMLDivElement;
  private crosshair = div('crosshair');
  private crosshairCfg: CrosshairCfg = defaultCrosshair();
  private crosshairHot: boolean | null = null;
  private gateLabels: { el: HTMLElement; pos: Vec3 }[] = [];
  private stallLabels: { el: HTMLElement; pos: Vec3; near: HTMLElement; ware: HTMLElement }[] = [];
  private prompt = div('prompt');
  private toast = div('toast');
  private elementChips: HTMLDivElement[] = [];
  private slotBoxes: { box: HTMLDivElement; name: HTMLElement; cd: HTMLElement; text: HTMLElement; key: HTMLElement; icon: HTMLElement }[] = [];
  private bonus = div('bonus', 'Swap bonus: +25% and a sure status');
  private pstat = div('pstat');
  private pstatKey = '';
  private runInfo = div('runinfo');
  private soulsChip = div('chip souls');
  private soulsText = div('v', '0');
  private depthChip = div('chip depth');
  private depthText = div('v', '1');
  private bossBar = div('bossbar');
  private bossName = div('bn');
  private bossFill = div('bf');
  private hpFill = div('fill');
  private hpText = div('txt');
  private tags = new Map<number, Tag>();
  private numbers: { el: HTMLElement; pos: Vec3; born: number }[] = [];
  private clock = 0;
  /** How many damage numbers have been shown in all (test hook). */
  damageShown = 0;
  private camera: THREE.Camera | null = null;
  private v = new THREE.Vector3();

  constructor(
    private data: () => GameData,
    parent: HTMLElement = document.body,
  ) {
    this.root = div('');
    this.root.id = 'hud';
    const bottom = div('bottom');
    const elements = div('elements');
    // three keys; the element on each is filled in from the snapshot, since rewards change it
    for (let i = 0; i < 3; i++) {
      const chip = div('element');
      const eico = div('eico');
      chip.append(div('k', String(i + 1)), eico, div('name', ''));
      this.elementChips.push(chip);
      elements.append(chip);
    }
    const slots = div('slots');
    for (let i = 0; i < 3; i++) {
      const box = div('slot');
      const key = div('key', KEYS[i]);
      const name = div('name');
      const cd = div('cd');
      const text = div('cdtext');
      const icon = div('sico');
      box.append(icon, key, name, cd, text);
      slots.append(box);
      this.slotBoxes.push({ box, name, cd, text, key, icon });
    }
    bottom.append(this.bonus, elements, slots);
    const hp = div('hp');
    hp.append(this.hpFill, this.hpText);
    const frame = div('frame');
    frame.append(this.pstat, hp);
    // the run's readouts (souls banked, depth reached): hidden until the run sets them
    this.runInfo.append(this.soulsChip, this.depthChip);
    this.soulsChip.append(iconEl(roomIcon('souls')), this.soulsText);
    this.depthChip.append(iconEl(roomIcon('depth')), this.depthText);
    this.bossBar.append(this.bossName, this.bossFill);
    this.root.append(this.crosshair, bottom, frame, this.runInfo, this.bossBar, this.prompt, this.toast);
    parent.append(this.root);
  }

  /** A number that floats up from where a hit landed; a weakness hit is bigger and warmer. */
  addDamage(pos: Vec3, amount: number, weak = false): void {
    if (amount < 0.05) return;
    const el = div(weak ? 'dmg weak' : 'dmg', String(Math.round(amount * 10) / 10).replace(/\.0$/, ''));
    this.root.append(el);
    this.numbers.push({ el, pos: { x: pos.x + (Math.random() - 0.5) * 0.4, y: pos.y, z: pos.z }, born: this.clock });
    this.damageShown++;
  }

  /** The camera the enemy tags are projected through. */
  /** Hangs a label above each open gate (an empty list takes them down). */
  setGates(gates: { pos: Vec3; title: string; sub: string; kind: string }[]): void {
    this.gateLabels.forEach((g) => g.el.remove());
    this.gateLabels = gates.map((g) => {
      const root = div(`gate ${g.kind}`);
      const text = div('gtext');
      text.append(div('t', g.title), div('s', g.sub));
      root.append(iconEl(roomIcon(g.kind)), text);
      this.root.append(root);
      return { el: root, pos: g.pos };
    });
  }

  /** The souls in hand and where the run stands (depth, and the room's place on its floor). */
  setRun(souls: number, depth: number, room: number, rooms: number): void {
    this.soulsChip.classList.add('on');
    this.depthChip.classList.add('on');
    this.soulsText.textContent = String(souls);
    this.depthText.textContent = `Depth ${depth} \u00b7 room ${room}/${rooms}`;
  }

  /** A line of words that fades (arriving on a new floor). */
  announce(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  /** Labels over the wares of a quiet room (an empty list takes them down). */
  setStalls(stalls: { pos: Vec3; title: string; price: string; state: 'ok' | 'poor' | 'sold' }[]): void {
    this.stallLabels.forEach((s) => s.el.remove());
    this.stallLabels = stalls.map((s) => {
      const root = div(`stall ${s.state}`);
      const near = div('near');
      const ware = div('t', s.title);
      root.append(ware, div('p', s.state === 'sold' ? 'Taken' : s.price), near);
      this.root.append(root);
      return { el: root, pos: s.pos, near, ware };
    });
  }

  /** Marks the stall the player stands at (index) with the words to show; -1 for none. Also sets the bottom prompt. */
  setNearStall(index: number, detail: string, prompt: string): void {
    this.stallLabels.forEach((s, i) => {
      s.el.classList.toggle('here', i === index);
      s.near.textContent = i === index ? detail : '';
    });
    this.prompt.textContent = index >= 0 ? prompt : '';
    this.prompt.classList.toggle('on', index >= 0 && prompt !== '');
  }

  /** The run's readouts: souls banked and the depth reached. A field left out stays hidden. */
  setRunInfo(info: { souls?: number; depth?: number }): void {
    this.soulsChip.classList.toggle('on', info.souls !== undefined);
    this.depthChip.classList.toggle('on', info.depth !== undefined);
    if (info.souls !== undefined) this.soulsText.textContent = String(info.souls);
    if (info.depth !== undefined) this.depthText.textContent = String(info.depth);
  }

  /** Changes how the crosshair looks (from the dev panel or the saved setting). */
  setCrosshair(cfg: CrosshairCfg): void {
    this.crosshairCfg = cfg;
    this.crosshairHot = null;
    this.drawCrosshair(false);
  }

  private drawCrosshair(hot: boolean): void {
    if (hot === this.crosshairHot) return;
    this.crosshairHot = hot;
    this.crosshair.classList.toggle('hot', hot);
    const c = this.crosshairCfg;
    this.crosshair.style.width = this.crosshair.style.height = `${c.size}px`;
    this.crosshair.style.margin = `${-c.size / 2}px 0 0 ${-c.size / 2}px`;
    this.crosshair.innerHTML = crosshairSvg(c, hot);
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  update(s: Snapshot, aimTarget: number | null, showAi = false): void {
    const p = s.players[0];
    if (!p) return;
    const colour = elementColour(p.element);
    this.elementChips.forEach((chip, i) => {
      const el = p.equipped[i];
      chip.style.setProperty('--c', el ? elementColour(el) : '#555');
      const eico = chip.children[1] as HTMLElement;
      if (eico.dataset.el !== (el ?? '')) {
        eico.dataset.el = el ?? '';
        eico.innerHTML = el ? elementIcon(el) : '';
      }
      (chip.lastElementChild as HTMLElement).textContent = el ? el[0].toUpperCase() + el.slice(1) : '—';
      chip.classList.toggle('on', el === p.element);
    });
    p.slots.forEach((slot, i) => {
      const b = this.slotBoxes[i];
      b.box.style.setProperty('--c', colour);
      b.name.textContent = slot.skillId ? skillLabel(slot.skillId) : '—';
      if (b.icon.dataset.id !== slot.skillId) {
        b.icon.dataset.id = slot.skillId;
        b.icon.innerHTML = shapeIcon(this.data().skills[slot.skillId]?.shape.type);
      }
      b.box.classList.toggle('ready', slot.remaining <= 0);
      b.cd.style.setProperty('--p', String(slot.total > 0 ? Math.min(1, slot.remaining / slot.total) : 0));
      b.text.textContent = formatCooldown(slot.remaining);
    });
    this.bonus.classList.toggle('on', p.bonusRemaining > 0);
    this.drawPlayerStatuses(p.statuses);
    this.drawBoss(s);
    this.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.drawCrosshair(aimTarget !== null);
    for (const g of this.gateLabels) this.place(g.el, g.pos.x, g.pos.y + 3.2, g.pos.z);
    for (const g of this.stallLabels) this.place(g.el, g.pos.x, g.pos.y + 1.9, g.pos.z);
    this.updateTags(s, aimTarget, showAi);
    this.updateNumbers();
  }

  /** One icon per status on the player, each with its ring. */
  private drawPlayerStatuses(list: Snapshot['players'][number]['statuses']): void {
    const key = list.map((x) => x.id).join(',');
    if (key !== this.pstatKey) {
      this.pstatKey = key;
      this.pstat.replaceChildren(...list.map((x) => this.icon(x.id, (STATUS_ICONS[x.id] ?? { color: '#bbb' }).color)));
    }
    list.forEach((x, i) => (this.pstat.children[i] as HTMLElement).style.setProperty('--p', String(statusRing(x.remaining, this.data().statuses[x.id]?.duration ?? 0))));
  }

  /** The bar across the top while a boss lives. */
  private drawBoss(s: Snapshot): void {
    const boss = s.enemies.find((e) => e.defId.startsWith('boss.'));
    this.bossBar.classList.toggle('on', !!boss);
    if (!boss) return;
    this.bossName.textContent = this.data().enemies[boss.defId]?.name ?? boss.defId;
    this.bossFill.style.setProperty('--w', `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`);
  }

  /** Floats the numbers up and removes them after a moment. */
  private updateNumbers(): void {
    this.clock += 1 / 60;
    this.numbers = this.numbers.filter((n) => {
      const age = this.clock - n.born;
      if (age > NUMBER_LIFE) {
        n.el.remove();
        return false;
      }
      this.place(n.el, n.pos.x, n.pos.y + age * 1.2, n.pos.z);
      n.el.style.opacity = String(1 - age / NUMBER_LIFE);
      return true;
    });
  }

  private updateTags(s: Snapshot, aimTarget: number | null, showAi: boolean): void {
    const seen = new Set<number>();
    for (const e of s.enemies) {
      seen.add(e.id);
      let tag = this.tags.get(e.id);
      if (!tag) {
        const root = div('tag');
        const bar = div('bar');
        const fill = document.createElement('i');
        bar.append(fill);
        const icons = div('icons');
        const ai = div('ai');
        root.append(ai, icons, bar);
        this.root.append(root);
        tag = { root, fill, icons, ai, shown: '', markTotals: {} };
        this.tags.set(e.id, tag);
      }
      tag.fill.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
      tag.root.classList.toggle('hot', e.id === aimTarget);
      tag.ai.textContent = showAi ? e.aiState : '';
      this.rebuildIcons(tag, e);
      this.place(tag.root, e.pos.x, e.pos.y + this.topOf(e.defId), e.pos.z);
    }
    for (const [id, tag] of this.tags) {
      if (seen.has(id)) continue;
      tag.root.remove();
      this.tags.delete(id);
    }
  }

  /** One ring icon per status, then per mark, each filling by the share of its time left. */
  private rebuildIcons(tag: Tag, e: Snapshot['enemies'][number]): void {
    const rows: { id: string; icon: Icon; ring: number }[] = [];
    for (const id of STATUS_IDS) {
      const st = e.statuses.find((x) => x.id === id);
      if (st) rows.push({ id, icon: STATUS_ICONS[id] ?? { glyph: id, color: '#bbb' }, ring: statusRing(st.remaining, this.data().statuses[id].duration) });
    }
    for (const id of MARK_IDS) {
      const m = e.marks.find((x) => x.id === id);
      if (!m) continue;
      const total = Math.max(tag.markTotals[id] ?? 0, m.remaining);
      tag.markTotals[id] = total;
      rows.push({ id, icon: MARK_ICONS[id], ring: statusRing(m.remaining, total) });
    }
    for (const id of MARK_IDS) if (!e.marks.some((x) => x.id === id)) delete tag.markTotals[id];
    const key = rows.map((r) => r.id).join(',');
    if (key !== tag.shown) {
      tag.shown = key;
      tag.icons.replaceChildren(...rows.map((r) => this.icon(r.id, r.icon.color)));
    }
    rows.forEach((r, i) => (tag.icons.children[i] as HTMLElement).style.setProperty('--p', String(r.ring)));
  }

  private icon(id: string, colour: string): HTMLDivElement {
    const d = div('ico');
    d.style.setProperty('--c', colour);
    d.style.setProperty('--p', '1');
    d.title = id.replace(/_/g, ' ');
    d.append(iconEl(statusArt(id), colour));
    return d;
  }

  /** The tallest point of an enemy above its feet, from its hurtboxes. */
  private topOf(defId: string): number {
    const def = this.data().enemies[defId];
    if (!def) return 2;
    return Math.max(...def.hurtboxes.map((h) => Math.max(h.a[1], h.b[1]) + h.r)) * def.scale + 0.3;
  }

  private place(el: HTMLElement, x: number, y: number, z: number): void {
    if (!this.camera) return;
    this.v.set(x, y, z).project(this.camera);
    const visible = this.v.z < 1 && this.v.z > -1;
    el.style.display = visible ? '' : 'none';
    if (!visible) return;
    el.style.left = `${((this.v.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - this.v.y) / 2) * 100}%`;
  }
}
