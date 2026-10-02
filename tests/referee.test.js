// Referee interference + grab-the-ref tests (authoritative sim).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT, S, REF_WARN_HITS, REF_HEAT_WINDOW, REF_DOWN_TIME, REF_DEATHS } from '../shared/sim/constants.js';
import { encodeReferee, decodeReferee } from '../shared/net/protocol.js';

function live(chars = ['ajan', 'lucky']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  for (const f of w.fighters) { f.isAI = false; f.input.mx = f.input.mz = 0; f.input.held = 0; }
  return w;
}
const drain = (w) => w.takeEvents();

test('beating on a downed opponent increments referee heat', () => {
  const w = live(); const a = w.byId(1), l = w.byId(2);
  a.x = 0; a.z = 0; l.x = 0.5; l.z = 0; l.state = S.DOWN; l.downTimer = 10;
  const before = a.refHeat;
  w.combat.applyHit(a, l, { damage: 15, reaction: 'flinch', knockback: 1, move: 'punch', moveName: 'Jab', sound: 'punch' });
  assert.ok(a.refHeat > before, 'heat went up for hitting a grounded foe');
});

test('the ref steps in after enough ground attacks', () => {
  const w = live(); const a = w.byId(1), l = w.byId(2);
  a.x = 0; a.z = 0; l.x = 0.5; l.z = 0; l.state = S.DOWN; l.downTimer = 10;
  a.refHeat = REF_WARN_HITS; a.refHeatT = w.time;
  w.step();
  const ev = drain(w);
  assert.equal(w.match.referee.state, 'warn');
  assert.equal(w.match.referee.warnTarget, a.id);
  assert.ok(ev.some((e) => e.type === 'ref_warn'), 'ref_warn emitted');
});

test('the ref physically blocks the attacker (interrupt + push)', () => {
  const w = live(); const a = w.byId(1), l = w.byId(2);
  a.x = 0; a.z = 0; l.x = 0.5; l.z = 0; l.state = S.DOWN; l.downTimer = 10;
  a.refHeat = REF_WARN_HITS; a.refHeatT = w.time;
  w.match.referee.x = 0.2; w.match.referee.z = 0; // already right next to the attacker
  let blocked = false;
  for (let i = 0; i < 20 && !blocked; i++) { w.step(); blocked = w.takeEvents().some((e) => e.type === 'ref_block'); }
  assert.ok(blocked, 'ref blocked the beatdown');
  assert.equal(a.refHeat, 0, 'heat cleared once blocked');
});

test('the interfering ref can be grabbed and slammed, then recovers', () => {
  const w = live(); const a = w.byId(1);
  a.x = 0; a.z = 0; a.refHeat = REF_WARN_HITS; a.refHeatT = w.time;
  w.step(); drain(w);
  assert.equal(w.match.referee.state, 'warn');
  w.match.referee.x = a.x; w.match.referee.z = a.z; // in range
  const ok = w.match.grabReferee(a.id);
  assert.equal(ok, true);
  assert.equal(w.match.referee.state, 'grabbed', 'grabbed + lifted first');
  // hold then slam
  for (let i = 0; i < Math.ceil(1.0 / DT); i++) w.step();
  assert.equal(w.match.referee.state, 'down', 'slammed down');
  for (let i = 0; i < Math.ceil(REF_DOWN_TIME / DT) + 10; i++) w.step();
  assert.equal(w.match.referee.state, 'watch', 'ref gets back up');
});

test('grabbing the ref is rejected when not being warned, wrong target, or out of range', () => {
  const w = live(); const a = w.byId(1), l = w.byId(2);
  assert.equal(w.match.grabReferee(a.id), false, 'no grab while ref just watches');
  a.x = 0; a.z = 0; a.refHeat = REF_WARN_HITS; a.refHeatT = w.time; w.step(); drain(w);
  assert.equal(w.match.referee.state, 'warn');
  assert.equal(w.match.grabReferee(l.id), false, 'only the warned wrestler can grab');
  w.match.referee.x = 20; w.match.referee.z = 20;
  assert.equal(w.match.grabReferee(a.id), false, 'must be in range');
});

test('ground-attack heat decays, so stale heat does not trigger', () => {
  const w = live(); const a = w.byId(1);
  a.refHeat = REF_WARN_HITS; a.refHeatT = w.time - (REF_HEAT_WINDOW + 1); // old
  w.step();
  assert.equal(w.match.referee.state, 'watch', 'stale heat is ignored');
});

test('the ref is out for good after enough slams', () => {
  const w = live(); const a = w.byId(1); const ref = w.match.referee;
  for (let s = 0; s < REF_DEATHS; s++) {
    if (ref.state === 'down') { ref.downT = 0; w.step(); } // let him get back up
    a.refHeat = REF_WARN_HITS; a.refHeatT = w.time; w.step();
    assert.equal(ref.state, 'warn', 'warn on slam ' + s);
    ref.x = a.x; ref.z = a.z;
    assert.equal(w.match.grabReferee(a.id), true);
    for (let i = 0; i < Math.ceil(1.0 / DT); i++) w.step(); // grab -> lift -> slam
  }
  assert.equal(w.match.referee.dead, true, 'ref is dead');
  // never recovers
  for (let i = 0; i < Math.ceil(REF_DOWN_TIME / DT) + 60; i++) w.step();
  assert.equal(w.match.referee.state, 'down', 'stays down for the rest of the match');
});

test('referee warn state + warnTarget survive the snapshot', () => {
  const w = live(); const a = w.byId(1);
  a.x = 0; a.z = 0; a.refHeat = REF_WARN_HITS; a.refHeatT = w.time; w.step();
  const dec = decodeReferee(encodeReferee(w.match.referee));
  assert.equal(dec.state, 'warn');
  assert.equal(dec.warnTarget, a.id);
});
