// Out-of-combat health regeneration tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT, S, HEAL_DELAY, HEAL_RATE } from '../shared/sim/constants.js';

function live(chars = ['masked', 'rise']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  return w;
}

test('no regen until the out-of-combat delay has passed', () => {
  const w = live(); const f = w.byId(1);
  f.hp = 500; f.lastHitTime = w.time - (HEAL_DELAY - 2); // hit 8s ago
  const before = f.hp;
  w.step();
  assert.equal(f.hp, before, 'still hurting, no heal yet');
});

test('regen kicks in after the delay, slowly', () => {
  const w = live(); const f = w.byId(1);
  f.hp = 500; f.lastHitTime = w.time - (HEAL_DELAY + 1); // last hit 11s ago
  const before = f.hp;
  w.step();
  const perTick = f.maxHp * HEAL_RATE * DT;
  assert.ok(f.hp > before, 'health is coming back');
  assert.ok(f.hp - before <= perTick + 1e-6, 'and only a slow trickle per tick');

  // ~1 second of regen ≈ HEAL_RATE of max HP
  const start = f.hp;
  for (let i = 0; i < 60; i++) w.step();
  assert.ok(Math.abs((f.hp - start) - f.maxHp * HEAL_RATE) < f.maxHp * HEAL_RATE * 0.1, 'about 2.5% of max HP per second');
});

test('regen never exceeds max HP', () => {
  const w = live(); const f = w.byId(1);
  f.hp = f.maxHp; f.lastHitTime = w.time - 100;
  w.step();
  assert.equal(f.hp, f.maxHp);
  f.hp = f.maxHp - 1; f.lastHitTime = w.time - 100;
  for (let i = 0; i < 600; i++) w.step();
  assert.equal(f.hp, f.maxHp, 'clamps at full');
});

test('taking damage resets the regen timer', () => {
  const w = live(); const f = w.byId(1);
  f.hp = 500; f.lastHitTime = w.time - (HEAL_DELAY + 5);
  w.step();
  assert.ok(f.hp > 500, 'was regenerating');
  // environmental hit must reset the clock
  w.combat.applyEnvDamage(f, 40, 'barricade');
  assert.equal(f.lastHitTime, w.time, 'hit stamped the clock');
  const afterHit = f.hp;
  w.step();
  assert.equal(f.hp, afterHit, 'no regen right after being hit');
});

test('no regen outside the live phase', () => {
  const w = new World({ mode: 'normal', entrances: true, fighters: [{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }] });
  w.step(); // in entrances phase now
  assert.equal(w.match.phase, 'entrances');
  const f = w.byId(1); f.hp = 500; f.lastHitTime = w.time - 100;
  w.step();
  assert.equal(f.hp, 500, 'frozen wrestlers do not heal during entrances');
});

test('a knocked-out wrestler does not regen', () => {
  const w = live(); const f = w.byId(1);
  f.hp = 1; f.state = S.KO; f.lastHitTime = w.time - 100;
  w.step();
  assert.equal(f.hp, 1, 'KO stays down');
});
