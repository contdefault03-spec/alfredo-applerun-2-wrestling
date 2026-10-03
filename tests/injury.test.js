// Accumulating injury + blood: limping legs, dead arms, blood that builds up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { S, BTN, DT } from '../shared/sim/constants.js';
import { encodeFighter, decodeFighter } from '../shared/net/protocol.js';

function live(chars = ['max', 'rise']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; }
  return w;
}

test('heavy knockdowns wear the legs down and slow the wrestler', () => {
  const w = live();
  const a = w.byId(1), v = w.byId(2);
  assert.equal(v.injLeg, 0, 'starts uninjured');
  for (let i = 0; i < 6; i++) {
    v.state = S.IDLE; v.invuln = 0;
    w.combat.applyHit(a, v, { damage: 160, reaction: 'knockdown', knockback: 1, move: 'slam', moveName: 'Slam', sound: 'slam' });
  }
  assert.ok(v.injLeg > 0.2, `leg injury accumulated (${v.injLeg.toFixed(2)})`);
  assert.ok(v.bloodLvl > 0.2, `blood built up (${v.bloodLvl.toFixed(2)})`);

  // a hurt leg means less ground covered for the same input
  const run = (f) => {
    f.x = 0; f.z = 0; f.vx = f.vz = 0; f.state = S.IDLE;
    for (let i = 0; i < 60; i++) { f.input.mx = 1; f.input.mz = 0; f.input.held = 0; w.controller.update(f, DT); }
    return Math.abs(f.x);
  };
  const hurtDist = run(v);
  v.injLeg = 0;
  const healthyDist = run(v);
  assert.ok(hurtDist < healthyDist * 0.95, `limping is slower (${hurtDist.toFixed(2)} vs ${healthyDist.toFixed(2)})`);
});

test('a worn-out arm hits softer', () => {
  const w = live();
  const a = w.byId(1), v = w.byId(2);
  const spec = { damage: 100, reaction: 'flinch', knockback: 0, move: 'punch', moveName: 'Jab', sound: 'punch' };
  v.hp = v.maxHp; a.injArm = 0; v.invuln = 0; v.state = S.IDLE;
  w.combat.applyHit(a, v, spec);
  const fresh = v.maxHp - v.hp;

  v.hp = v.maxHp; a.injArm = 1; v.invuln = 0; v.state = S.IDLE;
  w.combat.applyHit(a, v, spec);
  const hurt = v.maxHp - v.hp;
  assert.ok(hurt < fresh, `a dead arm does less damage (${hurt} vs ${fresh})`);
});

test('injury + blood survive the network snapshot', () => {
  const w = live();
  const f = w.byId(1);
  f.injLeg = 0.6; f.injArm = 0.35; f.bloodLvl = 0.8;
  const dec = decodeFighter(encodeFighter(f));
  assert.ok(Math.abs(dec.injLeg - 0.6) < 0.02, 'leg injury round-trips');
  assert.ok(Math.abs(dec.injArm - 0.35) < 0.02, 'arm injury round-trips');
  assert.ok(Math.abs(dec.bloodLvl - 0.8) < 0.02, 'blood level round-trips');
});
