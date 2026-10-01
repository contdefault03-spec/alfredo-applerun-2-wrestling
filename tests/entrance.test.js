// Entrance phase + skip-vote tests – authoritative sim logic the server runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { DT } from '../shared/sim/constants.js';
import { encodeMatch, decodeMatch } from '../shared/net/protocol.js';

function makeWorld(fighters, { entrances = true } = {}) {
  return new World({ mode: 'normal', entrances, fighters });
}
const stepN = (w, n) => { for (let i = 0; i < n; i++) w.step(); };
const drain = (w) => w.takeEvents();

test('entrances phase is opt-in', () => {
  const on = makeWorld([{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }], { entrances: true });
  assert.equal(on.match.phase, 'entrances');
  const off = makeWorld([{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }], { entrances: false });
  assert.equal(off.match.phase, 'intro');
});

test('entrance order covers all fighters and the first entrance starts', () => {
  const w = makeWorld([{ charId: 'max', team: 0 }, { charId: 'rise', team: 1 }, { charId: 'lucky', team: 2 }]);
  w.step(); // lazily builds the order + starts entrance 0
  const ev = drain(w);
  assert.equal(w.match.entranceOrder.length, 3);
  assert.equal(w.match.currentEntrant, w.fighters[0].id);
  assert.ok(ev.some((e) => e.type === 'entrance_start' && e.index === 0));
});

test('entrances auto-advance by time, then intro, then live', () => {
  const w = makeWorld([{ charId: 'cave', team: 0 }, { charId: 'rot', team: 1 }], { entrances: true });
  // both AI so no human can vote; must advance purely on the authoritative timer
  w.fighters.forEach((f) => { f.isAI = true; });
  let guard = 0;
  while (w.match.phase !== 'live' && guard++ < 60 * 60 * 3) w.step();
  assert.equal(w.match.phase, 'live');
});

test('all human votes skip the entrance immediately; AI are not counted', () => {
  const w = makeWorld([{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }]);
  w.fighters[1].isAI = true;            // one human, one AI
  w.step(); drain(w);
  assert.equal(w.match.entranceIndex, 0);
  const humanId = w.fighters[0].id;
  const ok = w.match.voteSkipEntrance(humanId);
  assert.equal(ok, true);
  // the only human voted → advances to the next entrance
  assert.equal(w.match.entranceIndex, 1);
});

test('one vote does not skip when two humans are present; votes reset each entrance', () => {
  const w = makeWorld([{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }]);
  w.step(); drain(w);
  const [a, b] = w.fighters;
  w.match.voteSkipEntrance(a.id);
  assert.equal(w.match.entranceIndex, 0, 'still on first entrance after one of two votes');
  // duplicate vote by the same player is ignored
  assert.equal(w.match.voteSkipEntrance(a.id), false);
  assert.equal(w.match.skipVotes.size, 1);
  w.match.voteSkipEntrance(b.id);       // now all humans voted
  assert.equal(w.match.entranceIndex, 1);
  assert.equal(w.match.skipVotes.size, 0, 'votes reset for the new entrance');
});

test('voteSkipEntrance is rejected outside the entrances phase and for AI', () => {
  const w = makeWorld([{ charId: 'masked', team: 0 }, { charId: 'rise', team: 1 }]);
  w.step(); drain(w);
  w.fighters[1].isAI = true;
  assert.equal(w.match.voteSkipEntrance(w.fighters[1].id), false, 'AI cannot vote');
  // skip through both entrances to reach intro/live
  w.match.voteSkipEntrance(w.fighters[0].id); // human → advance to entrance 1 (AI only)
  // entrance 1 has no humans, so it advances on the timer; force by many steps
  let guard = 0; while (w.match.phase === 'entrances' && guard++ < 60 * 60 * 3) w.step();
  assert.notEqual(w.match.phase, 'entrances');
  assert.equal(w.match.voteSkipEntrance(w.fighters[0].id), false, 'no voting once entrances are over');
});

test('snapshot carries entrance state during entrances, null otherwise', () => {
  const w = makeWorld([{ charId: 'ajan', team: 0 }, { charId: 'lucky', team: 1 }]);
  w.step(); drain(w);
  const enc = encodeMatch(w.match);
  assert.ok(enc.en, 'entrance block present');
  const dec = decodeMatch(enc);
  assert.equal(dec.entrance.fighter, w.fighters[0].id);
  assert.equal(dec.entrance.count, 2);
  assert.equal(dec.entrance.need, 2);           // two humans
  assert.equal(dec.phase, 'entrances');

  // once live, there is no entrance block
  w.fighters.forEach((f) => { f.isAI = true; });
  let guard = 0; while (w.match.phase !== 'live' && guard++ < 60 * 60 * 3) w.step();
  assert.equal(encodeMatch(w.match).en, null);
});
