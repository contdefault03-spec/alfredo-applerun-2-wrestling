// ItemSystem – ringside props with simple rigid-body physics:
// pick up, carry, swing, throw, drop, break (tables).
import { ITEMS } from '../config/items.js';
import { ARENA } from '../config/arena.js';
import { S, ZONE } from './constants.js';
import { forwardOf, dist2D, scaleOf, hurtCapsule, pointSegDist } from './Fighter.js';

const RING_H = ARENA.ring.height;
const G = ARENA.gravity;

const SPAWN_SETS = {
  ringside: [
    ['chair', 5.4, -2.2], ['chair', -5.3, 2.8], ['kendo_stick', 4.9, 4.6], ['trash_can', -5.8, -4.4],
    ['table', 5.5, 2.0, Math.PI / 2], ['ring_bell', 2.6, -5.8],
  ],
  lots: [
    ['chair', 5.4, -2.2], ['chair', -5.3, 2.8], ['chair', 1.5, 1.2, 0, true], ['chair', -4.8, -5.5],
    ['kendo_stick', 4.9, 4.6], ['kendo_stick', -1.8, -1.0, 0, true], ['kendo_stick', -6.6, 0.5],
    ['trash_can', -5.8, -4.4], ['trash_can', 6.4, -5.0], ['cone', -2.0, 1.8, 0, true], ['cone', 6.8, 5.2],
    ['table', 5.5, 2.0, Math.PI / 2], ['table', -5.2, -1.2, Math.PI / 2], ['ring_bell', 2.6, -5.8],
  ],
  cell: [
    ['chair', 5.2, -2.2], ['chair', -5.1, 2.8], ['chair', 1.5, 1.2, 0, true], ['kendo_stick', 4.7, 4.6],
    ['kendo_stick', -4.6, -4.8], ['trash_can', -5.4, -4.4], ['trash_can', 5.3, -5.2], ['table', 5.3, 1.6, Math.PI / 2], ['ring_bell', 2.5, -5.5],
  ],
};
const RESPAWN_POOL = ['chair', 'kendo_stick', 'trash_can', 'cone', 'chair', 'ring_bell'];

let NEXT_ITEM = 1000;

export class ItemSystem {
  constructor(world) { this.world = world; this.items = []; this.respawnTimer = 0; }

  get(id) { return this.items.find((i) => i.id === id); }

  spawn(type, x, z, yaw = 0, inRing = false, y = null, vel = null) {
    const cfg = ITEMS[type]; if (!cfg) return null;
    const it = {
      id: NEXT_ITEM++, type, x, y: y ?? (inRing ? RING_H : 0), z, vx: vel?.x ?? 0, vy: vel?.y ?? 0, vz: vel?.z ?? 0,
      yaw, spin: vel ? 6 : 0, roll: 0, holder: null, thrownBy: null, hp: cfg.hp, broken: false, brokenT: 0, radius: cfg.radius, upright: type === 'table',
    };
    this.items.push(it);
    return it;
  }

  spawnSet(kind) {
    const set = SPAWN_SETS[kind];
    if (!set) return;
    for (const [type, x, z, yaw = 0, inRing = false] of set) this.spawn(type, x, z, yaw, inRing);
  }

  /** Items match: fans toss a new prop over the barricade. */
  fanThrow() {
    const alive = this.items.filter((i) => !i.broken).length;
    if (alive > 22) return;
    const type = RESPAWN_POOL[Math.floor(Math.random() * RESPAWN_POOL.length)];
    const side = Math.floor(Math.random() * 4);
    const B = this.world.rules.cage ? ARENA.cage.half - 0.4 : ARENA.barricade.halfX;
    const along = (Math.random() * 2 - 1) * 5;
    const [x, z] = [[B, along], [-B, along], [along, B * 0.85], [along, -B * 0.85]][side];
    const tx = (Math.random() * 2 - 1) * 2, tz = (Math.random() * 2 - 1) * 2;
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    const it = this.spawn(type, x, z, Math.random() * 6, false, 2.6, { x: dx / d * 5.5, y: 5.5, z: dz / d * 5.5 });
    this.world.emit('fan_throw', { item: it.id, type });
  }

  update(dt) {
    const w = this.world;
    if (w.rules.itemRespawn > 0 && w.match.phase === 'live') {
      this.respawnTimer += dt;
      if (this.respawnTimer > w.rules.itemRespawn) { this.respawnTimer = 0; this.fanThrow(); }
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.broken) { it.brokenT += dt; if (it.brokenT > 10) this.items.splice(i, 1); continue; }
      if (it.holder != null) {
        const h = w.byId(it.holder);
        if (!h || h.eliminated || h.item !== it.id) { it.holder = null; continue; }
        const fw = forwardOf(h), sc = scaleOf(h);
        it.x = h.x + fw.x * (h.c.radius + 0.25 * sc); it.z = h.z + fw.z * (h.c.radius + 0.25 * sc);
        it.y = h.y + h.c.height * 0.55; it.yaw = h.yaw; it.vx = it.vy = it.vz = 0;
        continue;
      }
      // physics
      it.vy += G * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      it.roll += it.spin * dt; it.spin *= Math.max(0, 1 - 2 * dt);
      const cfg = ITEMS[it.type];
      const inSq = w.arena.isInsideRingSquare(it.x, it.z);
      let ground = 0;
      if (inSq && it.y > RING_H - 0.35) ground = RING_H;
      else if (it.y < 2.5) {
        const c = w.arena.collide(it, cfg.radius * 0.6, ZONE.FLOOR, dt, false);
        if (c && c.speed > 3) { it.vx *= -0.4; it.vz *= -0.4; w.emit('item_bounce', { item: it.id, pos: { x: it.x, y: it.y, z: it.z }, sound: cfg.sound }); }
      }
      if (it.y <= ground) {
        it.y = ground;
        if (it.vy < -3) { it.vy = -it.vy * cfg.restitution; w.emit('item_bounce', { item: it.id, pos: { x: it.x, y: it.y, z: it.z }, sound: cfg.sound }); }
        else it.vy = 0;
        const fr = Math.max(0, 1 - cfg.friction * dt);
        it.vx *= fr; it.vz *= fr;
        if (Math.hypot(it.vx, it.vz) < 0.3) { it.vx = it.vz = 0; }
        if (it.type === 'table' && it.thrownBy == null && it.vy === 0 && Math.hypot(it.vx, it.vz) < 0.1 && !it.flat) it.upright = true;
      }
      // thrown item hits
      const speed = Math.hypot(it.vx, it.vy, it.vz);
      if (it.thrownBy != null) {
        if (speed < 4) it.thrownBy = null;
        else {
          const a = w.byId(it.thrownBy);
          for (const v of w.fighters) {
            if (!a || v.id === a.id || !w.combat.enemies(a, v)) continue;
            const cap = hurtCapsule(v);
            if (pointSegDist(it.x, it.y, it.z, cap) < cfg.radius + cap.r) {
              const d = Math.hypot(it.vx, it.vz) || 1;
              w.combat.applyHit(a, v, { damage: cfg.throwDamage, knockback: 3.5, launch: 1, reaction: cfg.throwDamage >= 80 ? 'knockdown' : 'stagger', stun: 0.6,
                sound: cfg.sound, weapon: true, move: 'item_throw', moveName: cfg.name + ' Toss', dirX: it.vx / d, dirZ: it.vz / d, crowd: 0.5, hitstop: 0.08 });
              it.vx *= -0.3; it.vz *= -0.3; it.vy = 2; it.thrownBy = null;
              this.damageItem(it, 1);
              break;
            }
          }
        }
      }
    }
  }

  tryPickup(f) {
    if (f.item != null) return false;
    let best = null, bd = 1.35 + f.c.radius;
    for (const it of this.items) {
      if (it.holder != null || it.broken) continue;
      if (Math.abs(it.y - f.y) > 0.8) continue;
      const d = Math.hypot(it.x - f.x, it.z - f.z);
      if (d < bd) { bd = d; best = it; }
    }
    if (!best) return false;
    const cfg = ITEMS[best.type];
    if (cfg.weight > f.c.weight / 14) { this.world.emit('too_heavy', { fighter: f.id, item: best.id }); return false; }
    best.holder = f.id; best.thrownBy = null; best.upright = false; best.flat = false;
    f.item = best.id;
    this.world.emit('item_pickup', { fighter: f.id, item: best.id, itemType: best.type, name: cfg.name });
    return true;
  }

  drop(f, knocked = false) {
    const it = f.item != null ? this.get(f.item) : null;
    f.item = null;
    if (!it) return;
    it.holder = null;
    const fw = forwardOf(f);
    it.vx = fw.x * (knocked ? 2.5 : 0.8) + f.vx * 0.5; it.vz = fw.z * (knocked ? 2.5 : 0.8) + f.vz * 0.5; it.vy = knocked ? 2.5 : 0.5;
    it.spin = knocked ? 8 : 1;
    if (it.type === 'table' && !knocked) { it.upright = true; it.flat = false; }
    this.world.emit('item_drop', { fighter: f.id, item: it.id });
  }

  throwItem(f, tgt) {
    const it = f.item != null ? this.get(f.item) : null;
    if (!it) return;
    const cfg = ITEMS[it.type];
    f.item = null; it.holder = null;
    let dx, dz, dist = 6;
    if (tgt && dist2D(f, tgt) < 14) { dx = tgt.x - f.x; dz = tgt.z - f.z; dist = Math.hypot(dx, dz); dx /= dist; dz /= dist; f.yaw = Math.atan2(dx, dz); }
    else { const fw = forwardOf(f); dx = fw.x; dz = fw.z; }
    const sp = 14 - cfg.mass * 0.3;
    it.vx = dx * sp; it.vz = dz * sp;
    it.vy = 1.5 + Math.min(4, dist * 0.18) + (tgt ? (tgt.y - f.y) * 0.8 : 0);
    it.y = f.y + f.c.height * 0.7; it.spin = 10; it.thrownBy = f.id; it.upright = false;
    // throwing animation (short attack state with no hitbox)
    f.state = S.ATTACK; f.stateTime = 0; f.stateDur = 0.45; f.move = 'item_throw_anim'; f.moveHits = [];
    this.world.emit('item_throw', { fighter: f.id, item: it.id, itemType: it.type });
  }

  canSmash(f) { const it = this.get(f.item); return it && (ITEMS[it.type].twoHanded || it.type === 'ring_bell'); }

  weaponDamage(f, m) {
    const it = this.get(f.item); if (!it) return 30;
    const cfg = ITEMS[it.type];
    if (cfg.breakable) return cfg.breakDamage;
    return Math.round(cfg.swingDamage * (m.id === 'item_smash' ? 1.25 : 1));
  }
  weaponSound(f) { const it = this.get(f.item); return it ? ITEMS[it.type].sound : 'punch'; }

  onWeaponHit(f, v) {
    const it = this.get(f.item); if (!it) return;
    this.damageItem(it, 1, f);
  }

  damageItem(it, n, holder = null) {
    it.hp -= n;
    if (it.hp <= 0 && !it.broken) {
      it.broken = true; it.brokenT = 0;
      if (holder) holder.item = null;
      it.holder = null;
      this.world.emit(it.type === 'table' ? 'table_break' : 'item_break', { item: it.id, itemType: it.type, pos: { x: it.x, y: it.y, z: it.z } });
    }
  }

  /** A body landing hard on an upright table smashes through it. */
  checkTableBreak(f, impact) {
    if (impact < 6) return;
    for (const it of this.items) {
      if (it.type !== 'table' || it.broken || it.holder != null) continue;
      if (Math.abs(it.y - f.y) > 1.2) continue;
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
      const dx = f.x - it.x, dz = f.z - it.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < 1.1 && Math.abs(lz) < 0.65) {
        this.damageItem(it, 99);
        this.world.combat.applyEnvDamage(f, ITEMS.table.breakDamage * 0.6, 'table');
        return true;
      }
    }
    return false;
  }
}
