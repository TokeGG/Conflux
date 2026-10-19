// The performance page: live frame statistics, GPU details, graphics toggles, a 10 second benchmark and a copyable report.
import type * as THREE from 'three';
import type { Vec3 } from '@conflux/shared';
import { Benchmark, orbitPose } from './benchmark.ts';
import { el } from './dom.ts';
import type { DevPage } from './page.ts';
import { PerfStats, type PerfEnv } from './perfStats.ts';
import { clampScale } from '../renderer/profile.ts';
import type { Settings } from '../settings.ts';

export function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown (the browser hides it)';
}

/** GPU time of the render call, where EXT_disjoint_timer_query_webgl2 exists. */
export class GpuTimer {
  lastMs: number | null = null;
  private query: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];

  private constructor(
    private gl: WebGL2RenderingContext,
    private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
  ) {}

  static create(gl: WebGLRenderingContext | WebGL2RenderingContext): GpuTimer | null {
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.query) return;
    this.query = this.gl.createQuery();
    if (this.query) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
  }

  end(): void {
    if (!this.query) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.query);
    this.query = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.lastMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

export interface PerfPageOptions {
  renderer: THREE.WebGLRenderer;
  profileId: string;
  getSettings(): Settings;
  onSettings(s: Settings): void;
  benchmark: Benchmark;
  /** What the benchmark camera circles. */
  centre: Vec3;
  radius: number;
  height: number;
}

export class PerfPage implements DevPage {
  readonly id = 'perf';
  readonly title = 'Performance';
  readonly stats = new PerfStats();
  private timer: ReturnType<typeof setInterval> | null = null;
  private els: Record<string, HTMLElement> = {};
  private gpuTimer: GpuTimer | null;
  private benchReport = '';

  constructor(private o: PerfPageOptions) {
    this.gpuTimer = GpuTimer.create(o.renderer.getContext());
  }

  /** True while the page is open and sampling. */
  get sampling(): boolean {
    return this.timer !== null;
  }

  env(): PerfEnv {
    const c = this.o.renderer.domElement;
    return { gpu: gpuName(this.o.renderer.getContext()), browser: navigator.userAgent, width: c.width, height: c.height, dpr: window.devicePixelRatio, renderScale: this.o.getSettings().renderScale, profile: this.o.profileId };
  }

  /** The benchmark's report once it has run, otherwise the live statistics. */
  report(): string {
    return this.benchReport || this.stats.report(this.env(), this.o.renderer.info);
  }

  beforeRender(): void {
    if (this.sampling) this.gpuTimer?.begin();
  }

  afterRender(): void {
    if (this.sampling) this.gpuTimer?.end();
  }

  /** Called every frame with the frame time; only records while the page is open. */
  frame(ms: number): void {
    if (!this.sampling) return;
    this.stats.push(ms);
    if (this.o.benchmark.update(ms)) {
      this.benchReport = `${this.o.benchmark.stats.report(this.env(), this.o.renderer.info)}\nBenchmark: ${this.o.benchmark.seconds} s camera orbit`;
      this.refresh();
    }
  }

  /** The camera pose while the benchmark runs, otherwise null. */
  benchmarkPose(): { pos: Vec3; look: Vec3 } | null {
    const b = this.o.benchmark;
    return b.running ? orbitPose(b.elapsed, b.seconds, this.o.centre, this.o.radius, this.o.height) : null;
  }

  render(host: HTMLElement): void {
    host.replaceChildren();
    const mk = (id: string, label: string) => {
      const row = el('div', { class: 'dev-row' });
      row.append(el('span', { class: 'dev-label' }, label));
      const v = el('b', { id });
      row.append(v);
      host.append(row);
      this.els[id] = v;
    };
    host.append(el('h3', {}, 'Performance'));
    mk('perf-fps', 'Average fps');
    mk('perf-low', '1% low fps');
    mk('perf-worst', 'Worst frame (ms)');
    mk('perf-calls', 'Draw calls');
    mk('perf-tris', 'Triangles');
    mk('perf-gpu', 'GPU');
    mk('perf-gputime', 'GPU time per frame');
    mk('perf-bench', 'Benchmark');

    const s = this.o.getSettings();
    host.append(el('h3', {}, 'Graphics'));
    const scale = el('input', { type: 'range', min: '0.75', max: '1', step: '0.05', value: String(s.renderScale), id: 'perf-scale' });
    scale.addEventListener('input', () => this.o.onSettings({ ...this.o.getSettings(), renderScale: clampScale(Number(scale.value)) }));
    const row = el('div', { class: 'dev-row' });
    row.append(el('span', { class: 'dev-label' }, 'Render scale'), scale);
    host.append(row);
    const toggle = (label: string, key: 'antialias' | 'shadows' | 'sprites' | 'particles' | 'shaders', note = '') => {
      const box = el('input', { type: 'checkbox' });
      const cur = this.o.getSettings();
      box.checked = key === 'antialias' || key === 'shadows' ? cur[key] : cur.effects[key];
      box.addEventListener('change', () => {
        const next = this.o.getSettings();
        if (key === 'antialias' || key === 'shadows') next[key] = box.checked;
        else next.effects[key] = box.checked;
        this.o.onSettings(next);
      });
      const r = el('label', { class: 'dev-row' });
      r.append(box, el('span', {}, ` ${label}${note}`));
      host.append(r);
    };
    toggle('Antialiasing', 'antialias', ' (takes effect after a reload)');
    toggle('Shadows', 'shadows');
    toggle('Sprite effects', 'sprites');
    toggle('Particle effects', 'particles');
    toggle('Shader effects', 'shaders');
    const cap = el('input', { type: 'number', min: '0', max: '200', step: '1', value: String(s.maxEnemies), id: 'perf-maxenemies' });
    cap.addEventListener('change', () => this.o.onSettings({ ...this.o.getSettings(), maxEnemies: Math.max(0, Math.floor(Number(cap.value) || 0)) }));
    const capRow = el('div', { class: 'dev-row' });
    capRow.append(el('span', { class: 'dev-label' }, 'Enemy cap (0 = none)'), cap);
    host.append(capRow);

    const buttons = el('div', { class: 'dev-row' });
    const reset = el('button', {}, 'Reset stats');
    reset.addEventListener('click', () => {
      this.stats.clear();
      this.benchReport = '';
    });
    const bench = el('button', { id: 'perf-runbench' }, `Run ${this.o.benchmark.seconds} s benchmark`);
    bench.addEventListener('click', () => {
      this.benchReport = '';
      this.o.benchmark.start();
    });
    const copy = el('button', { id: 'perf-copy' }, 'Copy report');
    copy.addEventListener('click', () => void copyText(this.report()));
    buttons.append(reset, bench, copy);
    host.append(buttons);

    this.timer = setInterval(() => this.refresh(), 500);
    this.refresh();
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.o.benchmark.running = false;
    this.stats.clear();
  }

  private refresh(): void {
    const set = (id: string, text: string) => {
      if (this.els[id]) this.els[id].textContent = text;
    };
    const info = this.o.renderer.info;
    set('perf-fps', this.stats.count ? this.stats.avgFps().toFixed(1) : '…');
    set('perf-low', this.stats.count ? this.stats.lowFps().toFixed(1) : '…');
    set('perf-worst', this.stats.count ? this.stats.worstMs().toFixed(1) : '…');
    set('perf-calls', String(info.render.calls));
    set('perf-tris', info.render.triangles.toLocaleString('en-US'));
    set('perf-gpu', gpuName(this.o.renderer.getContext()));
    set('perf-gputime', this.gpuTimer ? (this.gpuTimer.lastMs === null ? '…' : `${this.gpuTimer.lastMs.toFixed(2)} ms`) : 'not available in this browser');
    const b = this.o.benchmark;
    set('perf-bench', b.running ? `running ${Math.round(b.progress() * 100)}%` : this.benchReport ? 'done: Copy report sends these figures' : 'not run');
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
