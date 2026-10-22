// The heads-up display: a crosshair, the held element and its three skills with cooldowns, health, and above each enemy its
// health and a ring icon per status. Plain HTML over the canvas; the game reads nothing back from it.
import * as THREE from 'three';
import { ELEMENTS, MARK_IDS, STATUS_IDS, type GameData, type MarkId, type Snapshot, type Vec3 } from '@conflux/shared';
import { formatCooldown, skillLabel, statusRing } from './format.ts';
import { MARK_ICONS, STATUS_ICONS, type Icon } from './statusIcons.ts';
import './hud.css';

const ELEMENT_COLOUR: Record<string, string> = { fire: '#ff7a30', water: '#4aa8ff', earth: '#b08a5a', wind: '#b8f0e0' };
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
  private elementChips: HTMLDivElement[] = [];
  private slotBoxes: { box: HTMLDivElement; name: HTMLElement; cd: HTMLElement; text: HTMLElement; key: HTMLElement }[] = [];
  private bonus = div('bonus', 'Swap bonus: +25% and a sure status');
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
      chip.append(div('k', String(i + 1)), div('name', ''));
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
      box.append(cd, key, name, text);
      slots.append(box);
      this.slotBoxes.push({ box, name, cd, text, key });
    }
    bottom.append(this.bonus, elements, slots);
    const hp = div('hp');
    hp.append(this.hpFill, this.hpText);
    this.root.append(this.crosshair, bottom, hp);
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
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  update(s: Snapshot, aimTarget: number | null, showAi = false): void {
    const p = s.players[0];
    if (!p) return;
    const colour = ELEMENT_COLOUR[p.element];
    this.elementChips.forEach((chip, i) => {
      const el = p.equipped[i];
      chip.style.setProperty('--c', el ? ELEMENT_COLOUR[el] : '#555');
      (chip.lastElementChild as HTMLElement).textContent = el ? el[0].toUpperCase() + el.slice(1) : '—';
      chip.classList.toggle('on', el === p.element);
    });
    p.slots.forEach((slot, i) => {
      const b = this.slotBoxes[i];
      b.box.style.setProperty('--c', colour);
      b.name.textContent = slot.skillId ? skillLabel(slot.skillId) : '—';
      b.cd.style.setProperty('--p', String(slot.total > 0 ? Math.min(1, slot.remaining / slot.total) : 0));
      b.text.textContent = formatCooldown(slot.remaining);
    });
    this.bonus.classList.toggle('on', p.bonusRemaining > 0);
    this.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    this.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.crosshair.classList.toggle('hot', aimTarget !== null);
    this.updateTags(s, aimTarget, showAi);
    this.updateNumbers();
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
    const rows: { icon: Icon; ring: number }[] = [];
    for (const id of STATUS_IDS) {
      const st = e.statuses.find((x) => x.id === id);
      if (st) rows.push({ icon: STATUS_ICONS[id], ring: statusRing(st.remaining, this.data().statuses[id].duration) });
    }
    for (const id of MARK_IDS) {
      const m = e.marks.find((x) => x.id === id);
      if (!m) continue;
      const total = Math.max(tag.markTotals[id] ?? 0, m.remaining);
      tag.markTotals[id] = total;
      rows.push({ icon: MARK_ICONS[id], ring: statusRing(m.remaining, total) });
    }
    for (const id of MARK_IDS) if (!e.marks.some((x) => x.id === id)) delete tag.markTotals[id];
    const key = rows.map((r) => r.icon.glyph).join('');
    if (key !== tag.shown) {
      tag.shown = key;
      tag.icons.replaceChildren(...rows.map((r) => this.icon(r.icon.glyph, r.icon.color)));
    }
    rows.forEach((r, i) => (tag.icons.children[i] as HTMLElement).style.setProperty('--p', String(r.ring)));
  }

  private icon(glyph: string, colour: string): HTMLDivElement {
    const d = div('ico');
    d.style.setProperty('--c', colour);
    d.style.setProperty('--p', '1');
    const s = document.createElement('span');
    s.textContent = glyph;
    d.append(s);
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
