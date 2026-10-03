// Smarter-AI tests: retreat/regroup when badly hurt, and distinct personalities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { S } from '../shared/sim/constants.js';
import { AI_PERSONALITIES, personalityOf } from '../shared/config/ai.js';

function live(chars, diff = 'normal') {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i, isAI: true, difficulty: diff })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  return w;
}

test('a badly hurt AI breaks off and puts distance between itself and a healthy opponent', () => {
  const w = live(['rise', 'ajan']);
  const hurt = w.byId(1), strong = w.byId(2);
  hurt.hp = hurt.maxHp * 0.08;          // nearly finished
  strong.hp = strong.maxHp;             // opponent is fresh
  strong.isAI = false; strong.input.mx = strong.input.mz = 0; strong.input.held = 0; // hold the opponent still
  hurt.x = 0; hurt.z = 0; strong.x = 1.2; strong.z = 0;
  const d0 = Math.hypot(hurt.x - strong.x, hurt.z - strong.z);
  for (let i = 0; i < 200; i++) { strong.x = 1.2; strong.z = 0; w.step(); }
  const d1 = Math.hypot(hurt.x - strong.x, hurt.z - strong.z);
  assert.ok(d1 > d0 + 1.0, `hurt AI retreated (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
  assert.equal(w.byId(1).aiState.mode, 'regroup', 'and is in the regroup state');
});

test('a healthy AI still closes in and fights', () => {
  const w = live(['rise', 'ajan']);
  const a = w.byId(1), b = w.byId(2);
  a.x = 0; a.z = 0; b.x = 5; b.z = 0;
  b.isAI = false; b.input.mx = b.input.mz = 0; b.input.held = 0;
  const d0 = Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 0; i < 200; i++) { b.x = 5; b.z = 0; w.step(); }
  const d1 = Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(d1 < d0, `healthy AI closed the gap (${d0.toFixed(2)} -> ${d1.toFixed(2)})`);
  assert.notEqual(w.byId(1).aiState.mode, 'regroup');
});

test('AI personalities are distinct and every wrestler resolves to one', () => {
  const ids = Object.keys(AI_PERSONALITIES);
  assert.ok(ids.length >= 5, 'several personalities defined');
  const aggrs = new Set(ids.map((i) => AI_PERSONALITIES[i].aggr));
  assert.ok(aggrs.size > 2, 'personalities actually differ in aggression');
  assert.ok(personalityOf('ajan').aggr > personalityOf('lucky').aggr, 'Ajan is more aggressive than Lucky');
  assert.ok(personalityOf('lucky').flee > personalityOf('ajan').flee, 'Lucky disengages sooner than Ajan');
  assert.equal(personalityOf('nope').name, 'Balanced', 'unknown wrestlers fall back to balanced');
});
