// Rafters climb + high-drop tests (authoritative sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT, S, BTN, RAFTER_Y, RAFTER_REACH, HIGH_DROP_DUR, HIGH_DROP_RADIUS, HIGH_DROP_SELF } from '../shared/sim/constants.js';
import { ARENA } from '../shared/config/arena.js';

const R = ARENA.ring;
function live(chars = ['ajan', 'lucky']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; f.input.pressed = 0; }
  return w;
}

test('interact at the back-stands zipline rides up over the ring', () => {
  const w = live(); const f = w.byId(1);
  // vaulted out into the back moat, standing on the zipline platform
  f.outside = true; f.zone = 'floor'; f.x = 0; f.z = -(ARENA.barricade.halfZ + 0.3); f.y = 0; f.state = S.IDLE;
  f.input.pressed = BTN.INTERACT;
  w.step();
  assert.equal(f.state, S.RAFTER_CLIMB);
  for (let i = 0; i < Math.ceil(1.6 / DT); i++) w.step();
  assert.equal(f.state, S.RAFTER);
  assert.ok(Math.abs(f.y - RAFTER_Y) < 0.1, 'at rafter height');
});

test('moving in the rafters is clamped over the ring', () => {
  const w = live(); const f = w.byId(1);
  w.controller.startRafterClimb(f);
  for (let i = 0; i < Math.ceil(1.6 / DT); i++) w.step();
  assert.equal(f.state, S.RAFTER);
  f.input.mx = 1; f.input.mz = 0;
  for (let i = 0; i < 300; i++) w.step();
  assert.ok(f.x <= RAFTER_REACH + 1e-6, 'cannot walk off past the ring');
  assert.ok(Math.abs(f.y - RAFTER_Y) < 0.1, 'stays up top');
});

test('the high drop devastates anyone underneath and smashes the ring', () => {
  const w = live(); const f = w.byId(1), v = w.byId(2);
  // put the diver up top over centre, victim right below
  f.state = S.RAFTER; f.x = 0; f.z = 0; f.y = RAFTER_Y; f.onGround = false;
  v.x = 0.4; v.z = 0; v.zone = 'ring'; v.onGround = true; v.state = S.IDLE;
  const hp0 = v.hp;
  const cell = w.ring.cellOf(0, 0);
  w.controller.startHighDrop(f);
  for (let i = 0; i < Math.ceil(HIGH_DROP_DUR / DT) + 3; i++) w.step();
  assert.ok(v.hp < hp0 - 150, `victim took a huge hit (${hp0}->${v.hp})`);
  assert.ok([S.KNOCKDOWN, S.AIRBORNE, S.DOWN, S.KO].includes(v.state), 'victim is put down');
  assert.ok(w.ring.hits[cell] >= 2, 'ring section took heavy damage');
  assert.equal(f.state, S.DOWN, 'the diver is grounded after landing');
});

test('a missed high drop hurts the diver', () => {
  const w = live(); const f = w.byId(1), v = w.byId(2);
  f.state = S.RAFTER; f.x = 0; f.z = 0; f.y = RAFTER_Y; f.onGround = false;
  v.x = R.ropeLine; v.z = R.ropeLine; v.zone = 'ring'; v.state = S.IDLE; // well outside the radius
  const self0 = f.hp;
  w.controller.startHighDrop(f);
  for (let i = 0; i < Math.ceil(HIGH_DROP_DUR / DT) + 3; i++) w.step();
  assert.ok(f.hp < self0, 'diver hurt themselves on a whiff');
  assert.equal(f.hp >= self0 - HIGH_DROP_SELF - 1, true);
});

test('the impact radius is finite', () => {
  const w = live(); const f = w.byId(1), v = w.byId(2);
  f.state = S.RAFTER; f.x = 0; f.z = 0; f.y = RAFTER_Y; f.onGround = false;
  v.x = HIGH_DROP_RADIUS + 1.0; v.z = 0; v.zone = 'ring'; v.state = S.IDLE;
  const hp0 = v.hp;
  w.controller.startHighDrop(f);
  for (let i = 0; i < Math.ceil(HIGH_DROP_DUR / DT) + 3; i++) w.step();
  assert.equal(v.hp, hp0, 'a wrestler outside the radius is untouched');
});
