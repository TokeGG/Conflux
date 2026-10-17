// Frame-time statistics for the performance page, kept apart from the DOM so they can be tested.
export interface PerfEnv {
  gpu: string;
  browser: string;
  width: number;
  height: number;
  dpr: number;
  renderScale: number;
  profile: string;
}

/** The parts of THREE.WebGLRenderer.info the report uses. */
export interface RendererInfoLike {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
}

export class PerfStats {
  private frames: number[] = [];

  constructor(private readonly capacity = 600) {}

  get count(): number {
    return this.frames.length;
  }

  push(frameMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0) return;
    this.frames.push(frameMs);
    if (this.frames.length > this.capacity) this.frames.shift();
  }

  clear(): void {
    this.frames = [];
  }

  avgFps(): number {
    if (!this.frames.length) return 0;
    return 1000 / (this.frames.reduce((s, f) => s + f, 0) / this.frames.length);
  }

  /** The frame rate of the slowest 1% of frames (at least one frame). */
  lowFps(): number {
    if (!this.frames.length) return 0;
    const k = Math.max(1, Math.ceil(this.frames.length * 0.01));
    const worst = [...this.frames].sort((a, b) => b - a).slice(0, k);
    return 1000 / (worst.reduce((s, f) => s + f, 0) / k);
  }

  worstMs(): number {
    return this.frames.length ? Math.max(...this.frames) : 0;
  }

  report(env: PerfEnv, info: RendererInfoLike): string {
    const avg = this.avgFps();
    return [
      'Conflux performance report',
      `GPU: ${env.gpu}`,
      `Browser: ${env.browser}`,
      `Resolution: ${env.width}x${env.height} (device pixel ratio ${env.dpr}, render scale ${env.renderScale.toFixed(2)}, profile ${env.profile})`,
      `Average: ${avg.toFixed(1)} fps (${avg ? (1000 / avg).toFixed(1) : '0.0'} ms)`,
      `1% low: ${this.lowFps().toFixed(1)} fps`,
      `Worst frame: ${this.worstMs().toFixed(1)} ms`,
      `Draw calls: ${info.render.calls}`,
      `Triangles: ${info.render.triangles.toLocaleString('en-US')}`,
      `Geometries: ${info.memory.geometries}, textures: ${info.memory.textures}`,
    ].join('\n');
  }
}
