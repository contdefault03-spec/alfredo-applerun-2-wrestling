// Network protocol – compact snapshot encoding shared by server and client.
// Transport: JSON over WebSocket (works everywhere, incl. Render). Snapshots
// use positional arrays + rounding to keep them small (~1–2 KB at 20 Hz).
import { S } from '../sim/constants.js';
import { getCharacter } from '../config/characters.js';
import { ITEM_IDS } from '../config/items.js';

export const PROTOCOL_VERSION = 3;

const STATES = Object.values(S);
const STATE_CODE = Object.fromEntries(STATES.map((s, i) => [s, i]));
const ZONES = ['ring', 'floor', 'apron'];
const REF_STATES = ['watch', 'count', 'slide', 'signal', 'raise', 'warn', 'down'];

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

// events that clients don't need
const PRIVATE_EVENTS = new Set(['ai_retarget', 'attack_internal']);

export function encodeFighter(f) {
  const flags = (f.onGround ? 1 : 0) | (f.hidden ? 2 : 0) | (f.eliminated ? 4 : 0) | (f.legal ? 8 : 0) | (f.invuln > 0 ? 16 : 0) | (f.ateFood ? 32 : 0) | (f.underRing ? 64 : 0);
  return [f.id, r3(f.x), r3(f.y), r3(f.z), r3(f.yaw), r2(f.vx), r2(f.vy), r2(f.vz), STATE_CODE[f.state] ?? 0, r3(f.stateTime), r3(f.stateDur),
    f.move || 0, typeof f.sub === 'number' ? f.sub : 0, Math.round(f.hp), Math.round(f.stamina), Math.round(f.meter), r2(Math.max(0, f.specialCd)),
    f.item ?? -1, ZONES.indexOf(f.zone), flags, r2(f.tilt || 0), f.target ?? -1, Math.round(f.runTime * 100) / 100];
}

export function decodeFighter(a, prev = null) {
  const o = prev || {};
  o.id = a[0]; o.x = a[1]; o.y = a[2]; o.z = a[3]; o.yaw = a[4]; o.vx = a[5]; o.vy = a[6]; o.vz = a[7];
  o.state = STATES[a[8]]; o.stateTime = a[9]; o.stateDur = a[10]; o.move = a[11] || null; o.sub = a[12];
  o.hp = a[13]; o.stamina = a[14]; o.meter = a[15]; o.specialCd = a[16]; o.item = a[17] >= 0 ? a[17] : null; o.zone = ZONES[a[18]] || 'ring';
  const fl = a[19]; o.onGround = !!(fl & 1); o.hidden = !!(fl & 2); o.eliminated = !!(fl & 4); o.legal = !!(fl & 8); o.invuln = fl & 16 ? 1 : 0; o.ateFood = !!(fl & 32); o.underRing = !!(fl & 64);
  o.tilt = a[20]; o.target = a[21] >= 0 ? a[21] : null; o.runTime = a[22];
  return o;
}

export function encodeItem(it) {
  return [it.id, ITEM_IDS.indexOf(it.type), r3(it.x), r3(it.y), r3(it.z), r2(it.yaw), r2(it.roll), it.holder ?? -1, it.broken ? 1 : 0, it.upright ? 1 : 0];
}
export function decodeItem(a) {
  return { id: a[0], type: ITEM_IDS[a[1]], x: a[2], y: a[3], z: a[4], yaw: a[5], roll: a[6], holder: a[7] >= 0 ? a[7] : null, broken: !!a[8], upright: !!a[9] };
}

export function encodeReferee(r) { return [r3(r.x), r3(r.y), r3(r.z), r2(r.yaw), Math.max(0, REF_STATES.indexOf(r.state)), r.count || 0, r.warnTarget ?? -1]; }
export function decodeReferee(a) { return { x: a[0], y: a[1], z: a[2], yaw: a[3], state: REF_STATES[a[4]], count: a[5], warnTarget: a[6] >= 0 ? a[6] : null }; }

export function encodeMatch(m) {
  return {
    p: m.phase, t: r2(m.timeLeft), w: m.winnerTeam, ws: m.winners, me: m.method,
    pin: m.pin ? [m.pin.pinner, m.pin.victim, m.pin.count] : null,
    en: m.entranceState ? m.entranceState() : null,
  };
}
export function decodeMatch(o) {
  return {
    phase: o.p, timeLeft: o.t, winnerTeam: o.w, winners: o.ws || [], method: o.me,
    pin: o.pin ? { pinner: o.pin[0], victim: o.pin[1], count: o.pin[2] } : null,
    entrance: o.en || null,
  };
}

/** Full snapshot of a World (server side). */
export function snapshot(world, events, ack = {}) {
  return {
    t: 'snap', tick: world.tick, time: r3(world.time),
    f: world.fighters.map(encodeFighter),
    i: world.items.items.map(encodeItem),
    r: encodeReferee(world.match.referee),
    m: encodeMatch(world.match),
    rd: world.ring.encode(),
    ev: events.filter((e) => !PRIVATE_EVENTS.has(e.type)),
    ack,
  };
}

/** Static roster (sent once at match start). */
export function roster(world) {
  return world.fighters.map((f) => ({ id: f.id, charId: f.charId, name: f.name, team: f.team, isAI: f.isAI, ownerId: f.ownerId, maxHp: f.maxHp, difficulty: f.difficulty }));
}

/** Make a client-side fighter object from roster info (adds resolved stats). */
export function clientFighter(info) {
  const c = getCharacter(info.charId);
  return { ...info, c, x: 0, y: 1.2, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'idle', stateTime: 0, stateDur: 0, hp: info.maxHp, maxHp: info.maxHp,
    stamina: c.maxStamina, meter: 0, specialCd: 0, zone: 'ring', onGround: true, runTime: 0, input: { mx: 0, mz: 0, held: 0, pressed: 0 } };
}
