// The player's movement and dodge. Movement is relative to the aim yaw: moveZ goes where the crosshair looks, moveX to its right.
import type { Input } from '../types.ts';
import { BTN } from '../types.ts';
import type { Sim } from './sim.ts';
import { stepCast } from './skills.ts';
import { statusModifiers } from './statuses.ts';
import type { PlayerState } from './state.ts';

export function stepPlayer(sim: Sim, p: PlayerState, input: Input, dt: number): void {
  const cfg = sim.data.player;
  const now = sim.time;
  const mods = statusModifiers(p, now, sim.data.statuses);
  if (!mods.canAct) {
    p.castState = null;
    input = { ...input, moveX: 0, moveZ: 0, buttons: 0 };
  }
  stepCast(sim, p, input);

  const sin = Math.sin(input.aimYaw);
  const cos = Math.cos(input.aimYaw);
  let mx = Math.max(-1, Math.min(1, input.moveX));
  let mz = Math.max(-1, Math.min(1, input.moveZ));
  const raw = Math.hypot(mx, mz);
  if (raw > 1) (mx /= raw), (mz /= raw);
  const mag = Math.hypot(mx, mz);
  // right = (cos, -sin), forward = (sin, cos)
  const dirX = mx * cos + mz * sin;
  const dirZ = -mx * sin + mz * cos;

  let vx: number;
  let vz: number;
  if (p.dash && now >= p.dash.until) p.dash = null;
  if (p.dash) {
    vx = p.dash.vx;
    vz = p.dash.vz;
  } else {
    const speed = cfg.moveSpeed * (p.castState ? p.castState.move : 1) * (p.buff && now < p.buff.until ? p.buff.speedMul : 1) * mods.speedMul;
    vx = dirX * speed;
    vz = dirZ * speed;
    if (p.castState) p.facing = input.aimYaw;
    else if (mag > 0.01) p.facing = Math.atan2(dirX, dirZ);
  }
  p.vel.x = vx;
  p.vel.z = vz;

  // each axis on its own, so a wall is slid along rather than stuck to
  // the last step of a dash is cut to the time left, so it covers exactly its distance
  const moveDt = p.dash ? Math.min(dt, Math.max(0, p.dash.until - now)) : dt;
  // a player already overlapping a collider (a dash ended on a prop, a spawn beside one) may always move, so they walk out rather than freeze
  const stuck = sim.world.blocked(p.pos, cfg.radius);
  const nx = p.pos.x + vx * moveDt;
  if (stuck || !sim.world.blocked({ x: nx, y: p.pos.y, z: p.pos.z }, cfg.radius)) p.pos.x = nx;
  const nz = p.pos.z + vz * moveDt;
  if (stuck || !sim.world.blocked({ x: p.pos.x, y: p.pos.y, z: nz }, cfg.radius)) p.pos.z = nz;
  // jump: leave the ground on a press (only while standing on it), then fall back under gravity
  const ground = sim.world.groundAt(p.pos.x, p.pos.z);
  if (input.buttons & BTN.JUMP && p.pos.y <= ground + 1e-6 && p.vy <= 0) p.vy = cfg.jump.speed;
  if (p.vy !== 0 || p.pos.y > ground) {
    p.vy -= cfg.jump.gravity * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= ground) {
      p.pos.y = ground;
      p.vy = 0;
    }
  } else p.pos.y = ground;
}
