// Hell-in-a-Cell door tests (authoritative sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { S, ZONE } from '../shared/sim/constants.js';
import { ARENA } from '../shared/config/arena.js';

const C = ARENA.cage;
function live() {
  const w = new World({ mode: 'cell', fighters: [{ charId: 'ajan', team: 0 }, { charId: 'lucky', team: 1 }] });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; }
  return w;
}

test('cage mode is enabled and the door starts intact', () => {
  const w = live();
  assert.equal(w.rules.cage, true);
  assert.ok(!w.arena.cageDoorBroken);
});

test('an intact door blocks exit through the +Z wall', () => {
  const w = live(); const f = w.byId(2);
  f.zone = ZONE.FLOOR; f.y = 0; f.x = 0; f.z = C.half - 0.3; f.vz = 6; f.state = S.MOVE;
  // push outward for a bit
  for (let i = 0; i < 30; i++) { f.input.mx = 0; f.input.mz = 1; w.step(); }
  assert.ok(f.z <= C.half + 1e-6, 'held inside the cell by the door');
});

test('a broken door lets a wrestler walk out of the cell', () => {
  const w = live(); const f = w.byId(2);
  w.arena.cageDoorBroken = true;
  f.zone = ZONE.FLOOR; f.y = 0; f.x = 0; f.z = C.half - 0.3; f.state = S.MOVE;
  for (let i = 0; i < 90; i++) { f.input.mx = 0; f.input.mz = 1; w.step(); }
  assert.ok(f.z > C.half, 'passed out through the door opening');
  assert.ok(f.z <= ARENA.entrance.zEnd + 1e-6, 'but stays on the ramp outside');
});

test('a hard whip into the door breaks it open', () => {
  const w = live(); const f = w.byId(2);
  // launch him into the +Z wall at the door, fast, as if whipped
  f.zone = ZONE.FLOOR; f.y = 0; f.x = 0; f.z = C.half - 0.6;
  f.state = S.WHIPPED; f.lockDir = { x: 0, z: 1, speed: 9 }; f.vx = 0; f.vz = 9;
  let guard = 0;
  while (!w.arena.cageDoorBroken && guard++ < 60) w.step();
  assert.equal(w.arena.cageDoorBroken, true, 'door broke from the impact');
});
