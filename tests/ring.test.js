// Ring destruction + fall-through tests (authoritative sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT, S, FALL_RECOVER, RING_BREAK_HITS } from '../shared/sim/constants.js';
import { ARENA } from '../shared/config/arena.js';
import { encodeFighter, decodeFighter, snapshot } from '../shared/net/protocol.js';

const R = ARENA.ring;
function live(chars = ['ajan', 'lucky']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; }
  return w;
}
const place = (f, x, z) => { f.x = x; f.z = z; f.zone = 'ring'; f.onGround = true; f.state = S.IDLE; };

test('impacts crack then break a single section, localized', () => {
  const w = live();
  assert.equal(w.ring.isBroken(0, 0), false);
  w.ring.registerImpact(0, 0); // 1st: still intact
  assert.equal(w.ring.level(w.ring.cellOf(0, 0)), 0);
  let ev = w.takeEvents();
  w.ring.registerImpact(0, 0); // 2nd: cracked
  assert.equal(w.ring.level(w.ring.cellOf(0, 0)), 1);
  ev = w.takeEvents();
  assert.ok(ev.some((e) => e.type === 'ring_crack'), 'crack event');
  w.ring.registerImpact(0, 0); // 3rd: broken
  assert.ok(w.ring.isBroken(0, 0));
  ev = w.takeEvents();
  assert.ok(ev.some((e) => e.type === 'ring_break'), 'break event');
  // a different section is untouched
  assert.equal(w.ring.isBroken(R.ropeLine - 0.2, R.ropeLine - 0.2), false);
});

test('impacts outside the canvas are ignored, and never exceed broken', () => {
  const w = live();
  w.ring.registerImpact(99, 99);
  assert.deepEqual(w.ring.encode().filter((h) => h > 0), []);
  for (let i = 0; i < 10; i++) w.ring.registerImpact(0, 0);
  assert.equal(w.ring.hits[w.ring.cellOf(0, 0)], RING_BREAK_HITS, 'capped at break threshold');
});

test('a wrestler over a hole falls through, takes damage, then climbs out', () => {
  const w = live();
  for (let i = 0; i < RING_BREAK_HITS; i++) w.ring.registerImpact(0, 0);
  const f = w.byId(2);
  place(f, 0, 0);
  const hp0 = f.hp;
  w.step();
  assert.equal(f.underRing, true, 'fell through');
  assert.ok(f.hp < hp0, 'took fall damage');
  assert.ok(f.y < R.height, 'dropped below the canvas');
  assert.ok(f.y > R.height - 3, 'but not endlessly – pinned in the under-ring space');
  // wait out the recovery
  for (let i = 0; i < Math.ceil(FALL_RECOVER / DT) + 10; i++) w.step();
  assert.equal(f.underRing, false, 'climbed back out');
  assert.ok(Math.abs(f.y - R.height) < 0.05, 'back on the canvas');
  assert.equal(w.ring.isBroken(f.x, f.z), false, 'does not land back in the hole');
});

test('cracked (not broken) sections do not drop anyone', () => {
  const w = live();
  w.ring.registerImpact(0, 0); w.ring.registerImpact(0, 0); // cracked only
  const f = w.byId(2); place(f, 0, 0);
  w.step();
  assert.equal(f.underRing, false);
});

test('no fall-through outside the live phase', () => {
  const w = new World({ mode: 'normal', entrances: true, fighters: [{ charId: 'ajan', team: 0 }, { charId: 'lucky', team: 1 }] });
  w.step();
  assert.equal(w.match.phase, 'entrances');
  for (let i = 0; i < RING_BREAK_HITS; i++) w.ring.registerImpact(0, 0);
  const f = w.byId(2); place(f, 0, 0);
  w.step();
  assert.equal(f.underRing, false, 'frozen wrestlers do not fall during entrances');
});

test('breakChance smashes a section outright (forced), and respects probability', () => {
  const w = live();
  const k = w.ring.cellOf(0, 0);
  // p=0 never breaks
  for (let i = 0; i < 50; i++) assert.equal(w.ring.breakChance(0, 0, 0), false);
  assert.equal(w.ring.level(k), 0);
  // testForce guarantees a break (used for the screenshot test)
  w.ring.testForce = true;
  assert.equal(w.ring.breakChance(0, 0, 0), true);
  assert.ok(w.ring.isBroken(0, 0));
  // already broken → no-op
  assert.equal(w.ring.breakChance(0, 0, 1), false);
});

test('underRing + ring damage survive the network snapshot', () => {
  const w = live();
  for (let i = 0; i < RING_BREAK_HITS; i++) w.ring.registerImpact(0, 0);
  const f = w.byId(2); place(f, 0, 0); w.step();
  assert.equal(f.underRing, true);
  const dec = decodeFighter(encodeFighter(f));
  assert.equal(dec.underRing, true, 'underRing flag round-trips');
  const snap = snapshot(w, [], {});
  assert.ok(Array.isArray(snap.rd), 'ring damage array is in the snapshot');
  assert.equal(snap.rd[w.ring.cellOf(0, 0)], RING_BREAK_HITS);
});
