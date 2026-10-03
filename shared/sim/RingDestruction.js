// RingDestruction – localized, authoritative ring-canvas damage.
// The fighting area is a RING_GRID×RING_GRID grid of sections. Heavy impacts
// (Ajan's slams / crush) in the same section crack it, then break a hole. A
// wrestler standing over a broken section falls through into a shallow space
// under the ring, takes impact damage, and climbs back out after a moment.
// Everything runs in the authoritative sim so every client agrees.
import { ARENA } from '../config/arena.js';
import { S, RING_GRID, RING_BREAK_HITS, FALL_DEPTH, FALL_RECOVER, FALL_DAMAGE } from './constants.js';
import { setState } from './Fighter.js';

const R = ARENA.ring;
export const EXTENT = R.ropeLine;              // half-size of the playable canvas
export const CELL = (EXTENT * 2) / RING_GRID;  // section size

// states that can't fall through (airborne / held / climbing / out of play)
const NO_FALL = new Set([
  S.AIRBORNE, S.HELD, S.GRAPPLE_VICTIM, S.GRAPPLE_MOVE, S.HOLD, S.PINNED, S.PIN,
  S.KO, S.CLIMB, S.PERCH, S.DIVE, S.APRON, S.CAGE_CLIMB, S.THROWING, S.SPECIAL,
]);

/** Damage level for a raw hit count: 0 intact, 1 cracked, 2 broken (hole). */
export function levelFromHits(h) { return h >= RING_BREAK_HITS ? 2 : (h >= 2 ? 1 : 0); }

/** World x/z of a section's centre. */
export function cellCenter(key) {
  const ix = key % RING_GRID, iz = Math.floor(key / RING_GRID);
  return { x: -EXTENT + (ix + 0.5) * CELL, z: -EXTENT + (iz + 0.5) * CELL };
}

export class RingDestruction {
  constructor(world) {
    this.world = world;
    this.hits = new Array(RING_GRID * RING_GRID).fill(0);
    this.testForce = false; // debug: make breakChance always succeed
  }

  /**
   * Chance-based break at a position (a crush / special slam can smash the ring).
   * Breaks the whole section outright on success. Authoritative RNG.
   * @returns {boolean} whether it broke
   */
  breakChance(x, z, p) {
    const k = this.cellOf(x, z);
    if (k < 0 || this.level(k) === 2) return false;
    if (!this.testForce && Math.random() >= p) return false;
    this.hits[k] = RING_BREAK_HITS;
    const c = cellCenter(k);
    this.world.emit('ring_break', { cell: k, x: c.x, z: c.z });
    return true;
  }

  /** Section index for a world position, or -1 if outside the canvas. */
  cellOf(x, z) {
    if (Math.abs(x) > EXTENT || Math.abs(z) > EXTENT) return -1;
    const ix = Math.min(RING_GRID - 1, Math.max(0, Math.floor((x + EXTENT) / CELL)));
    const iz = Math.min(RING_GRID - 1, Math.max(0, Math.floor((z + EXTENT) / CELL)));
    return iz * RING_GRID + ix;
  }

  level(key) { return key < 0 ? 0 : levelFromHits(this.hits[key]); }
  isBroken(x, z) { return this.level(this.cellOf(x, z)) === 2; }
  encode() { return this.hits.slice(); }

  /** Orthogonal grid neighbours of a section, clamped to the canvas. */
  neighbors(k) {
    const ix = k % RING_GRID, iz = Math.floor(k / RING_GRID), out = [];
    if (ix > 0) out.push(k - 1);
    if (ix < RING_GRID - 1) out.push(k + 1);
    if (iz > 0) out.push(k - RING_GRID);
    if (iz < RING_GRID - 1) out.push(k + RING_GRID);
    return out;
  }

  /** Structural weakness: an unsupported corner/edge section gives way sooner than the centre. */
  weakness(k) {
    const ix = k % RING_GRID, iz = Math.floor(k / RING_GRID);
    const edges = (ix === 0 || ix === RING_GRID - 1 ? 1 : 0) + (iz === 0 || iz === RING_GRID - 1 ? 1 : 0);
    return edges >= 2 ? 1.5 : edges === 1 ? 1.25 : 1; // corner · edge · centre
  }

  /**
   * Register an impact on the section at a position.
   * - With no `force`: adds exactly one hit (legacy / high-drop accumulation path).
   * - With a `force`: scales by the section's structural weakness and sends a
   *   reduced shockwave into neighbours, so heavy slams progressively collapse
   *   the ring from where they land — edges and corners first.
   * @returns {number} the section's damage level (0/1/2) after the impact.
   */
  registerImpact(x, z, force) {
    const k = this.cellOf(x, z);
    if (k < 0 || this.hits[k] >= RING_BREAK_HITS) return this.level(k);
    if (force == null) {                                  // legacy: exactly +1, no weakness/spread
      this.hits[k]++;
      const c = cellCenter(k);
      if (this.hits[k] === 2) this.world.emit('ring_crack', { cell: k, x: c.x, z: c.z });
      if (this.hits[k] === RING_BREAK_HITS) this.world.emit('ring_break', { cell: k, x: c.x, z: c.z });
      return this.level(k);
    }
    return this._apply(k, Math.max(0, force) * this.weakness(k), true);
  }

  /** Apply fractional structural damage to a section, emitting on each level transition. */
  _apply(k, amt, spread) {
    if (k < 0 || this.hits[k] >= RING_BREAK_HITS || amt <= 0) return this.level(k);
    const before = levelFromHits(this.hits[k]);
    this.hits[k] = Math.min(RING_BREAK_HITS, this.hits[k] + amt);
    const after = levelFromHits(this.hits[k]);
    const c = cellCenter(k);
    if (after >= 1 && before < 1) this.world.emit('ring_crack', { cell: k, x: c.x, z: c.z });
    if (after >= 2 && before < 2) this.world.emit('ring_break', { cell: k, x: c.x, z: c.z });
    // shockwave: a strong impact weakens adjacent sections but never breaks them outright
    if (spread && amt >= 1.5) {
      for (const nk of this.neighbors(k)) {
        const room = (RING_BREAK_HITS - 1) - this.hits[nk]; // cap neighbours at "cracked", never broken
        if (room > 0) this._apply(nk, Math.min(amt * 0.4, room), false);
      }
    }
    return after;
  }

  update(dt) {
    if (this.world.match.phase !== 'live') return;
    for (const f of this.world.fighters) {
      if (f.hidden || f.eliminated) continue;
      if (f.noFall > 0) f.noFall -= dt;                 // brief immunity (e.g. the diver who just broke it)
      if (f.underRing) { this.manageFallen(f, dt); continue; }
      if (!f.onGround || f.zone !== 'ring' || NO_FALL.has(f.state)) continue;
      if ((f.noFall || 0) <= 0 && this.isBroken(f.x, f.z)) this.startFall(f);
    }
  }

  startFall(f) {
    this.world.combat.applyEnvDamage(f, FALL_DAMAGE, 'ring_break');
    f.y = R.height - FALL_DEPTH; f.vx = f.vy = f.vz = 0;
    this.world.emit('ring_fall', { fighter: f.id, x: f.x, z: f.z });
    if (f.state === S.KO || f.eliminated) return; // the fall finished them – leave it to the match
    f.underRing = true; f.underRingT = FALL_RECOVER;
    setState(f, S.DOWN); f.downTimer = FALL_RECOVER; f.mash = 0;
  }

  manageFallen(f, dt) {
    f.y = R.height - FALL_DEPTH; f.onGround = true;      // pinned in the hole – never endless
    f.underRingT -= dt * (1 + Math.min(1.5, f.mash * 0.12)); // mashing climbs out faster
    if (f.underRingT <= 0) this.climbOut(f);
  }

  climbOut(f) {
    const t = this.nearestSafe(f.x, f.z);
    f.x = t.x; f.z = t.z; f.y = R.height; f.onGround = true;
    f.underRing = false; f.underRingT = 0;
    setState(f, S.GETUP, 0.6 / f.c.recoverySpeed); f.invuln = 0.4;
    this.world.emit('ring_climb_out', { fighter: f.id, x: f.x, z: f.z });
  }

  /** Nearest non-broken section centre (so climbing out never lands back in a hole). */
  nearestSafe(x, z) {
    let best = null, bd = Infinity;
    for (let k = 0; k < this.hits.length; k++) {
      if (this.level(k) === 2) continue;
      const c = cellCenter(k), d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best || { x: 0, z: 0 };
  }
}
