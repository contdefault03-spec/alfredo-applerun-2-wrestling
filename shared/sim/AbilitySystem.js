// AbilitySystem – character specials (meter + cooldown managed).
import { ABILITIES } from '../config/abilities.js';
import { ARENA } from '../config/arena.js';
import { S, ZONE, FREE_STATES } from './constants.js';
import { setState, forwardOf, dist2D, angleTo, turnToward, scaleOf, isAlive } from './Fighter.js';

const R = ARENA.ring;

export class AbilitySystem {
  constructor(world) { this.world = world; }

  ability(f) { return f.c.special ? ABILITIES[f.c.special] : null; }

  /** UI/AI helper: can the special be used right now? */
  status(f, tgt = null) {
    const ab = this.ability(f);
    if (!ab) return { ready: false, reason: 'none' };
    if (f.specialCd > 0) return { ready: false, reason: 'cooldown', cd: f.specialCd };
    if (f.meter < f.c.specialCost) return { ready: false, reason: 'meter' };
    if (ab.kind === 'leap_crush' || ab.kind === 'blitz') {
      tgt = tgt || this.world.controller.targetOf(f);
      const d = tgt ? dist2D(f, tgt) : 99;
      if (!tgt || d > ab.maxRange || d < (ab.minRange ?? 0)) return { ready: false, reason: 'range', inRange: false };
    }
    return { ready: true, inRange: true };
  }

  tryActivate(f, tgt) {
    const w = this.world;
    const ab = this.ability(f);
    if (!ab || !FREE_STATES.has(f.state) || !f.onGround) return false;
    const st = this.status(f, tgt);
    if (!st.ready) { w.emit('special_denied', { fighter: f.id, reason: st.reason }); return false; }
    if (ab.kind === 'grapple') {
      // auto-grab if close enough, otherwise refuse
      if (!tgt || dist2D(f, tgt) > ab.grabRange + f.c.radius + tgt.c.radius || !w.grapple.grabbable(tgt) || tgt.zone !== f.zone) {
        w.emit('special_denied', { fighter: f.id, reason: 'range' }); return false;
      }
      f.yaw = angleTo(f, tgt.x, tgt.z);
      w.grapple.link(f, tgt);
      return this.tryGrappleSpecial(f, tgt);
    }
    this.pay(f, ab);
    setState(f, S.SPECIAL, 0, ab.id);
    f.sp = { target: tgt?.id ?? null, hits: 0, phase: 0, t: 0, done: {} };
    if (tgt) f.yaw = angleTo(f, tgt.x, tgt.z);
    f.armor = 0.5;
    w.emit('special_start', { fighter: f.id, ability: ab.id, name: ab.name, target: tgt?.id ?? null, camera: ab.camera || null });
    return true;
  }

  pay(f, ab) {
    f.meter -= f.c.specialCost; f.specialCd = f.c.specialCooldown; f.stats.specials++;
  }

  tryGrappleSpecial(f, v) {
    const ab = this.ability(f);
    if (!ab || ab.kind !== 'grapple') return false;
    if (f.specialCd > 0 || f.meter < f.c.specialCost) { this.world.emit('special_denied', { fighter: f.id, reason: f.specialCd > 0 ? 'cooldown' : 'meter' }); return false; }
    this.pay(f, ab);
    this.world.grapple.startMove(f, v, ab.move);
    f.moveSpecial = { id: ab.id, name: ab.name, damage: ab.damage };
    this.world.emit('special_start', { fighter: f.id, ability: ab.id, name: ab.name, target: v.id });
    return true;
  }

  update(f, dt) {
    const ab = ABILITIES[f.move];
    if (!ab) { setState(f, S.IDLE); return; }
    this[ab.kind](f, ab, dt);
  }

  target(f) {
    const t = f.sp.target != null ? this.world.byId(f.sp.target) : null;
    return t && isAlive(t) ? t : null;
  }

  hit(f, v, spec) {
    return this.world.combat.applyHit(f, v, { special: true, unblockable: true, hitstop: 0.1, crowd: 0.6, ...spec });
  }

  // ── AJAN: jump on the opponent and crush them ──
  leap_crush(f, ab, dt) {
    const w = this.world, t = f.stateTime;
    const tgt = this.target(f);
    if (f.sp.phase === 0) {
      f.vx = f.vz = 0; f.armor = 0.2;
      if (tgt) turnToward(f, angleTo(f, tgt.x, tgt.z), 8 * dt);
      if (t >= ab.lockTime) {
        const lx = tgt ? tgt.x + tgt.vx * 0.25 : f.x + forwardOf(f).x * 4;
        const lz = tgt ? tgt.z + tgt.vz * 0.25 : f.z + forwardOf(f).z * 4;
        f.path = { x0: f.x, y0: f.y, z0: f.z, x1: lx, z1: lz, zone: tgt ? tgt.zone : f.zone };
        f.sp.phase = 1; f.sub = 1; f.sp.t = 0; f.onGround = false; f.invuln = ab.airTime;
        w.emit('special_jump', { fighter: f.id, ability: ab.id, pos: { x: f.x, y: f.y, z: f.z } });
      }
      return;
    }
    if (f.sp.phase === 1) {
      f.sp.t += dt;
      const p = f.path;
      const u = Math.min(1, f.sp.t / ab.airTime);
      // limited homing so it lands reliably but can still be dodged late
      if (tgt && u < 0.7) {
        const dx = tgt.x - p.x1, dz = tgt.z - p.z1, d = Math.hypot(dx, dz);
        const step = Math.min(d, 4.5 * dt);
        if (d > 1e-3) { p.x1 += dx / d * step; p.z1 += dz / d * step; }
        p.zone = tgt.zone;
      }
      this.clampLanding(p, f.c.radius);
      const g = w.arena.groundFor(p.zone);
      f.x = p.x0 + (p.x1 - p.x0) * u; f.z = p.z0 + (p.z1 - p.z0) * u;
      f.y = p.y0 + (g - p.y0) * u + 4 * ab.peakHeight * u * (1 - u);
      f.vx = f.vy = f.vz = 0;
      f.yaw = Math.atan2(p.x1 - p.x0, p.z1 - p.z0) || f.yaw;
      if (u >= 1) {
        f.zone = p.zone; f.y = g; f.onGround = true; f.path = null;
        f.sp.phase = 2; f.sub = 2; f.stateTime = 0;
        this.crushImpact(f, ab);
      }
      return;
    }
    // recovery
    f.vx = f.vz = 0;
    if (f.stateTime >= ab.recovery) setState(f, S.IDLE);
  }

  clampLanding(p, r) {
    if (p.zone === ZONE.RING) {
      const lim = R.ropeLine - r * 0.8;
      p.x1 = Math.max(-lim, Math.min(lim, p.x1)); p.z1 = Math.max(-lim, Math.min(lim, p.z1));
    } else if (this.world.arena.isInsideRingSquare(p.x1, p.z1, r)) {
      const out = R.apronHalf + r;
      if (Math.abs(p.x1) > Math.abs(p.z1)) p.x1 = Math.sign(p.x1 || 1) * out; else p.z1 = Math.sign(p.z1 || 1) * out;
    }
  }

  crushImpact(f, ab) {
    const w = this.world;
    const sc = Math.max(1, scaleOf(f));
    const victims = [];
    for (const v of w.fighters) {
      if (!w.combat.enemies(f, v) || !isAlive(v) || v.zone !== f.zone) continue;
      const d = Math.hypot(v.x - f.x, v.z - f.z);
      const dx = (v.x - f.x) / (d || 1), dz = (v.z - f.z) / (d || 1);
      if (d < ab.radius * sc * 0.75 + v.c.radius) {
        const ok = this.hit(f, v, { damage: ab.damage, knockback: ab.knockback, launch: ab.launch, reaction: 'knockdown', downTime: ab.downTime,
          sound: 'heavy', move: ab.id, moveName: ab.name, dirX: dx || Math.sin(f.yaw), dirZ: dz || Math.cos(f.yaw), crowd: 1, hitstop: 0.16 });
        if (ok) victims.push(v.id);
        w.items.checkTableBreak(v, 12);
      } else if (d < ab.splashRadius * sc + v.c.radius) {
        this.hit(f, v, { damage: ab.splashDamage, knockback: ab.knockback * 0.6, launch: 2, reaction: 'knockdown', sound: 'heavy', move: ab.id + '_splash',
          moveName: 'Shockwave', dirX: dx, dirZ: dz, crowd: 0.3 });
      }
    }
    w.items.checkTableBreak(f, 12);
    const pos = { x: f.x, y: f.y, z: f.z };
    w.emit('impact', { fighter: f.id, pos, power: 1.0, ring: f.zone === ZONE.RING });
    if (victims.length) {
      // the event the client uses to play Ajan.mp3 + the cinematic camera
      w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims, pos, sound: ab.sound, event: ab.hitEvent, damage: ab.damage });
      w.emit(ab.hitEvent, { fighter: f.id, victims, pos, sound: ab.sound });
    } else {
      w.emit('special_miss', { fighter: f.id, ability: ab.id, pos });
    }
  }

  // ── MAX: iron barrage ──
  barrage(f, ab, dt) {
    const w = this.world, t = f.stateTime, fw = forwardOf(f);
    const tgt = this.target(f);
    if (t < 0.16) { f.vx = fw.x * ab.dash; f.vz = fw.z * ab.dash; if (tgt) turnToward(f, angleTo(f, tgt.x, tgt.z), 10 * dt); }
    else { f.vx *= 0.8; f.vz *= 0.8; if (tgt && dist2D(f, tgt) > f.c.radius + tgt.c.radius + 0.35) { f.vx = fw.x * 2; f.vz = fw.z * 2; } }
    f.armor = 0.2;
    const hb = w.combat.hitboxOf(f, { reach: ab.reach, height: 0.72, hitRadius: ab.hitRadius });
    const strike = (key, spec) => {
      if (f.sp.done[key]) return; f.sp.done[key] = true;
      for (const v of w.fighters) {
        if (!w.combat.enemies(f, v) || !isAlive(v) || !w.combat.overlaps(hb, v)) continue;
        const ok = this.hit(f, v, { ...spec, dirX: fw.x, dirZ: fw.z, pos: hb, move: ab.id, moveName: ab.name, sound: ab.sound, weapon: true });
        if (ok && key === 'fin') w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims: [v.id], pos: hb, damage: spec.damage });
      }
      w.emit('attack', { fighter: f.id, move: ab.id });
    };
    ab.hits.forEach((ht, i) => { if (t >= ht) strike('h' + i, { damage: ab.hitDamage, knockback: 0.6, reaction: 'flinch', stun: 0.45, hitstop: 0.05, crowd: 0.15 }); });
    if (t >= ab.finisherAt) strike('fin', { damage: ab.finisherDamage, knockback: ab.knockback, launch: ab.launch, reaction: 'knockdown', hitstop: 0.16, crowd: 1 });
    if (t >= ab.duration) setState(f, S.IDLE);
  }

  // ── LUCKY: clover blitz ──
  blitz(f, ab, dt) {
    const w = this.world, t = f.stateTime;
    const tgt = this.target(f);
    f.invuln = 0.1;
    if (!tgt) { if (t > 0.3) setState(f, S.IDLE); return; }
    f.zone = tgt.zone;
    const ring = (f.c.radius + tgt.c.radius) + 0.35;
    if (f.sp.phase === 0) {
      if (!f.sp.start) f.sp.start = { x: f.x, z: f.z, a: Math.atan2(f.x - tgt.x, f.z - tgt.z) };
      const u = Math.min(1, t / 0.2);
      const tx = tgt.x + Math.sin(f.sp.start.a) * ring, tz = tgt.z + Math.cos(f.sp.start.a) * ring;
      f.x = f.sp.start.x + (tx - f.sp.start.x) * u; f.z = f.sp.start.z + (tz - f.sp.start.z) * u;
      f.y = w.arena.groundFor(f.zone);
      if (u >= 1) { f.sp.phase = 1; f.sub = 1; f.sp.ang = f.sp.start.a; f.sp.next = 0; }
      f.vx = f.vz = 0;
      return;
    }
    f.sp.ang += dt * 9;
    f.x = tgt.x + Math.sin(f.sp.ang) * ring; f.z = tgt.z + Math.cos(f.sp.ang) * ring;
    f.y = w.arena.groundFor(f.zone);
    f.vx = f.vz = 0;
    f.yaw = angleTo(f, tgt.x, tgt.z);
    f.sp.next -= dt;
    if (f.sp.next <= 0 && f.sp.hits < ab.hits) {
      f.sp.next = ab.hitInterval; f.sp.hits++;
      const last = f.sp.hits === ab.hits;
      const dx = tgt.x - f.x, dz = tgt.z - f.z, d = Math.hypot(dx, dz) || 1;
      const ok = this.hit(f, tgt, last
        ? { damage: ab.finisherDamage, knockback: ab.knockback, launch: ab.launch, reaction: 'knockdown', dirX: dx / d, dirZ: dz / d, sound: ab.sound, move: ab.id, moveName: ab.name, crowd: 1 }
        : { damage: ab.hitDamage, knockback: 0.3, reaction: 'flinch', stun: 0.5, dirX: dx / d, dirZ: dz / d, sound: 'punch', move: ab.id, moveName: ab.name, hitstop: 0.04, crowd: 0.15 });
      w.emit('attack', { fighter: f.id, move: ab.id });
      if (ok && last) w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims: [tgt.id], pos: { x: tgt.x, y: tgt.y + 1, z: tgt.z }, damage: ab.finisherDamage });
    }
    if (t >= ab.duration) { f.invuln = 0.3; setState(f, S.IDLE); }
  }

  // ── RISE: rising uppercut ──
  launcher(f, ab, dt) {
    const w = this.world, t = f.stateTime, fw = forwardOf(f);
    const tgt = this.target(f);
    if (t < ab.startup) { f.vx = f.vz = 0; if (tgt) turnToward(f, angleTo(f, tgt.x, tgt.z), 8 * dt); return; }
    if (!f.sp.done.jump) { f.sp.done.jump = true; f.vy = ab.selfLift; f.onGround = false; f.vx = fw.x * 2.5; f.vz = fw.z * 2.5; }
    if (t < ab.startup + 0.2) {
      const hb = w.combat.hitboxOf(f, { reach: ab.reach, height: 0.65, hitRadius: ab.hitRadius });
      for (const v of w.fighters) {
        if (f.moveHits.includes(v.id) || !w.combat.enemies(f, v) || !isAlive(v) || !w.combat.overlaps(hb, v)) continue;
        f.moveHits.push(v.id);
        const ok = this.hit(f, v, { damage: ab.damage, knockback: ab.knockback, launch: ab.launch, reaction: 'launch', dirX: fw.x, dirZ: fw.z, pos: hb, sound: ab.sound, move: ab.id, moveName: ab.name, crowd: 1, hitstop: 0.14 });
        if (ok) w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims: [v.id], pos: hb, damage: ab.damage });
      }
    }
    if (t >= ab.duration && f.onGround) setState(f, S.IDLE);
  }

  // ── CAVE: spear ──
  spear(f, ab, dt) {
    const w = this.world, t = f.stateTime, fw = forwardOf(f);
    const tgt = this.target(f);
    if (t < ab.startup) { f.vx = f.vz = 0; if (tgt) turnToward(f, angleTo(f, tgt.x, tgt.z), 8 * dt); return; }
    if (t < ab.startup + ab.dashTime && !f.sp.done.hit) {
      f.vx = fw.x * ab.speed; f.vz = fw.z * ab.speed;
      for (const v of w.fighters) {
        if (!w.combat.enemies(f, v) || !isAlive(v) || v.zone !== f.zone) continue;
        if (Math.hypot(v.x - f.x, v.z - f.z) > ab.hitRadius + f.c.radius + v.c.radius * 0.5) continue;
        f.sp.done.hit = true;
        const ok = this.hit(f, v, { damage: ab.damage, knockback: ab.knockback, launch: 2, reaction: 'knockdown', dirX: fw.x, dirZ: fw.z, sound: ab.sound, move: ab.id, moveName: ab.name, crowd: 1, hitstop: 0.14 });
        if (ok) w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims: [v.id], pos: { x: v.x, y: v.y + 0.8, z: v.z }, damage: ab.damage });
        setState(f, S.DOWN); f.downTimer = 0.5; f.sub = 1; f.vx = fw.x * 2; f.vz = fw.z * 2;
        return;
      }
      return;
    }
    f.vx *= 0.85; f.vz *= 0.85;
    if (t >= ab.startup + ab.dashTime + 0.35) setState(f, S.IDLE);
  }

  // ── ROT: spinning heel kick ──
  spin(f, ab, dt) {
    const w = this.world, t = f.stateTime;
    f.vx *= 0.8; f.vz *= 0.8;
    if (t >= ab.startup && t <= ab.startup + ab.active) {
      for (const v of w.fighters) {
        if (f.moveHits.includes(v.id) || !w.combat.enemies(f, v) || !isAlive(v) || v.zone !== f.zone || Math.abs(v.y - f.y) > 1) continue;
        const d = Math.hypot(v.x - f.x, v.z - f.z);
        if (d > ab.radius * Math.max(0.9, scaleOf(f)) + v.c.radius) continue;
        f.moveHits.push(v.id);
        const ok = this.hit(f, v, { damage: ab.damage, knockback: ab.knockback, launch: ab.launch, reaction: 'knockdown', dirX: (v.x - f.x) / (d || 1), dirZ: (v.z - f.z) / (d || 1),
          sound: ab.sound, move: ab.id, moveName: ab.name, crowd: 1 });
        if (ok) w.emit('special_hit', { fighter: f.id, ability: ab.id, name: ab.name, victims: [v.id], pos: { x: v.x, y: v.y + 1, z: v.z }, damage: ab.damage });
      }
    }
    if (t >= ab.duration) setState(f, S.IDLE);
  }
}
