// Arena physics queries: ground heights, walls, ropes, corners, cage.
// Everything is analytic (boxes/lines) so it is cheap and identical on the
// server and client (used for client-side prediction too).
import { ARENA } from '../config/arena.js';
import { ZONE } from './constants.js';

const R = ARENA.ring;
export const RING_H = R.height;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class Arena {
  constructor({ cage = false } = {}) {
    this.cage = cage;
  }

  /** Canvas/floor height for an entity in a given zone. */
  groundFor(zone) { return zone === ZONE.FLOOR ? 0 : RING_H; }

  isInsideRingSquare(x, z, pad = 0) {
    return Math.abs(x) < R.apronHalf + pad && Math.abs(z) < R.apronHalf + pad;
  }

  /** Nearest corner post to (x,z) and the distance. */
  nearestCorner(x, z) {
    const cx = Math.sign(x || 1) * R.postInset, cz = Math.sign(z || 1) * R.postInset;
    return { x: cx, z: cz, sx: Math.sign(x || 1), sz: Math.sign(z || 1), dist: Math.hypot(x - cx, z - cz) };
  }

  /** Distance to the closest rope line from inside the ring (positive = inside). */
  ropeGap(x, z) {
    return R.ropeLine - Math.max(Math.abs(x), Math.abs(z));
  }

  /**
   * Resolve a body (circle radius r) against the static world for its zone.
   * Mutates e.x/e.z/e.vx/e.vz. Returns a contact description or null:
   *   { kind: 'rope'|'corner'|'apron'|'barricade'|'cage'|'desk', nx, nz, speed }
   * `ropesSoft` – ropes act as springs (fighters) instead of hard walls.
   */
  collide(e, r, zone, dt, ropesSoft = true) {
    let contact = null;
    const hit = (kind, nx, nz) => {
      const speed = -(e.vx * nx + e.vz * nz); // speed into the wall
      if (!contact || speed > contact.speed) contact = { kind, nx, nz, speed };
    };
    if (zone === ZONE.RING) {
      const lim = R.ropeLine - r * 0.6;
      // corners are posts: treat the square as the limit, report corners separately
      for (const axis of ['x', 'z']) {
        const v = e[axis];
        if (Math.abs(v) > lim) {
          const s = Math.sign(v);
          const nx = axis === 'x' ? -s : 0, nz = axis === 'z' ? -s : 0;
          const other = axis === 'x' ? e.z : e.x;
          const kind = Math.abs(other) > R.ropeLine - R.cornerZone ? 'corner' : 'rope';
          hit(kind, nx, nz);
          const over = Math.abs(v) - lim;
          if (ropesSoft && over < 0.35) {
            // spring: ropes give a little then push back
            const vel = axis === 'x' ? 'vx' : 'vz';
            e[vel] -= s * R.ropeStiffness * over * dt;
            if (Math.sign(e[vel]) === s) e[vel] *= 0.9;
            if (over > 0.3) e[axis] = s * (lim + 0.3);
          } else {
            e[axis] = s * lim;
            const vel = axis === 'x' ? 'vx' : 'vz';
            if (Math.sign(e[vel]) === s) e[vel] = 0;
          }
        }
      }
    } else if (zone === ZONE.APRON) {
      // keep on the apron strip: outside ropes, inside apron edge
      const m = Math.max(Math.abs(e.x), Math.abs(e.z));
      const inner = R.ropeLine + 0.15, outer = R.apronHalf - 0.1;
      if (m < inner || m > outer) {
        const target = clamp(m, inner, outer);
        const k = target / Math.max(m, 1e-3);
        if (Math.abs(e.x) >= Math.abs(e.z)) e.x *= k; else e.z *= k;
      }
    } else {
      // floor: ring platform is a wall
      const lim = R.apronHalf + r;
      if (Math.abs(e.x) < lim && Math.abs(e.z) < lim) {
        const px = lim - Math.abs(e.x), pz = lim - Math.abs(e.z);
        if (px < pz) { const s = Math.sign(e.x || 1); e.x = s * lim; if (Math.sign(e.vx) === -s) { hit('apron', s, 0); e.vx = 0; } }
        else { const s = Math.sign(e.z || 1); e.z = s * lim; if (Math.sign(e.vz) === -s) { hit('apron', 0, s); e.vz = 0; } }
      }
      // commentary desk
      const D = ARENA.desk;
      const dx = D.halfX + r, dz = D.halfZ + r;
      if (Math.abs(e.x - D.x) < dx && Math.abs(e.z - D.z) < dz && (e.y ?? 0) < D.height) {
        const px = dx - Math.abs(e.x - D.x), pz = dz - Math.abs(e.z - D.z);
        if (px < pz) { const s = Math.sign(e.x - D.x || 1); e.x = D.x + s * dx; hit('desk', s, 0); e.vx *= -0.2; }
        else { const s = Math.sign(e.z - D.z || 1); e.z = D.z + s * dz; hit('desk', 0, s); e.vz *= -0.2; }
      }
      if (this.cage) {
        const C = ARENA.cage.half - r;
        const doorHalf = ARENA.cage.doorHalf ?? 1.0;
        if (Math.abs(e.x) > C) { const s = Math.sign(e.x); hit('cage', -s, 0); e.x = s * C; if (Math.sign(e.vx) === s) e.vx = 0; }
        const atDoor = this.cageDoorBroken && Math.abs(e.x) < doorHalf;
        if (e.z > C && !atDoor) { hit('cage', 0, -1); e.z = C; if (e.vz > 0) e.vz = 0; }         // +Z wall (door side)
        else if (e.z < -C) { hit('cage', 0, 1); e.z = -C; if (e.vz < 0) e.vz = 0; }              // -Z wall
        if (atDoor && e.z > C) {                                                                  // walked out the broken door
          const outZ = ARENA.entrance.zEnd - r;
          if (e.z > outZ) { e.z = outZ; if (e.vz > 0) e.vz = 0; }
        }
      } else {
        const B = ARENA.barricade, E = ARENA.entrance, St = ARENA.stands;
        const bx = B.halfX - r, bz = B.halfZ - r, wx = Math.min(E.halfX, B.gapHalf) - r;
        if (e.outside) {
          // in the moat between the barricade and the stands – stay there until they vault back
          const ox = St.innerX - r, oz = St.innerZ - r;   // outer wall (front of the stands)
          const ix = B.halfX + r, iz = B.halfZ + r;        // the rail, from the moat side
          if (Math.abs(e.x) > ox) { const s = Math.sign(e.x); hit('barricade', -s, 0); e.x = s * ox; if (Math.sign(e.vx) === s) e.vx = 0; }
          if (Math.abs(e.z) > oz) { const s = Math.sign(e.z); hit('barricade', 0, -s); e.z = s * oz; if (Math.sign(e.vz) === s) e.vz = 0; }
          // can't walk back in through the rail – push out along the shallower axis
          if (Math.abs(e.x) < ix && Math.abs(e.z) < iz) {
            if (ix - Math.abs(e.x) <= iz - Math.abs(e.z)) { const s = Math.sign(e.x) || 1; e.x = s * ix; if (Math.sign(e.vx) !== s) e.vx = 0; }
            else { const s = Math.sign(e.z) || 1; e.z = s * iz; if (Math.sign(e.vz) !== s) e.vz = 0; }
          }
        } else if (e.z > bz && Math.abs(e.x) < wx) {
          // entrance walkway
          if (e.z > E.zEnd - r) { e.z = E.zEnd - r; if (e.vz > 0) e.vz = 0; }
        } else {
          if (Math.abs(e.x) > bx) { const s = Math.sign(e.x); hit('barricade', -s, 0); e.x = s * bx; if (Math.sign(e.vx) === s) e.vx = 0; }
          if (Math.abs(e.z) > bz) { const s = Math.sign(e.z); hit('barricade', 0, -s); e.z = s * bz; if (Math.sign(e.vz) === s) e.vz = 0; }
        }
      }
    }
    return contact;
  }

  /** Where a fighter on the floor lands when climbing in (inside the ropes). */
  climbInTarget(x, z) {
    const lim = R.ropeLine - 0.55;
    if (Math.abs(x) > Math.abs(z)) return { x: Math.sign(x) * lim, z: clamp(z, -lim, lim) };
    return { x: clamp(x, -lim, lim), z: Math.sign(z) * lim };
  }

  /** Where a fighter rolling out of the ring lands on the floor. */
  rollOutTarget(x, z, r) {
    const out = R.apronHalf + r + 0.35;
    const lim = R.apronHalf - 0.3;
    if (Math.abs(x) > Math.abs(z)) return { x: Math.sign(x) * out, z: clamp(z, -lim, lim) };
    return { x: clamp(x, -lim, lim), z: Math.sign(z) * out };
  }

  /** Distance from a floor position to the apron edge (for climbing in). */
  apronEdgeDist(x, z) {
    const dx = Math.abs(x) - R.apronHalf, dz = Math.abs(z) - R.apronHalf;
    if (dx > 0 && dz > 0) return Math.hypot(dx, dz);
    return Math.max(dx, dz);
  }

  cageWallDist(x, z) {
    return ARENA.cage.half - Math.max(Math.abs(x), Math.abs(z));
  }

  /** Clamp a free item/body into the playable volume (items ignore ropes). */
  collideItem(it, zoneGround) {
    return this.collide(it, it.radius ?? 0.3, zoneGround, 0, false);
  }
}
