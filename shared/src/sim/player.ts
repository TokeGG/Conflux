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

  if (input.buttons & BTN.DODGE && now >= p.dodgeReadyAt && now >= p.dodgeUntil) {
    p.dodgeUntil = now + cfg.dodge.duration;
    p.invulnUntil = now + cfg.dodge.invulnerable;
    p.dodgeReadyAt = now + cfg.dodge.cooldown;
    p.castState = null;
    const heading = mag > 0.01 ? Math.atan2(dirX, dirZ) : p.facing;
    p.facing = heading;
    sim.emit('dodge', { yaw: heading });
  }

  let vx: number;
  let vz: number;
  if (now < p.dodgeUntil) {
    vx = Math.sin(p.facing) * cfg.dodge.speed;
    vz = Math.cos(p.facing) * cfg.dodge.speed;
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
  const nx = p.pos.x + vx * dt;
  if (!sim.world.blocked({ x: nx, y: p.pos.y, z: p.pos.z }, cfg.radius)) p.pos.x = nx;
  const nz = p.pos.z + vz * dt;
  if (!sim.world.blocked({ x: p.pos.x, y: p.pos.y, z: nz }, cfg.radius)) p.pos.z = nz;
  p.pos.y = sim.world.groundAt(p.pos.x, p.pos.z);
}
