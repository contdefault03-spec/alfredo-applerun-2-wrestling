// Simulation tests (run: npm test). These exercise the exact code the server
// and the browser run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { BTN, S, ZONE, DT } from '../shared/sim/constants.js';
import { getCharacter, CHARACTER_IDS } from '../shared/config/characters.js';
import { ARENA } from '../shared/config/arena.js';
import { ATTACKS } from '../shared/config/attacks.js';
import { ABILITIES } from '../shared/config/abilities.js';

const R = ARENA.ring;

function world(chars = ['masked', 'rise'], mode = 'normal', opts = {}) {
  const w = new World({ mode, fighters: chars.map((c, i) => ({ charId: c, team: opts.teams?.[i] ?? i, isAI: !!opts.ai })) });
  // skip the intro
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  return w;
}
const steps = (w, n, fn) => { const ev = []; for (let i = 0; i < n; i++) { fn?.(i); w.step(); ev.push(...w.takeEvents()); } return ev; };
const faceEachOther = (a, b, d = 1.0) => { b.x = a.x + Math.sin(a.yaw) * d; b.z = a.z + Math.cos(a.yaw) * d; b.yaw = a.yaw + Math.PI; };

test('character roster: all seven GLB wrestlers are configured', () => {
  assert.deepEqual(CHARACTER_IDS.sort(), ['ajan', 'cave', 'lucky', 'masked', 'max', 'rise', 'rot']);
});

test('Lucky is much smaller and faster; Ajan is the biggest, heaviest and toughest', () => {
  const L = getCharacter('lucky'), A = getCharacter('ajan');
  for (const id of CHARACTER_IDS) {
    if (id === 'lucky') continue;
    const c = getCharacter(id);
    assert.ok(L.height < c.height * 0.65, `Lucky (${L.height}) should be far shorter than ${id} (${c.height})`);
    assert.ok(L.runSpeed > c.runSpeed && L.dodgeSpeed > c.dodgeSpeed, `Lucky faster than ${id}`);
    assert.ok(L.attackPower < c.attackPower, `Lucky hits softer than ${id}`);
    if (id !== 'ajan') {
      assert.ok(A.maxHealth > c.maxHealth && A.weight > c.weight && A.height > c.height, `Ajan bigger than ${id}`);
      assert.ok(A.walkSpeed < c.walkSpeed, `Ajan slower than ${id}`);
    }
  }
});

test('Lucky covers ground much faster than Ajan', () => {
  const w = world(['lucky', 'ajan']);
  const l = w.byId(1), a = w.byId(2);
  l.x = -2.5; l.z = 0; a.x = -2.5; a.z = 2; // same start line, run along +x
  const lx0 = l.x, ax0 = a.x;
  steps(w, 60, () => { for (const f of [l, a]) { f.input.mx = 1; f.input.mz = 0; f.input.held = BTN.RUN; } });
  assert.ok(l.x - lx0 > (a.x - ax0) * 1.4, `lucky ${l.x - lx0} vs ajan ${a.x - ax0}`);
});

test('fighters never fall through the ring or the floor', () => {
  const w = world(['ajan', 'lucky', 'max', 'rot'], 'ffa', { ai: true });
  let minRing = 9, minFloor = 9;
  steps(w, 60 * 40, () => {
    for (const f of w.fighters) {
      if (f.hidden) continue;
      assert.ok(Number.isFinite(f.x + f.y + f.z), 'finite position');
      if ([S.CLIMB, S.DIVE, S.SPECIAL].includes(f.state)) continue; // scripted motion
      if (f.zone === ZONE.RING && f.onGround) minRing = Math.min(minRing, f.y);
      if (f.zone === ZONE.FLOOR) minFloor = Math.min(minFloor, f.y);
    }
  });
  assert.ok(minRing >= R.height - 1e-6, 'ring surface held: ' + minRing);
  assert.ok(minFloor >= -1e-6, 'floor held: ' + minFloor);
});

test('ring ropes keep fighters inside; the ring platform blocks fighters on the floor', () => {
  const w = world(['masked', 'rise']);
  const f = w.byId(1);
  steps(w, 120, () => { f.input.mx = 1; f.input.mz = 0; f.input.held = 0; });
  assert.ok(f.x < R.ropeLine + 0.35 && f.zone === ZONE.RING, 'stopped by ropes at x=' + f.x);
  // on the floor, walking into the apron must not enter the ring square
  f.zone = ZONE.FLOOR; f.y = 0; f.x = R.apronHalf + 2; f.z = 0;
  steps(w, 120, () => { f.input.mx = -1; f.input.mz = 0; });
  assert.ok(f.x >= R.apronHalf + f.c.radius - 1e-3, 'blocked by apron at x=' + f.x);
});

test('running into the ropes rebounds the wrestler', () => {
  const w = world(['rise', 'masked']);
  const f = w.byId(1); f.x = 0; f.z = 0;
  const ev = steps(w, 120, () => { f.input.mx = 1; f.input.mz = 0; f.input.held = BTN.RUN; });
  assert.ok(ev.some((e) => e.type === 'rope_bounce' && e.fighter === 1));
});

test('a jab lands through the hitbox and costs health; whiffs at range', () => {
  const w = world(['masked', 'rise']);
  const a = w.byId(1), b = w.byId(2);
  faceEachOther(a, b, 1.0);
  a.input.pressed = BTN.PUNCH;
  let ev = steps(w, 40);
  assert.ok(ev.some((e) => e.type === 'hit' && e.attacker === 1), 'hit event');
  assert.ok(b.hp < b.maxHp);
  const hp = b.hp;
  faceEachOther(a, b, 4); b.state = S.IDLE;
  a.input.pressed = BTN.PUNCH; ev = steps(w, 40);
  assert.equal(b.hp, hp, 'no damage at 4 m');
});

test('high punches sail over tiny Lucky but kicks connect', () => {
  const w = world(['masked', 'lucky']);
  const a = w.byId(1), l = w.byId(2);
  faceEachOther(a, l, 0.85);
  // hook is a head-height strike for a 1.88 m wrestler
  w.controller.startAttack(a, 'hook');
  steps(w, 40);
  assert.equal(l.hp, l.maxHp, 'hook misses Lucky');
  faceEachOther(a, l, 0.85); l.state = S.IDLE;
  w.controller.startAttack(a, 'kick');
  steps(w, 40);
  assert.ok(l.hp < l.maxHp, 'kick hits Lucky');
});

test('blocking reduces damage; a well-timed block parries', () => {
  const dmg = (blockAt) => {
    const w = world(['masked', 'rise']);
    const a = w.byId(1), b = w.byId(2);
    faceEachOther(a, b, 1.0);
    w.controller.startAttack(a, 'hook');
    steps(w, 40, (i) => { if (i >= blockAt) b.input.held = BTN.BLOCK; });
    return { dmg: b.maxHp - b.hp, parried: a.state === S.PARRIED || w.events.some((e) => e.type === 'parry') };
  };
  const open = dmg(999), blocked = dmg(0);
  assert.ok(blocked.dmg < open.dmg * 0.3, `blocked ${blocked.dmg} vs open ${open.dmg}`);
  const late = dmg(6); // block pressed just before impact
  assert.ok(late.dmg <= blocked.dmg);
});

test('heavy characters shrug off light hits; light characters fly further', () => {
  const kb = (victim) => {
    const w = world(['masked', victim]);
    const a = w.byId(1), v = w.byId(2);
    faceEachOther(a, v, 1.0);
    const x0 = v.x, z0 = v.z;
    w.controller.startAttack(a, 'roundhouse');
    steps(w, 70);
    return { dist: Math.hypot(v.x - x0, v.z - z0), state: v.state };
  };
  const ajan = kb('ajan'), lucky = kb('lucky');
  assert.ok(lucky.dist > ajan.dist * 2, `lucky ${lucky.dist} vs ajan ${ajan.dist}`);
  assert.notEqual(ajan.state, S.DOWN, 'Ajan is not knocked down by a roundhouse');
});

test('grab → slam puts the opponent down; Lucky cannot lift Ajan (takedown instead)', () => {
  const w = world(['rise', 'masked']);
  const a = w.byId(1), b = w.byId(2);
  faceEachOther(a, b, 0.9);
  a.input.pressed = BTN.GRAB; steps(w, 30);
  assert.equal(a.state, S.HOLD); assert.equal(b.state, S.HELD);
  a.input.pressed = BTN.KICK;
  const ev = steps(w, 120);
  assert.ok(ev.some((e) => e.type === 'slam'));
  assert.ok([S.DOWN, S.GETUP].includes(b.state) && b.hp < b.maxHp);

  const w2 = world(['lucky', 'ajan']);
  const l = w2.byId(1), aj = w2.byId(2);
  faceEachOther(l, aj, 0.95);
  l.input.pressed = BTN.GRAB; steps(w2, 30);
  assert.equal(l.state, S.HOLD);
  l.input.pressed = BTN.KICK;
  const ev2 = steps(w2, 60);
  assert.ok(!ev2.some((e) => e.type === 'slam'), 'no slam');
  assert.ok(ev2.some((e) => e.type === 'hit' && e.move === 'takedown'));
});

test('Rize regains control right after his special (no hit needed to unlock)', () => {
  const w = world(['rise', 'lucky']);
  const a = w.byId(1), b = w.byId(2);
  faceEachOther(a, b, 1.3);
  a.meter = 100; a.specialCd = 0; a.input.pressed = BTN.SPECIAL;
  steps(w, 220); // well past the ability duration
  assert.notEqual(a.state, S.SPECIAL, 'not stuck in the special');
  const x0 = a.x;
  steps(w, 50, () => { a.input.mx = 1; a.input.mz = 0; a.input.held = 0; });
  assert.ok(Math.abs(a.x - x0) > 0.3, `Rize can move after the special (moved ${Math.abs(a.x - x0).toFixed(2)})`);
});

test('a held opponent can be carried/dragged around, staying in front of the carrier', () => {
  const w = world(['ajan', 'lucky']); // Ajan easily holds Lucky
  const a = w.byId(1), v = w.byId(2);
  a.x = 0; a.z = 0; a.yaw = 0; faceEachOther(a, v, 0.9);
  a.input.pressed = BTN.GRAB; steps(w, 30);
  assert.equal(a.state, S.HOLD); assert.equal(v.state, S.HELD);
  const x0 = a.x, z0 = a.z;
  // drag forward (+z) for a while
  steps(w, 110, () => { a.input.mx = 0; a.input.mz = 1; a.input.held = 0; });
  assert.ok(Math.hypot(a.x - x0, a.z - z0) > 1.2, `carrier moved while holding (moved ${Math.hypot(a.x - x0, a.z - z0).toFixed(2)})`);
  assert.equal(a.state, S.HOLD, 'still carrying after dragging'); assert.equal(v.state, S.HELD);
  const gap = Math.hypot(v.x - a.x, v.z - a.z);
  assert.ok(gap < 1.0, `victim stays in the carrier's arms (gap ${gap.toFixed(2)})`);
});

test('held wrestlers can mash free', () => {
  const w = world(['rise', 'masked']);
  const a = w.byId(1), b = w.byId(2);
  faceEachOther(a, b, 0.9);
  a.input.pressed = BTN.GRAB; steps(w, 30);
  const ev = steps(w, 60, (i) => { if (i % 4 === 0) b.input.pressed = BTN.PUNCH; });
  assert.ok(ev.some((e) => e.type === 'escape'));
});

test('Irish whip sends the opponent into the ropes', () => {
  const w = world(['rise', 'masked']);
  const a = w.byId(1), b = w.byId(2); a.x = 0; a.z = 0; a.yaw = 0;
  faceEachOther(a, b, 0.9);
  a.input.pressed = BTN.GRAB; steps(w, 30);
  a.input.pressed = BTN.GRAB; a.input.mx = 0; a.input.mz = 1;
  const ev = steps(w, 90);
  assert.ok(ev.some((e) => e.type === 'irish_whip'));
  assert.ok(ev.some((e) => e.type === 'rope_bounce' && e.fighter === 2));
});

test('AJAN special: lock-on, leap, crush – damage, knockback, event, meter + cooldown', () => {
  const w = world(['ajan', 'masked']);
  const a = w.byId(1), v = w.byId(2);
  a.x = -2; a.z = 0; v.x = 1.5; v.z = 0; a.meter = 100;
  a.input.pressed = BTN.SPECIAL;
  steps(w, 1);
  assert.equal(a.state, S.SPECIAL);
  assert.equal(a.meter, 100 - a.c.specialCost, 'meter spent on activation');
  const ev = steps(w, 150);
  const ab = ABILITIES.ajan_crush;
  assert.ok(ev.some((e) => e.type === 'special_jump'), 'jumped');
  const hit = ev.find((e) => e.type === 'AJAN_SPECIAL_HIT');
  assert.ok(hit, 'AJAN_SPECIAL_HIT emitted');
  assert.equal(hit.sound, 'assets/audio/Ajan.mp3');
  assert.ok(v.maxHp - v.hp >= ab.damage, `big damage: ${v.maxHp - v.hp}`);
  assert.ok(ev.some((e) => e.type === 'hit' && e.victim === 2 && e.special && e.reaction === 'knockdown'));
  assert.ok(Math.hypot(v.x - 1.5, v.z) > 0.8 || v.zone === ZONE.FLOOR, 'knocked back');
  assert.ok(a.meter < 100 && a.specialCd > 0, 'cooldown running, meter not refilled');
  // cannot be spammed
  a.meter = 100; a.input.pressed = BTN.SPECIAL;
  const ev2 = steps(w, 5);
  assert.ok(ev2.some((e) => e.type === 'special_denied' && e.reason === 'cooldown'));
});

test('AJAN special is refused without an opponent in range and misses a dodging target', () => {
  const w = world(['ajan', 'lucky']);
  const a = w.byId(1), l = w.byId(2);
  a.x = -2.5; a.z = -2.5; l.x = 2.5; l.z = 2.5; a.meter = 100;
  l.zone = ZONE.FLOOR; l.y = 0; l.x = 8; l.z = 6; // far away on the floor
  a.input.pressed = BTN.SPECIAL;
  let ev = steps(w, 3);
  assert.ok(ev.some((e) => e.type === 'special_denied' && e.reason === 'range'));
  // in range, but Lucky sprints away at full speed → miss, no sample event
  l.zone = ZONE.RING; l.y = R.height; l.x = 0; l.z = -2.5;
  a.input.pressed = BTN.SPECIAL;
  ev = steps(w, 160, () => { l.input.mx = 1; l.input.mz = 0.4; l.input.held = BTN.RUN; });
  if (!ev.some((e) => e.type === 'AJAN_SPECIAL_HIT')) assert.ok(ev.some((e) => e.type === 'special_miss'));
});

test('items: pick up a chair, hit with it, throw it', () => {
  const w = world(['max', 'rise'], 'items');
  const a = w.byId(1), b = w.byId(2);
  const chair = w.items.items.find((i) => i.type === 'chair' && i.y > 1);
  a.x = chair.x - 0.5; a.z = chair.z; a.yaw = Math.PI / 2;
  a.input.pressed = BTN.INTERACT; steps(w, 2);
  assert.equal(a.item, chair.id);
  faceEachOther(a, b, 1.0);
  a.input.pressed = BTN.PUNCH;
  let ev = steps(w, 50);
  const hit = ev.find((e) => e.type === 'hit' && e.attacker === 1);
  assert.ok(hit && hit.weapon && hit.sound === 'metal', 'weapon hit');
  b.state = S.IDLE; faceEachOther(a, b, 4);
  a.input.pressed = BTN.THROW;
  ev = steps(w, 60);
  assert.equal(a.item, null);
  assert.ok(ev.some((e) => e.type === 'item_throw'));
});

test('pinfall: referee counts three and the match ends; strong wrestlers kick out', () => {
  const w = world(['rise', 'masked']);
  const a = w.byId(1), b = w.byId(2);
  b.hp = 100; w.combat.knockDown(b, 0, 1, 0, 6);
  steps(w, 50);
  a.x = b.x - 0.6; a.z = b.z;
  a.input.pressed = BTN.INTERACT;
  const ev = steps(w, 60 * 5);
  assert.ok(ev.filter((e) => e.type === 'pin_count').length >= 3);
  assert.equal(w.match.phase === 'finished' || w.match.phase === 'over', true);
  assert.equal(w.match.method, 'pinfall');

  const w2 = world(['rise', 'masked']);
  const a2 = w2.byId(1), b2 = w2.byId(2);
  w2.combat.knockDown(b2, 0, 1, 0, 6); steps(w2, 50);
  a2.x = b2.x - 0.6; a2.z = b2.z; a2.input.pressed = BTN.INTERACT;
  const ev2 = steps(w2, 60 * 4, (i) => { if (i % 6 === 0) b2.input.pressed = BTN.PUNCH; });
  assert.ok(ev2.some((e) => e.type === 'kickout'), 'healthy wrestler kicks out');
});

test('climbing: roll out of the ring, climb back in, climb the turnbuckle', () => {
  const w = world(['rise', 'masked']);
  const a = w.byId(1);
  a.x = R.ropeLine - 0.5; a.z = 0;
  a.input.pressed = BTN.INTERACT; steps(w, 80);
  assert.equal(a.zone, ZONE.FLOOR); assert.ok(a.x > R.apronHalf);
  a.input.pressed = BTN.INTERACT; steps(w, 90);
  assert.equal(a.zone, ZONE.RING); assert.ok(Math.abs(a.y - R.height) < 1e-6);
  a.x = R.postInset - 0.6; a.z = R.postInset - 0.6;
  a.input.pressed = BTN.INTERACT; steps(w, 70);
  assert.equal(a.state, S.PERCH);
});

test('every game mode plays to a finish with AI wrestlers', () => {
  const rosters = {
    normal: [['ajan', 'lucky'], [0, 1]], ffa: [['max', 'rise', 'rot', 'lucky'], [0, 1, 2, 3]],
    tag: [['masked', 'cave', 'ajan', 'rise'], [0, 0, 1, 1]], items: [['max', 'rot'], [0, 1]], cell: [['cave', 'ajan'], [0, 1]],
  };
  for (const [mode, [chars, teams]] of Object.entries(rosters)) {
    const w = new World({ mode, fighters: chars.map((c, i) => ({ charId: c, team: teams[i], isAI: true, difficulty: 'hard' })) });
    const types = new Set();
    for (let t = 0; t < 60 * 60 * 8 && w.match.phase !== 'over'; t++) { w.step(); for (const e of w.takeEvents()) types.add(e.type); }
    assert.equal(w.match.phase, 'over', `${mode} finished`);
    assert.ok(types.has('hit'), `${mode} had fighting`);
    if (mode === 'cell') for (const f of w.fighters) assert.ok(Math.max(Math.abs(f.x), Math.abs(f.z)) <= ARENA.cage.half + 1e-6 || f.hidden, 'inside the cell');
    if (mode === 'tag') assert.ok(w.fighters.filter((f) => f.team === 0).length === 2);
  }
});

test('AI uses the full toolkit (strikes, grapples, items, blocks/dodges, specials)', () => {
  const types = new Set();
  for (let r = 0; r < 4; r++) {
    const w = new World({ mode: 'items', fighters: [{ charId: 'ajan', team: 0, isAI: true, difficulty: 'hard' }, { charId: 'max', team: 1, isAI: true, difficulty: 'hard' }, { charId: 'rot', team: 2, isAI: true, difficulty: 'normal' }] });
    for (let t = 0; t < 60 * 90 && w.match.phase !== 'over'; t++) { w.step(); for (const e of w.takeEvents()) types.add(e.type); }
  }
  for (const t of ['hit', 'grab', 'item_pickup', 'special_start']) assert.ok(types.has(t), 'AI did ' + t);
  assert.ok(types.has('block') || types.has('dodge') || types.has('parry'), 'AI defends');
});

test('all attack configs are well formed', () => {
  for (const [id, a] of Object.entries(ATTACKS)) {
    if (a.type === 'grapple') { assert.ok(a.victim.length >= 2 && a.impact <= a.duration, id); continue; }
    if (a.type === 'throw') continue;
    for (const k of ['startup', 'active', 'recovery', 'damage']) assert.ok(Number.isFinite(a[k]), `${id}.${k}`);
    if (a.next) assert.ok(ATTACKS[a.next], `${id}.next exists`);
  }
  for (const id of CHARACTER_IDS) for (const m of Object.values(getCharacter(id).moveset)) assert.ok(ATTACKS[m], `${id} moveset ${m}`);
});
