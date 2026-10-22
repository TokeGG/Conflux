import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunDirector } from '../src/run/director.ts';
import { createRunRoomSim } from '../src/run/director.ts';
import { emptyLedger } from '../src/run/unlocks.ts';
import { defaultData } from '../src/files.ts';
import { botInput } from '../src/bot.ts';

const data = defaultData();

/** Plays one room with the scripted bot; returns the events and whether the player survived. */
function playRoom(d: RunDirector, maxSeconds = 90) {
  const sim = createRunRoomSim(d.run, data);
  for (let i = 0; i < maxSeconds * 60; i++) {
    const events = sim.step([botInput(sim)]);
    d.onEvents(events);
    if (sim.player.hp <= 0) {
      d.onPlayerHp(sim.player.hp);
      break;
    }
    if (d.phase !== 'fighting') break;
  }
  d.onPlayerHp(sim.player.hp);
  return sim;
}

test('a room sim holds the plan: its enemies, the run hp, loadout and augments', () => {
  const d = new RunDirector(data, 3, emptyLedger());
  d.run = { ...d.run, hp: 40, augments: [{ id: 'aug.explosive_fireball', rarity: 'rare', skill: 'fire.fireball' }] };
  const sim = createRunRoomSim(d.run, data);
  assert.equal(sim.enemies.length, d.run.current.enemies.length);
  assert.equal(sim.player.hp, 40);
  assert.equal(sim.augments.length, 1);
  assert.equal(sim.spawned, d.run.current.enemies.length);
});

test('clearing a room offers three rewards, picking one opens the doors, a door starts the next room', () => {
  const d = new RunDirector(data, 1, emptyLedger());
  assert.equal(d.phase, 'fighting');
  playRoom(d);
  assert.equal(d.phase, 'reward');
  assert.equal(d.offers.length, 3);
  d.pick(0);
  assert.equal(d.phase, 'doors');
  assert.ok(d.doors.length >= 2);
  const next = d.enter(0);
  assert.equal(next.index, 1);
  assert.equal(d.phase, 'fighting');
  assert.equal(d.run.roomIndex, 1);
});

test('dying ends the run as a defeat and records the run', () => {
  const d = new RunDirector(data, 1, emptyLedger());
  d.onPlayerHp(0);
  assert.equal(d.phase, 'dead');
  assert.equal(d.run.status, 'defeat');
  assert.equal(d.ledger.counters.runs, 1);
});

test('ledger counters follow the events of the run', () => {
  const d = new RunDirector(data, 1, emptyLedger());
  playRoom(d);
  assert.ok((d.ledger.counters['rooms.cleared'] ?? 0) >= 1);
});

test('a tuned run counts nothing toward the ledger', () => {
  const d = new RunDirector(data, 1, emptyLedger(), true);
  playRoom(d);
  assert.deepEqual(d.ledger, emptyLedger());
});

test('the locked content is never found before it is unlocked', () => {
  const d = new RunDirector(data, 1, emptyLedger());
  assert.ok(!d.run.skills.pool.includes('water.slip_dash'));
});

test('a skill taken as a reward is equipped on its slot at once, and the old one stays owned', () => {
  const d = new RunDirector(data, 1, emptyLedger());
  playRoom(d);
  const i = d.offers.findIndex((o) => o.kind === 'skill');
  if (i < 0) {
    d.run = { ...d.run };
    d.offers = [{ kind: 'skill', id: [...(d.run.pool?.skills ?? [])].find((s) => !d.run.skills.pool.includes(s))!, element: 'fire' }];
  }
  const idx = i < 0 ? 0 : i;
  const offer = d.offers[idx];
  const skill = data.skills[offer.id!];
  const before = d.run.skills.slots[skill.element][skill.slot];
  d.pick(idx);
  assert.equal(d.run.skills.slots[skill.element][skill.slot], offer.id);
  assert.ok(d.run.skills.pool.includes(before));
  assert.ok(d.run.skills.pool.includes(offer.id!));
});

test('endless: clearing a room, picking a reward and walking into gate 1 enters the room that gate showed', async () => {
  const { ENDLESS } = await import('../src/run/endless.ts');
  const d = new RunDirector(data, 1, emptyLedger(), false, ENDLESS);
  const seen: number[] = [];
  d.onEnter = (plan) => seen.push(plan.index);
  d.onEvents([{ t: 0, type: 'room_cleared' }]);
  assert.equal(d.phase, 'reward');
  d.pick(0);
  assert.equal(d.phase, 'doors');
  const gate = Math.min(1, d.doors.length - 1);
  const shown = d.doors[gate].room;
  d.onEvents([{ t: 1, type: 'door_entered', door: gate }]);
  assert.equal(d.phase, 'fighting');
  assert.equal(d.run.current.roomId, shown.roomId);
  assert.deepEqual(seen, [1]);
  d.onEvents([{ t: 2, type: 'door_entered', door: 0 }]);
  assert.equal(d.run.roomIndex, 1, 'a second door_entered while fighting changes nothing');
});

test('createRunRoomSim builds a generated room from the plan\'s own definition', async () => {
  const { ENDLESS } = await import('../src/run/endless.ts');
  const d = new RunDirector(data, 2, emptyLedger(), false, ENDLESS);
  const sim = createRunRoomSim(d.run, data);
  assert.equal(sim.enemies.length, d.run.current.enemies.length);
  assert.equal(sim.doors.length, d.run.current.def!.spawns.doors.length);
});
