// The Models and mobs page: upload a model, check it, prepare it, describe the mob, put it in pools, spawn it, save it, export it.
import { unzipSync } from 'fflate';
import { AI_ARCHETYPES, ELEMENTS, type Element, type EnemyDef, type GameData, type SimBridge, type DataLayers } from '@conflux/shared';
import { el } from '../dom.ts';
import { fbxToGlb } from '../import/fbx.ts';
import { inspectModel, isImportError, type ModelReport } from '../import/inspect.ts';
import { applyElement, defaultEnemyFrom, matchClips } from '../import/mobForm.ts';
import { prepareModel } from '../import/prepare.ts';
import { resizeImage } from '../import/resizeImage.ts';
import { removeMob, type CustomContentStore, type CustomMob } from '../import/store.ts';
import type { DevPage } from '../page.ts';
import type { AssetLoader } from '../../assets/loader.ts';

const PRESETS = ['hop', 'stomp_sway', 'hover', 'ribbon_spin', 'part_sway', 'lunge'];

export interface ModelsPageDeps {
  store: CustomContentStore | null;
  layers: DataLayers;
  loader: AssetLoader;
  bridge: SimBridge;
  data(): GameData;
  /** Sends the current data to the running sim. */
  sendData(): void;
  refresh(): void;
}

const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

export class ModelsPage implements DevPage {
  readonly id = 'models';
  readonly title = 'Models and mobs';
  private host: HTMLElement | null = null;
  private glb: Uint8Array | null = null;
  private report: ModelReport | null = null;
  private fileName = '';
  private draft: EnemyDef | null = null;
  private pools = new Set<string>();
  private listEl: HTMLElement | null = null;

  constructor(private d: ModelsPageDeps) {
    // an undo from the Changes list removes the mob from storage too
    d.layers.onCustomRemoved((id) => {
      void d.store?.remove(id).then(() => this.drawList());
      d.loader.removeCustomModel(`model.custom.${id.replace(/^enemy\.custom\./, '')}`);
      d.sendData();
    });
  }

  private say(text: string, bad = false): void {
    const m = this.host?.querySelector('#mob-msg');
    if (m) {
      m.textContent = text;
      m.classList.toggle('dev-bad', bad);
    }
  }

  render(host: HTMLElement): void {
    this.host = host;
    host.replaceChildren();
    if (!this.d.store) {
      host.append(el('div', { class: 'dev-msg', id: 'mob-nostorage' }, 'Your browser blocks storage, uploads are unavailable.'));
      return;
    }
    host.append(el('div', { class: 'dev-msg', id: 'mob-msg' }, 'Choose a model file (.glb, .gltf, .fbx or a .zip) to begin.'));
    const upload = el('div', { class: 'dev-section', id: 'mob-upload' });
    upload.append(el('h4', {}, '1. Upload'));
    const input = el('input', { type: 'file', id: 'mob-file', accept: '.glb,.gltf,.fbx,.zip' });
    input.addEventListener('change', () => input.files?.[0] && void this.load(input.files[0]));
    upload.append(input);
    host.addEventListener('dragover', (e) => e.preventDefault());
    host.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = (e as DragEvent).dataTransfer?.files[0];
      if (f) void this.load(f);
    });
    host.append(upload, el('div', { id: 'mob-steps' }), el('h4', {}, 'Saved mobs'));
    this.listEl = el('div', { id: 'mob-list', class: 'dev-list' });
    host.append(this.listEl);
    this.drawList();
  }

  dispose(): void {
    this.host = null;
    this.listEl = null;
  }

  /** A file chosen or dropped: unpack, convert, inspect. */
  private async load(file: File): Promise<void> {
    this.glb = null;
    this.report = null;
    this.draft = null;
    this.fileName = file.name;
    const steps = this.host?.querySelector('#mob-steps');
    steps?.replaceChildren();
    try {
      let name = file.name;
      let buf = await file.arrayBuffer();
      if (/\.zip$/i.test(name)) {
        const files = unzipSync(new Uint8Array(buf));
        const inner = Object.keys(files).find((n) => /\.(glb|gltf|fbx)$/i.test(n));
        if (!inner) return this.say('That zip has no .glb, .gltf or .fbx file in it.', true);
        name = inner;
        buf = ab(files[inner]);
      }
      if (/\.fbx$/i.test(name)) buf = await fbxToGlb(buf);
      const report = await inspectModel(buf, name);
      if (isImportError(report)) return this.say(report.error, true);
      this.glb = new Uint8Array(buf);
      this.report = report;
      this.say(`${file.name} read. Check the report, then prepare it.`);
      this.drawSteps();
    } catch (e) {
      this.say(`That file could not be used: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  }

  private drawReport(box: HTMLElement, r: ModelReport): void {
    const rows: [string, string][] = [
      ['Meshes', String(r.meshes)],
      ['Triangles', r.triangles.toLocaleString()],
      ['Skeleton', r.hasSkin ? `${r.bones.length} bones` : 'none'],
      ['Animation clips', r.clips.length ? r.clips.map((c) => `${c.name} (${c.duration.toFixed(1)} s)`).join(', ') : 'none'],
      ['Textures', r.textures.length ? r.textures.map((t) => `${t.name} ${t.w}×${t.h}`).join(', ') : 'none'],
      ['Size', `${r.size.x.toFixed(2)} × ${r.size.y.toFixed(2)} × ${r.size.z.toFixed(2)} m`],
    ];
    const table = el('table', { class: 'dev-report', id: 'mob-report' });
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.append(el('th', {}, k), el('td', {}, v));
      table.append(tr);
    }
    box.append(table);
    for (const w of r.warnings) box.append(el('div', { class: 'dev-warn' }, `⚠ ${w}`));
  }

  private drawSteps(): void {
    const steps = this.host?.querySelector('#mob-steps');
    if (!steps || !this.report || !this.glb) return;
    steps.replaceChildren();
    const section = (title: string) => {
      const s = el('div', { class: 'dev-section' });
      s.append(el('h4', {}, title));
      steps.append(s);
      return s;
    };
    const labelled = <T extends HTMLElement>(box: HTMLElement, text: string, control: T) => {
      const l = el('label', {}, `${text} `);
      l.append(control);
      box.append(l);
      return control;
    };

    const inspect = section('2. Inspect');
    this.drawReport(inspect, this.report);

    const prep = section('3. Prepare');
    const name = labelled(prep, 'Name', el('input', { type: 'text', id: 'mob-name', value: this.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') }));
    const kind = labelled(prep, 'Kind', el('select', { id: 'mob-kind' }));
    for (const k of ['mob', 'boss']) kind.append(el('option', { value: k }, k));
    const height = labelled(prep, 'Height (m)', el('input', { type: 'number', id: 'mob-height', value: '1.8', step: '0.1', min: '0.2', class: 'dev-num' }));
    const turn = labelled(prep, 'Turn', el('select', { id: 'mob-turn' }));
    for (const t of ['0', '90', '180', '270']) turn.append(el('option', { value: t }, `${t}°`));
    const go = el('button', { id: 'mob-prepare' }, 'Prepare');
    prep.append(go);
    const prepared = el('div', { id: 'mob-prepared' });
    prep.append(prepared);
    go.addEventListener('click', async () => {
      this.say('Preparing...');
      const out = await prepareModel(ab(this.glb!), { heightM: Number(height.value), kind: kind.value as 'mob' | 'boss', turnDegrees: Number(turn.value), resize: resizeImage }, this.fileName);
      if (isImportError(out)) return this.say(out.error, true);
      this.glb = out.glb;
      this.report = out.report;
      this.draft = defaultEnemyFrom(out.report, name.value);
      this.say(`Prepared: ${out.report.triangles.toLocaleString()} triangles, ${out.report.size.y.toFixed(2)} m tall. Describe the mob below.`);
      prepared.replaceChildren();
      this.drawReport(prepared, out.report);
      this.drawMobForm(steps as HTMLElement, name);
    });
  }

  /** Steps 4 to 7: animation, the mob, its pools, and the buttons. */
  private drawMobForm(steps: HTMLElement, nameInput: HTMLInputElement): void {
    steps.querySelectorAll('.dev-mobform').forEach((n) => n.remove());
    const draft = this.draft!;
    const report = this.report!;
    const data = this.d.data();
    const box = el('div', { class: 'dev-section dev-mobform' });
    box.append(el('h4', {}, '4. Animation and the mob'));
    const field = <T extends HTMLElement>(text: string, control: T) => {
      const l = el('label', {}, `${text} `);
      l.append(control);
      box.append(l);
      return control;
    };
    const select = (id: string, options: readonly string[], value: string) => {
      const s = el('select', { id });
      for (const o of options) {
        const opt = el('option', { value: o }, o);
        if (o === value) opt.selected = true;
        s.append(opt);
      }
      return s;
    };
    const num = (id: string, value: number, step = 1, min = 0) => el('input', { type: 'number', id, value: String(value), step: String(step), min: String(min), class: 'dev-num' });

    const clips = report.clips.map((c) => c.name);
    const mode = field('Animation', select('mob-mode', clips.length ? ['own clips', 'procedural'] : ['procedural'], draft.rig.type === 'own' ? 'own clips' : 'procedural'));
    const preset = field('Motion preset', select('mob-preset', PRESETS, draft.rig.preset ?? 'hop'));
    const roles: Record<string, HTMLSelectElement> = {};
    const matched = matchClips(clips);
    for (const role of ['idle', 'walk', 'attack', 'guard']) {
      const cur = matched[role];
      roles[role] = field(`Clip: ${role}`, select(`mob-clip-${role}`, ['(none)', ...clips], (Array.isArray(cur) ? cur[0] : cur) ?? '(none)'));
    }
    const element = field('Element', select('mob-element', ['none', ...ELEMENTS], draft.element));
    const ai = field('Behaviour', select('mob-ai', AI_ARCHETYPES.filter((a) => a !== 'none'), draft.ai));
    const hp = field('Health', num('mob-hp', draft.hp));
    const speed = field('Speed (m/s)', num('mob-speed', draft.speed, 0.1));
    const cost = field('Encounter cost', num('mob-cost', draft.cost));
    const scale = field('Scale', num('mob-scale', draft.scale, 0.05, 0.1));
    const tint = field('Tint', el('input', { type: 'color', id: 'mob-tint', value: '#ffffff' }));
    const useTint = field('Use tint', el('input', { type: 'checkbox', id: 'mob-usetint' }));
    const guard = field('Guard stance', el('input', { type: 'checkbox', id: 'mob-guard' }));
    const attacks = el('div', { class: 'dev-checks', id: 'mob-attacks' });
    for (const id of Object.keys(data.attacks)) {
      const l = el('label', { class: 'dev-check' });
      const c = el('input', { type: 'checkbox', value: id });
      c.checked = draft.attacks.includes(id);
      l.append(c, ` ${id}`);
      attacks.append(l);
    }
    box.append(el('div', {}, 'Attacks'), attacks);
    this.pools = new Set(Object.keys(data.biomes));
    const pools = el('div', { class: 'dev-checks', id: 'mob-pools' });
    for (const id of Object.keys(data.biomes)) {
      const l = el('label', { class: 'dev-check' });
      const c = el('input', { type: 'checkbox', value: id });
      c.checked = true;
      c.addEventListener('change', () => (c.checked ? this.pools.add(id) : this.pools.delete(id)));
      l.append(c, ` ${id}`);
      pools.append(l);
    }
    box.append(el('h4', {}, '5. Encounter pools'), pools);

    /** The enemy entry as the form now describes it. */
    const build = (): EnemyDef => {
      let e = applyElement({ ...draft, name: nameInput.value.trim() || draft.name }, element.value as Element | 'none');
      e = { ...e, ai: ai.value as EnemyDef['ai'], hp: Number(hp.value), speed: Number(speed.value), cost: Number(cost.value), scale: Number(scale.value) };
      if (useTint.checked) e.tint = tint.value;
      else delete e.tint;
      if (mode.value === 'own clips') {
        const pick = (role: string) => (roles[role].value === '(none)' ? undefined : roles[role].value);
        const c: Record<string, string | string[]> = {};
        for (const role of ['idle', 'walk']) if (pick(role)) c[role] = pick(role)!;
        for (const role of ['attack', 'guard']) if (pick(role)) c[role] = [pick(role)!];
        e.rig = { type: 'own', clips: c };
      } else {
        e.rig = { type: 'procedural', preset: preset.value };
      }
      if (guard.checked) e.guard = { reduction: 0.8, onFor: 3, offFor: 5, staggerOnWeak: 2 };
      else delete e.guard;
      e.attacks = [...attacks.querySelectorAll('input')].filter((c) => (c as HTMLInputElement).checked).map((c) => (c as HTMLInputElement).value);
      return e;
    };

    const save = async (): Promise<CustomMob | null> => {
      const enemy = build();
      if (!enemy.attacks.length) {
        this.say('Pick at least one attack.', true);
        return null;
      }
      const slug = enemy.id.replace(/^enemy\.custom\./, '');
      const mob: CustomMob = { id: enemy.id, name: enemy.name, glbKey: `model.custom.${slug}`, enemy, pools: [...this.pools], licence: { author: '', licence: '', source: '', verified: false } };
      try {
        await this.d.store!.put(mob, this.glb!);
        this.d.loader.addCustomModel(mob.glbKey, this.glb!);
        this.d.layers.addCustom({ id: mob.id, enemy, pools: mob.pools });
      } catch (e) {
        this.say(`Could not save: ${e instanceof Error ? e.message : String(e)}`, true);
        return null;
      }
      this.d.sendData();
      this.d.refresh();
      this.say(`Saved ${mob.name} as ${mob.id}.`);
      this.drawList();
      return mob;
    };

    const buttons = el('div', { class: 'dev-section' });
    buttons.append(el('h4', {}, '6. Try it, then keep it'));
    const spawnNow = el('button', { id: 'mob-spawn' }, 'Spawn now');
    spawnNow.addEventListener('click', async () => {
      const mob = await save();
      if (mob) this.d.bridge.command({ op: 'spawn', enemy: mob.id, count: 1, at: 'crosshair' });
    });
    const arena = el('button', { id: 'mob-arena' }, 'Test arena (with a dummy)');
    arena.addEventListener('click', async () => {
      const mob = await save();
      if (!mob) return;
      this.d.bridge.command({ op: 'killAll' });
      this.d.bridge.command({ op: 'spawn', enemy: mob.id, count: 1, at: 'crosshair' });
      this.d.bridge.command({ op: 'spawnDummy', at: 'crosshair' });
    });
    const keep = el('button', { id: 'mob-save' }, 'Save');
    keep.addEventListener('click', () => void save());
    buttons.append(spawnNow, arena, keep);
    box.append(buttons);
    steps.append(box);
  }

  private async drawList(): Promise<void> {
    const list = this.listEl;
    if (!list || !this.d.store) return;
    const mobs = await this.d.store.list();
    if (this.listEl !== list) return;
    list.replaceChildren();
    if (!mobs.length) list.append(el('div', { class: 'dev-empty' }, 'No uploaded mobs yet.'));
    for (const m of mobs) {
      const row = el('div', { class: 'dev-listrow', 'data-id': m.id });
      row.append(el('span', {}, `${m.name} `), el('code', {}, m.id));
      const spawn = el('button', {}, 'Spawn');
      spawn.addEventListener('click', () => this.d.bridge.command({ op: 'spawn', enemy: m.id, count: 1, at: 'crosshair' }));
      const del = el('button', { class: 'mob-delete' }, 'Delete');
      del.addEventListener('click', async () => {
        await removeMob(this.d.store!, this.d.layers, m.id);
        this.d.refresh();
        this.say(`Deleted ${m.name}.`);
      });
      row.append(spawn, del);
      list.append(row);
    }
    if (mobs.length) {
      const exp = el('button', { id: 'mob-export' }, 'Export all (zip)');
      exp.addEventListener('click', async () => {
        const zip = await this.d.store!.exportZip();
        const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
        const a = el('a', { href: url, download: 'conflux-custom-mobs.zip' });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
      list.append(exp);
    }
  }
}
