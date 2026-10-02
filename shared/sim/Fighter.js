// Fighter – plain data object (easy to snapshot) + helpers.
import { getCharacter } from '../config/characters.js';
import { S, ZONE } from './constants.js';

let NEXT_ID = 1;

export function createFighter({ id, charId, team = 0, name, isAI = false, difficulty = 'normal', ownerId = null, x = 0, z = 0, yaw = 0, zone = ZONE.RING }) {
  const c = getCharacter(charId);
  return {
    id: id ?? NEXT_ID++,
    charId: c.id, name: name || c.name, team, isAI, difficulty, ownerId,
    c,                       // resolved character stats (not networked – derived from charId)
    x, y: zone === ZONE.FLOOR ? 0 : 1.2, z, vx: 0, vy: 0, vz: 0, yaw,
    zone, onGround: true,
    state: S.IDLE, stateTime: 0, stateDur: 0, sub: 0, // `sub` = state-specific phase / variant
    move: null,              // attack/ability id currently executing
    moveHits: [],            // ids already hit by the current move
    combo: 0, comboTimer: 0, queued: null,
    hp: c.maxHealth, maxHp: c.maxHealth,
    stamina: c.maxStamina, staminaDelay: 0,
    meter: 0, specialCd: 0, dodgeCd: 0,
    hitstop: 0, invuln: 0, armor: 0,
    downTimer: 0, mash: 0,
    holding: null,           // fighter id held in a grapple
    heldBy: null,
    gstrikes: 0,
    item: null,              // held item id
    target: null,            // current focus opponent id
    lastHitBy: null, lastHitTime: -99,
    eliminated: false, hidden: false,
    underRing: false, underRingT: 0, // fallen through a broken ring section
    refHeat: 0, refHeatT: -99,       // "attacking a downed foe" heat for ref interference
    outside: false,                  // vaulted beyond the ringside barricade
    legal: true,             // tag-team legality
    input: { mx: 0, mz: 0, held: 0, pressed: 0, seq: 0 },
    aiState: null,           // AI brain (server/local only)
    stats: { damage: 0, hits: 0, specials: 0 },
    // transient movement helpers
    lockDir: null,           // forced direction (whips, rebounds)
    path: null,              // scripted motion {x0,y0,z0,x1,y1,z1,t,dur,arc,zone}
    runTime: 0,
    lastComeback: -99,
    moveSpeed: 0,
    ringDist: 0,
  };
}

export function setState(f, state, dur = 0, move = null) {
  f.state = state; f.stateTime = 0; f.stateDur = dur; f.move = move; f.moveHits = []; f.sub = 0;
}

export function hpFrac(f) { return f.hp / f.maxHp; }

export function scaleOf(f) { return f.c.height / 1.8; }

export function forwardOf(f) { return { x: Math.sin(f.yaw), z: Math.cos(f.yaw) }; }

export function isAlive(f) { return !f.eliminated && f.state !== S.KO; }

export function angleTo(f, x, z) { return Math.atan2(x - f.x, z - f.z); }

export function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export function turnToward(f, yaw, maxStep) {
  const d = wrapAngle(yaw - f.yaw);
  f.yaw = wrapAngle(f.yaw + Math.max(-maxStep, Math.min(maxStep, d)));
}

export function dist2D(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Capsule of a fighter: standing vertical, or lying along its yaw when down. */
export function hurtCapsule(f) {
  const r = f.c.radius, h = f.c.height;
  const lying = f.state === S.DOWN || f.state === S.PINNED || f.state === S.KO || f.state === S.KNOCKDOWN && f.stateTime > 0.35 || f.state === S.GRAPPLE_VICTIM;
  if (lying) {
    const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    const half = h * 0.4;
    return { ax: f.x + fx * half, ay: f.y + r * 0.5, az: f.z + fz * half, bx: f.x - fx * half, by: f.y + r * 0.5, bz: f.z - fz * half, r: r * 0.9 };
  }
  const crouch = f.state === S.DODGE ? 0.6 : 1;
  return { ax: f.x, ay: f.y + r, az: f.z, bx: f.x, by: f.y + Math.max(r, h * crouch - r * 0.6), bz: f.z, r };
}

/** Squared distance between point and segment. */
export function pointSegDist(px, py, pz, c) {
  const abx = c.bx - c.ax, aby = c.by - c.ay, abz = c.bz - c.az;
  const apx = px - c.ax, apy = py - c.ay, apz = pz - c.az;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
