// Barricade vault / fight-outside tests (authoritative sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT, S, BTN } from '../shared/sim/constants.js';
import { ARENA } from '../shared/config/arena.js';
import { encodeFighter, decodeFighter } from '../shared/net/protocol.js';

const B = ARENA.barricade;
function live(chars = ['masked', 'rise']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; f.input.pressed = 0; }
  return w;
}
const settle = (w, n = 50) => { for (let i = 0; i < n; i++) w.step(); };

test('a wrestler is confined inside the barricade by default', () => {
  const w = live(); const f = w.byId(1);
  f.zone = 'floor'; f.y = 0; f.x = B.halfX - 0.5; f.z = 0;
  f.input.mx = 1; f.input.mz = 0; // push outward
  settle(w, 120);
  assert.ok(Math.abs(f.x) <= B.halfX + 1e-6, 'held in by the barricade');
  assert.equal(f.outside, false);
});

test('F near the barricade vaults over to the outside', () => {
  const w = live(); const f = w.byId(1);
  f.zone = 'floor'; f.y = 0; f.x = B.halfX - 0.3; f.z = 0;
  f.input.pressed = BTN.INTERACT;
  w.step();
  assert.equal(f.state, S.CLIMB, 'vault started');
  settle(w, 60);
  assert.equal(f.outside, true, 'now outside the barricade');
  assert.ok(Math.abs(f.x) > B.halfX, 'physically beyond the rail');
});

test('outside, they roam the moat but cannot walk back through the barricade', () => {
  const w = live(); const f = w.byId(1);
  f.zone = 'floor'; f.y = 0; f.outside = true; f.x = B.halfX + 1.0; f.z = 0;
  f.input.mx = -1; f.input.mz = 0; // push back toward the ring
  settle(w, 160);
  assert.ok(Math.abs(f.x) >= B.halfX - 1e-6, 'barricade blocks re-entry on foot');
  assert.ok(Math.abs(f.x) <= ARENA.stands.innerX + 1e-6, 'and the stands keep them in the moat');
});

test('F vaults back over from the outside', () => {
  const w = live(); const f = w.byId(1);
  f.zone = 'floor'; f.y = 0; f.outside = true; f.x = B.halfX + 0.6; f.z = 0;
  f.input.pressed = BTN.INTERACT;
  w.step();
  settle(w, 60);
  assert.equal(f.outside, false, 'back inside');
  assert.ok(Math.abs(f.x) < B.halfX, 'inside the rail again');
});

test('the outside flag survives the snapshot', () => {
  const w = live(); const f = w.byId(1);
  f.outside = true;
  const dec = decodeFighter(encodeFighter(f));
  assert.equal(dec.outside, true);
});
