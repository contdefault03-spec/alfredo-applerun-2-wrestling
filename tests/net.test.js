// Multiplayer + protocol + commentary tests. Spawns the real server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { World } from '../shared/sim/World.js';
import { snapshot, decodeFighter, encodeFighter } from '../shared/net/protocol.js';
import { CommentaryEngine, buildPrompt } from '../shared/commentary/CommentaryEngine.js';

const PORT = 3900 + Math.floor(Math.random() * 90);
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 8000);
    server.stdout.on('data', (d) => { if (String(d).includes('server on')) { clearTimeout(t); res(); } });
  });
});
test.after(() => server?.kill());

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, inbox: [], snaps: [], send: (m) => ws.send(JSON.stringify(m)) };
  c.wait = (pred, ms = 6000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => { const m = c.inbox.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); } }, 15);
  });
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'snap') c.snaps.push(m); else c.inbox.push(m); });
  return new Promise((res) => ws.on('open', () => res(c)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('protocol: fighter encode/decode round-trip', () => {
  const w = new World({ mode: 'normal', fighters: [{ charId: 'ajan', team: 0 }, { charId: 'lucky', team: 1 }] });
  for (let i = 0; i < 30; i++) w.step();
  const f = w.byId(1);
  const d = decodeFighter(encodeFighter(f));
  for (const k of ['x', 'y', 'z', 'yaw']) assert.ok(Math.abs(d[k] - f[k]) < 0.002, k);
  assert.equal(d.state, f.state); assert.equal(d.hp, f.hp); assert.equal(d.zone, f.zone);
  const s = snapshot(w, w.takeEvents(), { seq: 5 });
  assert.ok(JSON.stringify(s).length < 4000, 'compact snapshot');
});

test('health endpoint and config', async () => {
  const h = await (await fetch(`http://localhost:${PORT}/healthz`)).json();
  assert.equal(h.ok, true);
  const c = await (await fetch(`http://localhost:${PORT}/api/config`)).json();
  assert.equal(c.ai, false); // no key → fallback commentary
  const r = await fetch(`http://localhost:${PORT}/api/commentary`, { method: 'POST', body: '{"key":"BIG_HIT"}' });
  assert.equal(r.status, 503);
});

test('friend rooms: create → code → join → start → authoritative sync → disconnect hand-off', async () => {
  const A = await client(), B = await client();
  A.send({ t: 'create', name: 'Alice', charId: 'max' });
  const room = (await A.wait((m) => m.t === 'room')).room;
  assert.match(room.code, /^[A-Z2-9]{5}$/);
  B.send({ t: 'join', code: room.code.toLowerCase(), name: 'Bob', charId: 'rot' });
  await B.wait((m) => m.t === 'room' && m.room.players.length === 2);
  // only the host may change mode / start
  B.send({ t: 'mode', mode: 'cell' });
  await sleep(100);
  A.send({ t: 'mode', mode: 'items' });
  const r2 = await A.wait((m) => m.t === 'room' && m.room.mode === 'items');
  assert.equal(r2.room.hostId, r2.room.players.find((p) => p.name === 'Alice').id);
  A.send({ t: 'start' });
  const sa = await A.wait((m) => m.t === 'start'), sb = await B.wait((m) => m.t === 'start');
  assert.equal(sa.roster.length, 2);
  assert.notEqual(sa.you, sb.you);
  await sleep(5000); // intro (4.5 s)
  const before = A.snaps.at(-1).f.find((f) => f[0] === sb.you);
  let seq = 0;
  for (let i = 0; i < 40; i++) { B.send({ t: 'input', seq: ++seq, mx: 0, mz: -1, held: 0, pressed: 0 }); await sleep(16); }
  B.send({ t: 'input', seq: ++seq, mx: 0, mz: 0, held: 0, pressed: 0 });
  await sleep(250);
  const la = A.snaps.at(-1), lb = B.snaps.at(-1);
  const fa = la.f.find((f) => f[0] === sb.you), fb = lb.f.find((f) => f[0] === sb.you);
  assert.ok(Math.hypot(fa[1] - before[1], fa[3] - before[3]) > 0.5, 'Bob moved (seen by Alice)');
  assert.ok(Math.abs(fa[1] - fb[1]) < 0.3 && Math.abs(fa[3] - fb[3]) < 0.3, 'both clients agree');
  assert.ok(lb.ack.seq >= seq - 2, 'inputs acknowledged');
  // malformed input is ignored safely
  B.send({ t: 'input', seq: 'x', mx: 'NaN', mz: 9999, held: -1, pressed: 1e9 });
  await sleep(100);
  // Bob leaves → AI takes over, match continues
  B.ws.close();
  await sleep(400);
  const lr = A.inbox.filter((m) => m.t === 'room').at(-1);
  assert.equal(lr.room.players.length, 1);
  const n = A.snaps.length; await sleep(300);
  assert.ok(A.snaps.length > n, 'snapshots keep flowing');
  A.ws.close();
});

test('unknown room code is rejected; quick match pairs public players', async () => {
  const A = await client();
  A.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
  const e = await A.wait((m) => m.t === 'error');
  assert.match(e.message, /not found/);
  const B = await client(), C = await client();
  B.send({ t: 'quick', name: 'B' });
  const rb = (await B.wait((m) => m.t === 'room')).room;
  C.send({ t: 'quick', name: 'C' });
  const rc = (await C.wait((m) => m.t === 'room')).room;
  assert.equal(rb.code, rc.code);
  [A, B, C].forEach((c) => c.ws.close());
});

test('commentary engine: meaningful events only, cooldowns, Ajan line', () => {
  const eng = new CommentaryEngine({ nameOf: (id) => ['', 'AJAN', 'LUCKY'][id], charOf: (id) => ['', 'ajan', 'lucky'][id], minGap: 2 });
  let out = eng.update(0.016, [{ type: 'attack', fighter: 1 }, { type: 'jump', fighter: 2 }]);
  assert.equal(out.length, 0, 'no chatter for trivial events');
  out = eng.update(0.016, [{ type: 'AJAN_SPECIAL_HIT', fighter: 1, victims: [2] }, { type: 'hit', attacker: 1, victim: 2, damage: 30, reaction: 'flinch' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'AJAN_SPECIAL_HIT');
  assert.ok(out[0].text.length > 5);
  out = eng.update(0.5, [{ type: 'hit', attacker: 2, victim: 1, damage: 120, reaction: 'knockdown' }]);
  assert.equal(out.length, 0, 'rate limited');
  out = eng.update(2.0, []);
  assert.equal(out.length, 1, 'queued line delivered after the gap');
  const prompt = buildPrompt({ key: 'AJAN_SPECIAL_HIT', ctx: { a: 'AJAN', b: 'LUCKY', aChar: 'ajan' } });
  assert.match(prompt, /AJAN_SPECIAL_HIT/);
});
