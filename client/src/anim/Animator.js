// Animator – converts a fighter's simulation state into a pose every frame.
// A spring-damper runs on the whole pose vector: it gives smooth blending
// between clips for free, loose/"ragdoll-ish" limbs while airborne, and
// physical jolts when hit (impulses). The body transform (tilt/drop/spin/lift)
// is also part of the pose so falls and slams are continuous.
import { ATTACKS } from '@shared/config/attacks.js';
import { ABILITIES } from '@shared/config/abilities.js';
import { ITEMS } from '@shared/config/items.js';
import { S } from '@shared/sim/constants.js';
import { P, newPose, set, add } from './PoseSolver.js';
import { GUARD, RELAXED, LYING, ATTACK_CLIPS, GRAPPLE_CLIPS, THROW_CLIPS, HOLD, HELD, applyOverrides, sampleClip } from './Clips.js';

const TWO_PI = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };

export class Animator {
  constructor(solver, character) {
    this.solver = solver;
    this.c = character;
    // character-specific stance tweaks (e.g. Ajan carries his food low)
    this.G = { ...GUARD, ...(character.poses?.guard || {}) };
    this.cur = newPose(); this.vel = new Float32Array(P.SIZE); this.tgt = newPose();
    this.tmp = newPose();
    applyOverrides(this.cur, this.G);
    this.phase = 0; this.time = Math.random() * 10;
    this.omega = 30;
    this.lastState = null;
    this.legLenM = solver.legLen * (character.height / solver.J.headTop.y);
    this.menuMode = false;
    this.flex = 0;
  }

  /** Physical jolt (e.g. when hit). dir: local [x(left), z(fwd)] of the push. */
  impulse(dirLocalX, dirLocalZ, strength = 1) {
    const s = strength * 9;
    this.vel[P.chest] -= dirLocalZ * s * 0.8;       // pushed back → chest pitches back
    this.vel[P.chest + 2] += dirLocalX * s * 0.6;
    this.vel[P.head] -= dirLocalZ * s * 1.3;
    this.vel[P.head + 2] += dirLocalX * s;
    this.vel[P.spine] -= dirLocalZ * s * 0.4;
  }

  update(dt, v, world = null) {
    this.time += dt;
    const t = this.tgt;
    const st = v.state;
    const omega = this.build(t, v, dt);
    this.secondary(t, v, dt);
    // critically-damped spring toward the target pose (substepped for stability)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps, k = omega * omega, c = 2 * omega;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < P.SIZE; i++) {
        const a = k * (t[i] - this.cur[i]) - c * this.vel[i];
        this.vel[i] += a * h;
        this.cur[i] += this.vel[i] * h;
      }
    }
    // spins/rolls: unwind to the nearest equivalent angle instead of spinning back
    for (const i of [P.tilt, P.tilt + 1, P.bodyYaw]) {
      const d = this.cur[i] - t[i];
      if (d > Math.PI) this.cur[i] -= TWO_PI; else if (d < -Math.PI) this.cur[i] += TWO_PI;
    }
    // some channels should not overshoot/lag: hard-set spaces and grip
    this.cur[P.spaceL] = t[P.spaceL]; this.cur[P.spaceR] = t[P.spaceR];
    this.lastState = st;
    return this.cur;
  }

  /** Look at the opponent and lean into acceleration – makes everyone feel alive. */
  secondary(t, v, dt) {
    const st = v.state;
    if (st === S.IDLE || st === S.MOVE || st === S.BLOCK || st === S.HOLD || st === S.TAUNT || st === S.HITSTUN) {
      let yaw = 0, pitch = 0;
      if (v.lookAt) {
        const dx = v.lookAt.x - v.x, dz = v.lookAt.z - v.z;
        let a = Math.atan2(dx, dz) - v.yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
        yaw = Math.max(-1.1, Math.min(1.1, a));
        const dy = (v.lookAt.y ?? v.y) - v.y, d = Math.hypot(dx, dz) || 1;
        pitch = Math.max(-0.4, Math.min(0.4, -dy / d * 0.6));
      }
      this.look = this.look || { y: 0, p: 0 };
      this.look.y += (yaw - this.look.y) * Math.min(1, dt * 6); this.look.p += (pitch - this.look.p) * Math.min(1, dt * 6);
      add(t, 'neck', [this.look.p * 0.4, this.look.y * 0.45, 0]); add(t, 'head', [this.look.p * 0.6, this.look.y * 0.4, 0]);
      add(t, 'chest', [0, this.look.y * 0.15, 0]);
    }
    // lean into acceleration (spine pitch/roll), stronger for light/fast wrestlers
    const vx = v.vx || 0, vz = v.vz || 0;
    const ax = (vx - (this.pvx ?? vx)) / Math.max(dt, 1e-3), az = (vz - (this.pvz ?? vz)) / Math.max(dt, 1e-3);
    this.pvx = vx; this.pvz = vz;
    if (st === S.IDLE || st === S.MOVE) {
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      const af = ax * sy + az * cy, al = ax * cy - az * sy;
      this.lean = this.lean || { f: 0, l: 0 };
      this.lean.f += (Math.max(-1, Math.min(1, af / 25)) - this.lean.f) * Math.min(1, dt * 5);
      this.lean.l += (Math.max(-1, Math.min(1, al / 25)) - this.lean.l) * Math.min(1, dt * 5);
      add(t, 'spine', [this.lean.f * 0.18, 0, -this.lean.l * 0.12]);
      add(t, 'hipsRot', [0, 0, this.lean.l * 0.06]);
    }
  }

  locomotion(t, v, dt, base) {
    const speed = Math.hypot(v.vx || 0, v.vz || 0);
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    const vf = (v.vx || 0) * sy + (v.vz || 0) * cy;
    const vl = (v.vx || 0) * cy - (v.vz || 0) * sy;
    const run = speed > this.c.walkSpeed * 1.25;
    const stride = this.legLenM * (run ? 2.1 : 1.35);
    this.phase = (this.phase + speed * dt / stride) % 1;
    const m = clamp01(speed / 0.8);
    applyOverrides(t, base);
    if (m < 0.01) return run;
    const dx = speed > 0.01 ? vl / speed : 0, dz = speed > 0.01 ? vf / speed : 1;
    const amp = (run ? 0.55 : 0.32) * m;
    const lift = (run ? 0.28 : 0.13) * m;
    const ph = this.phase * TWO_PI;
    const sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);
    // feet: from a neutral stance toward the travel direction
    set(t, 'footL', [0.07 + dx * amp * sL, lift * Math.max(0, Math.cos(ph)), dz * amp * sL]);
    set(t, 'footR', [0.07 - dx * amp * sR, lift * Math.max(0, Math.cos(ph + Math.PI)), dz * amp * sR]);
    add(t, 'hipsOff', [0, -Math.abs(Math.sin(ph)) * (run ? 0.06 : 0.025) * m - (run ? 0.06 : 0.01), 0]);
    add(t, 'hipsRot', [0, Math.sin(ph) * 0.12 * m, 0]);
    add(t, 'chest', [0, -Math.sin(ph) * 0.14 * m, 0]);
    if (run) {
      add(t, 'spine', [0.22 * m * Math.max(0, dz), 0, 0]);
      set(t, 'handL', [0.05, -0.25 + 0.15 * Math.max(0, -sL), 0.25 - 0.45 * sL]);
      set(t, 'handR', [0.05, -0.25 + 0.15 * Math.max(0, -sR), 0.25 - 0.45 * sR]);
      set(t, 'elbowL', [0.2, -0.3, -1]); set(t, 'elbowR', [0.2, -0.3, -1]);
    } else {
      add(t, 'handL', [0, 0.02 * sL, -0.06 * sL]);
      add(t, 'handR', [0, 0.02 * sR, -0.06 * sR]);
    }
    return run;
  }

  breathe(t, amt = 1) {
    const b = Math.sin(this.time * 2.2) * amt;
    add(t, 'chest', [-0.02 * b, 0, 0]);
    add(t, 'hipsOff', [0, 0.006 * b, 0]);
    add(t, 'handL', [0, 0.01 * b, 0]); add(t, 'handR', [0, 0.01 * b, 0]);
  }

  lying(t, faceDown, amt = 1) {
    applyOverrides(t, LYING);
    set(t, 'tilt', [faceDown ? 1.5708 : -1.5708, 0]);
    set(t, 'drop', 1);
    if (faceDown) { set(t, 'handL', [0.55, -0.1, 0.35]); set(t, 'handR', [0.6, 0.0, 0.3]); }
    const b = Math.sin(this.time * 1.7) * 0.02 * amt;
    add(t, 'chest', [b, 0, 0]);
  }

  attackAnchors(v, m) {
    const sp = this.c.attackSpeed;
    const dur = v.stateDur || ((m.startup + m.recovery) / sp + m.active);
    const S_ = Math.min(0.9, (m.startup / sp) / dur), A_ = Math.min(0.95, S_ + m.active / dur);
    return { S: S_, M: (S_ + A_) / 2, A: A_, R: A_ + (1 - A_) * 0.4 };
  }

  /** Build the target pose for the current state; returns spring stiffness. */
  build(t, v, dt) {
    const st = v.state, time = v.stateTime || 0;
    const holdingItem = v.itemType ? ITEMS[v.itemType] : null;
    const handsForItem = (pose) => {
      if (!holdingItem) return;
      if (holdingItem.twoHanded) { set(pose, 'handR', [-0.3, -0.05, 0.55]); set(pose, 'grip', 1); }
      else set(pose, 'handR', [0.05, 0.05, 0.45]);
    };
    if (this.menuMode) {
      applyOverrides(t, RELAXED); this.breathe(t, 1.5);
      const f = this.flex;
      if (f > 0) { set(t, 'handL', [0.55, 0.55, 0.05]); set(t, 'handR', [0.55, 0.55, 0.05]); set(t, 'elbowL', [0.2, -1, 0]); set(t, 'elbowR', [0.2, -1, 0]); add(t, 'chest', [-0.15, 0, 0]); }
      add(t, 'hipsRot', [0, Math.sin(this.time * 0.6) * 0.1, 0]);
      return 14;
    }
    switch (st) {
      case S.IDLE: case S.MOVE: {
        this.locomotion(t, v, dt, v.relaxed ? RELAXED : this.G);
        this.breathe(t);
        handsForItem(t);
        return 26;
      }
      case S.BLOCK: {
        this.locomotion(t, v, dt, this.G);
        set(t, 'handL', [-0.14, 0.3, 0.32]); set(t, 'handR', [-0.18, 0.27, 0.3]);
        set(t, 'elbowL', [0.2, -1, 0.4]); set(t, 'elbowR', [0.2, -1, 0.4]);
        add(t, 'head', [0.22, 0, 0]); add(t, 'chest', [0.1, 0, 0]); add(t, 'hipsOff', [0, -0.05, 0]);
        return 38;
      }
      case S.JUMP: {
        applyOverrides(t, this.G);
        const up = (v.vy ?? 0) > 0;
        set(t, 'footL', [0.07, up ? 0.35 : 0.15, 0.1]); set(t, 'footR', [0.1, up ? 0.25 : 0.1, -0.1]);
        set(t, 'handL', [0.2, 0.35, 0.3]); set(t, 'handR', [0.2, 0.35, 0.3]);
        return 22;
      }
      case S.DODGE: {
        const u = clamp01(time / (this.c.dodgeDuration || 0.34));
        applyOverrides(t, this.G);
        if (v.sub === 1) { // roll
          set(t, 'tilt', [u * TWO_PI, 0]); set(t, 'drop', Math.sin(u * Math.PI) * 0.75);
          set(t, 'hipsOff', [0, -0.3, 0]); set(t, 'spine', [0.6, 0, 0]);
          set(t, 'footL', [0.08, 0.4, 0.3]); set(t, 'footR', [0.08, 0.4, 0.3]);
          set(t, 'handL', [0, -0.2, 0.5]); set(t, 'handR', [0, -0.2, 0.5]);
          return 70;
        }
        set(t, 'hipsOff', [0, -0.12, -0.1]); set(t, 'spine', [-0.2, 0, 0]); set(t, 'footR', [0.1, 0.1, -0.35]);
        return 40;
      }
      case S.ATTACK: {
        const m = ATTACKS[v.move];
        const clip = m && ATTACK_CLIPS[m.anim];
        if (!clip) { applyOverrides(t, this.G); return 30; }
        const an = this.attackAnchors(v, m);
        const u = clamp01(time / (v.stateDur || 0.5));
        sampleClip(t, clip, this.G, u, an);
        if (holdingItem && (m.anim === 'item_swing' || m.anim === 'item_overhead') && holdingItem.twoHanded) set(t, 'grip', 1);
        else if (holdingItem && m.anim !== 'item_throw') handsForItem(t);
        return m.type === 'aerial' || m.anim === 'dropkick' ? 30 : 48;
      }
      case S.GRAB: {
        const u = clamp01(time / (v.stateDur || 0.42));
        applyOverrides(t, this.G);
        const e = Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5);
        set(t, 'handL', [-0.2, 0.05, 0.5 + 0.45 * e]); set(t, 'handR', [-0.2, 0.05, 0.5 + 0.45 * e]);
        add(t, 'chest', [0.18 * e, 0, 0]);
        return 45;
      }
      case S.HOLD: {
        applyOverrides(t, this.G, HOLD);
        if (v.sub === 1) { add(t, 'chest', [0.35, 0, 0]); add(t, 'head', [0.35, 0, 0]); }
        add(t, 'chest', [0, Math.sin(this.time * 7) * 0.05, 0]);
        return 30;
      }
      case S.HELD: {
        applyOverrides(t, this.G, HELD);
        add(t, 'chest', [0, Math.sin(this.time * 9) * 0.08, Math.sin(this.time * 6) * 0.05]);
        return 30;
      }
      case S.GRAPPLE_MOVE: {
        const m = ATTACKS[v.move];
        const clip = GRAPPLE_CLIPS[m?.anim] || GRAPPLE_CLIPS.body_slam;
        const secs = clamp01(time / (v.stateDur || 1)) * (m?.duration || 1.25);
        sampleClip(t, clip, this.G, secs, {});
        return 26;
      }
      case S.GRAPPLE_VICTIM: {
        applyOverrides(t, this.G);
        set(t, 'tilt', [v.tilt ?? -1.2, 0]);
        set(t, 'handL', [0.7, 0.2, 0.1]); set(t, 'handR', [0.7, 0.25, -0.1]);
        set(t, 'footL', [0.1, 0.15, 0.1]); set(t, 'footR', [0.12, 0.05, -0.1]);
        add(t, 'handL', [0, Math.sin(this.time * 12) * 0.15, 0]); add(t, 'footR', [0, Math.sin(this.time * 10) * 0.1, 0]);
        return 20;
      }
      case S.THROWING: {
        const m = ATTACKS[v.move];
        const clip = THROW_CLIPS[m?.anim] || THROW_CLIPS.throw;
        sampleClip(t, clip, this.G, time, {});
        return 35;
      }
      case S.WHIPPED: case S.REBOUND: {
        this.locomotion(t, { ...v, vx: Math.sin(v.yaw) * 6, vz: Math.cos(v.yaw) * 6 }, dt, this.G);
        set(t, 'handL', [0.5, 0.2, 0.3]); set(t, 'handR', [0.6, 0.25, 0.2]);
        if (st === S.REBOUND) { set(t, 'spine', [-0.35, 0, 0]); set(t, 'handL', [0.8, 0.1, -0.5]); set(t, 'handR', [0.8, 0.1, -0.5]); }
        return 30;
      }
      case S.HITSTUN: case S.PARRIED: {
        applyOverrides(t, this.G);
        const dur = v.stateDur || 0.3, u = clamp01(time / dur);
        const e = Math.sin(Math.min(1, u * 1.4) * Math.PI);
        const big = v.sub >= 1 || st === S.PARRIED;
        add(t, 'chest', [-(big ? 0.45 : 0.25) * e, 0, 0.08 * e]);
        add(t, 'head', [-(big ? 0.5 : 0.35) * e, 0, 0]);
        add(t, 'hipsOff', [0, -0.06 * e, -0.06 * e]);
        if (big) {
          set(t, 'handL', [0.6, 0.1, 0.2]); set(t, 'handR', [0.65, 0.05, 0.1]);
          set(t, 'footR', [0.12, 0.12 * e, -0.3]);
        } else { add(t, 'handL', [0.1, -0.15, -0.1]); add(t, 'handR', [0.1, -0.15, -0.1]); }
        if (v.sub === 2) { set(t, 'handL', [0.95, 0.35, -0.1]); set(t, 'handR', [0.95, 0.35, -0.1]); }
        return 22;
      }
      case S.CORNER_STUN: {
        applyOverrides(t, this.G);
        set(t, 'hipsOff', [0, -0.22, -0.12]); set(t, 'spine', [-0.1, 0, 0]); set(t, 'head', [0.45, 0, 0.2]);
        set(t, 'handL', [0.95, 0.12, -0.3]); set(t, 'handR', [0.95, 0.1, -0.3]); set(t, 'spaceL', 0); set(t, 'spaceR', 0);
        set(t, 'footL', [0.15, 0, 0.25]); set(t, 'footR', [0.15, 0, 0.2]);
        return 18;
      }
      case S.AIRBORNE: {
        applyOverrides(t, this.G);
        const fd = v.sub === 1;
        set(t, 'tilt', [(fd ? 1 : -1) * Math.min(1.45, time * 4.2), 0]);
        set(t, 'drop', Math.min(0.6, time * 1.2));
        set(t, 'handL', [0.9, 0.35 + Math.sin(this.time * 13) * 0.2, 0]); set(t, 'handR', [0.9, 0.3 + Math.cos(this.time * 11) * 0.2, 0]);
        set(t, 'footL', [0.15, 0.25, 0.25]); set(t, 'footR', [0.1, 0.1, 0.1]);
        set(t, 'spaceL', 1); set(t, 'spaceR', 1);
        return 11; // floppy
      }
      case S.KNOCKDOWN: case S.DOWN: case S.KO: {
        this.lying(t, v.sub === 1 && st !== S.KO ? true : v.sub === 1, st === S.KO ? 0 : 1);
        if (st === S.DOWN && time > 0.8) {
          // struggle to recover
          const w = Math.sin(this.time * 4) * 0.12;
          add(t, 'handL', [0, w, 0]); add(t, 'footR', [0, Math.max(0, w), 0]);
        }
        return st === S.KNOCKDOWN ? 13 : 16;
      }
      case S.PINNED: { this.lying(t, false); add(t, 'handL', [0, Math.sin(this.time * 14) * 0.08, 0]); return 16; }
      case S.PIN: {
        this.lying(t, true);
        set(t, 'tilt', [1.45, 0]); set(t, 'drop', 0.82);
        set(t, 'handL', [-0.4, -0.35, 0.6]); set(t, 'handR', [0.7, -0.4, 0.2]);
        set(t, 'footL', [0.2, 0, -0.3]); set(t, 'footR', [0.25, 0, 0.2]);
        return 18;
      }
      case S.GETUP: {
        const u = clamp01(time / (v.stateDur || 0.75));
        const fd = v.sub === 1;
        this.lying(t, fd);
        applyOverrides(this.tmp, this.G, { hipsOff: [0, -0.35, 0], spine: [0.45, 0, 0], handL: [0.2, -0.8, 0.5], handR: [0.2, -0.8, 0.5], footR: [0.1, 0, 0.3] });
        const k = sm(u * 1.15);
        for (let i = 0; i < P.SIZE; i++) t[i] += (this.tmp[i] - t[i]) * k;
        return 22;
      }
      case S.CLIMB: {
        applyOverrides(t, this.G);
        const kind = v.sub;
        const w = Math.sin(time * 9);
        if (kind === 1) { // roll out under the ropes
          set(t, 'tilt', [0, 1.4 * Math.sin(Math.min(1, time / 0.9) * Math.PI)]); set(t, 'drop', 0.5); set(t, 'hipsOff', [0, -0.3, 0]);
          return 25;
        }
        set(t, 'handL', [-0.1, 0.75 + w * 0.12, 0.35]); set(t, 'handR', [-0.1, 0.75 - w * 0.12, 0.35]);
        set(t, 'footL', [0.07, 0.3 + w * 0.2, 0.25]); set(t, 'footR', [0.07, 0.3 - w * 0.2, 0.2]);
        set(t, 'spine', [0.2, 0, 0]);
        return 25;
      }
      case S.PERCH: {
        applyOverrides(t, this.G);
        set(t, 'hipsOff', [0, -0.3, 0]); set(t, 'spine', [0.3, 0, 0]);
        set(t, 'handL', [0.95, 0.35, 0.05]); set(t, 'handR', [0.95, 0.35, 0.05]); set(t, 'spaceL', 1); set(t, 'spaceR', 1);
        set(t, 'footL', [0.12, 0, 0]); set(t, 'footR', [0.12, 0, 0]);
        add(t, 'chest', [0, Math.sin(this.time * 2) * 0.1, 0]);
        return 20;
      }
      case S.CAGE_CLIMB: {
        applyOverrides(t, this.G);
        const w = Math.sin((v.y || 0) * 5);
        set(t, 'handL', [0.2, 0.85 + w * 0.12, 0.45]); set(t, 'handR', [0.2, 0.85 - w * 0.12, 0.45]);
        set(t, 'footL', [0.1, 0.25 + w * 0.15, 0.3]); set(t, 'footR', [0.1, 0.25 - w * 0.15, 0.3]);
        set(t, 'spine', [0.1, 0, 0]);
        return 25;
      }
      case S.DIVE: {
        applyOverrides(t, this.G);
        if (v.sub === 0) {
          const u = clamp01(time / 0.75);
          set(t, 'tilt', [Math.min(1.45, u * 2.4), 0]);
          set(t, 'handL', [1.0, 0.3, 0.1]); set(t, 'handR', [1.0, 0.3, 0.1]);
          set(t, 'footL', [0.15, 0.2, -0.1]); set(t, 'footR', [0.15, 0.2, -0.1]);
          return 18;
        }
        this.lying(t, true);
        return 15;
      }
      case S.SPECIAL: return this.special(t, v, dt);
      case S.TAUNT: {
        applyOverrides(t, RELAXED);
        const pump = Math.sin(time * 7) * 0.1;
        set(t, 'handL', [0.6, 0.9 + pump, 0.0]); set(t, 'handR', [0.6, 0.9 - pump, 0.0]);
        set(t, 'elbowL', [0.3, -1, 0]); set(t, 'elbowR', [0.3, -1, 0]);
        set(t, 'chest', [-0.25, Math.sin(time * 3) * 0.25, 0]); set(t, 'head', [-0.25, 0, 0]);
        return 25;
      }
      case S.APRON: {
        applyOverrides(t, RELAXED);
        set(t, 'handR', [-0.1, 0.25, 0.8]);
        this.breathe(t);
        return 14;
      }
      case S.CELEBRATE: {
        if (v.sub === 1) return this.signature(t, v, time);
        applyOverrides(t, RELAXED);
        const pump = Math.sin(time * 6);
        set(t, 'handL', [0.35, 1.05 + pump * 0.05, 0.1]); set(t, 'handR', [0.35, 0.8 - pump * 0.2, 0.2]);
        set(t, 'lift', Math.max(0, pump) * 0.03);
        set(t, 'chest', [-0.2, 0, 0]); set(t, 'head', [-0.3, 0, 0]);
        return 18;
      }
      default:
        applyOverrides(t, this.G);
        return 25;
    }
  }

  /** Per-character victory celebration (press E after winning). */
  signature(t, v, time) {
    applyOverrides(t, RELAXED);
    const id = this.c.id, w = Math.sin(time * 6), s = Math.sin(time * 9);
    switch (id) {
      case 'ajan': {
        if (v.ateFood) { // already ate: chest beat + heavy alternating stomps
          set(t, 'handL', [-0.1, 0.05, 0.35 + 0.1 * Math.max(0, s)]); set(t, 'handR', [-0.1, 0.05, 0.35 + 0.1 * Math.max(0, -s)]);
          set(t, 'chest', [-0.15, 0, 0]); set(t, 'head', [-0.35, 0, 0]);
          const st = Math.sin(time * 5); // stomp: drive one foot up then down
          set(t, 'footL', [0.3 * Math.max(0, st), 0, 0]); set(t, 'footR', [0.3 * Math.max(0, -st), 0, 0]);
          set(t, 'hipsOff', [0, -0.04 * Math.abs(st), 0]);
          return 30;
        }
        // bring the food to the mouth, take bites, chew
        const bite = Math.max(0, Math.sin(time * 4.2));
        set(t, 'handL', [-0.35, 0.62 + 0.08 * bite, 0.42 - 0.1 * bite]); set(t, 'elbowL', [0.8, -0.6, 0]);
        set(t, 'handR', [0.1, -0.2, 0.35]);
        set(t, 'head', [0.2 + 0.15 * bite, 0.15, 0]); set(t, 'neck', [0.1 * bite, 0, 0]);
        set(t, 'chest', [0.05, 0.15, 0]); set(t, 'hipsOff', [0, -0.03 * bite, 0]);
        return 22;
      }
      case 'max': // hand on the chest, snap it up to 45°, then wave to the crowd
        if (time < 0.9) {        // right hand flat on the chest
          set(t, 'handR', [-0.1, 0.1, 0.42]); set(t, 'elbowR', [0.9, -0.5, 0]);
          set(t, 'handL', [0.12, -0.5, 0.25]); set(t, 'chest', [-0.12, 0, 0]); set(t, 'head', [-0.2, 0, 0]);
        } else if (time < 1.7) { // snap it up and out to a ~30° salute at the sky
          const u = Math.min(1, (time - 0.9) / 0.35);
          set(t, 'handR', [0.1, 0.1 + 0.5 * u, 0.42 + 0.2 * u]); set(t, 'elbowR', [0.3 + 0.2 * u, -0.3, 0]);
          set(t, 'chest', [-0.2, 0, 0]); set(t, 'head', [-0.35 * u, 0, 0]);
        } else {                 // big wave to the crowd
          set(t, 'handR', [0.1, 1.0, 0.15 + 0.35 * Math.sin(time * 7)]); set(t, 'elbowR', [0.2, -0.2, 0]);
          set(t, 'head', [-0.3, 0.2 * Math.sin(time * 3.5), 0]); set(t, 'chest', [-0.2, 0, 0]);
          set(t, 'handL', [0.12, -0.5, 0.25]);
        }
        return 22;
      case 'rise': // double-biceps flex
        set(t, 'handL', [0.55, 0.6, 0.0]); set(t, 'handR', [0.55, 0.6, 0.0]); set(t, 'elbowL', [0.2, -1, 0.2]); set(t, 'elbowR', [0.2, -1, 0.2]);
        set(t, 'chest', [-0.25 + 0.05 * w, 0, 0]); set(t, 'hipsOff', [0, -0.08, 0]); set(t, 'head', [-0.3, 0, 0]);
        return 20;
      case 'lucky': // star jumps
        set(t, 'lift', Math.max(0, Math.sin(time * 7)) * 0.12);
        set(t, 'handL', [0.6, 0.85 * Math.max(0, Math.sin(time * 7)), 0.05]); set(t, 'handR', [0.6, 0.85 * Math.max(0, Math.sin(time * 7)), 0.05]);
        set(t, 'footL', [0.18 * Math.max(0, Math.sin(time * 7)), 0, 0]); set(t, 'footR', [0.18 * Math.max(0, Math.sin(time * 7)), 0, 0]);
        return 35;
      case 'rot': // pirouette
        set(t, 'bodyYaw', time * 7); set(t, 'handL', [0.85, 0.35, 0]); set(t, 'handR', [0.85, 0.35, 0]); set(t, 'footR', [0.1, 0.3, 0]);
        return 40;
      case 'cave': // theatrical bow
        set(t, 'spine', [0.75 * Math.min(1, time * 1.5), 0, 0]); set(t, 'handR', [-0.35, -0.2, 0.25]); set(t, 'handL', [0.75, 0.2, -0.4]);
        set(t, 'footR', [0.1, 0, -0.2]);
        return 18;
      default: // masked: salute, then point to the sky
        if (time < 1.2) { set(t, 'handR', [-0.15, 0.62, 0.25]); set(t, 'elbowR', [1, 0, 0]); }
        else { set(t, 'handR', [0.15, 1.1, 0.2]); set(t, 'head', [-0.4, 0, 0]); }
        return 20;
    }
  }

  special(t, v) {
    const ab = ABILITIES[v.move];
    const time = v.stateTime || 0;
    applyOverrides(t, this.G);
    if (!ab) return 30;
    switch (ab.kind) {
      case 'leap_crush': {
        if (v.sub === 0) { // lock-on crouch
          set(t, 'hipsOff', [0, -0.35, -0.05]); set(t, 'spine', [0.45, 0, 0]); set(t, 'chest', [0.2, 0, 0]);
          set(t, 'handL', [0.55, -0.3, -0.55]); set(t, 'handR', [0.55, -0.3, -0.55]); set(t, 'head', [-0.4, 0, 0]);
          set(t, 'footL', [0.12, 0, 0.05]); set(t, 'footR', [0.12, 0, -0.05]);
          return 35;
        }
        if (v.sub === 1) {
          const u = clamp01((time - ab.lockTime) / ab.airTime);
          if (u < 0.65) {
            set(t, 'handL', [0.1, 1.05, 0.15]); set(t, 'handR', [0.1, 1.05, 0.15]); set(t, 'chest', [-0.3, 0, 0]);
            set(t, 'footL', [0.15, 0.35, 0.15]); set(t, 'footR', [0.15, 0.3, -0.05]);
          } else {
            set(t, 'handL', [-0.1, -0.2, 0.9]); set(t, 'handR', [-0.1, -0.2, 0.9]); set(t, 'chest', [0.55, 0, 0]); set(t, 'spine', [0.3, 0, 0]);
            set(t, 'footL', [0.2, 0.2, 0.3]); set(t, 'footR', [0.2, 0.2, 0.3]);
          }
          return 20;
        }
        // landed: crouched on top, fists into the mat
        set(t, 'hipsOff', [0, -0.42, 0.05]); set(t, 'spine', [0.55, 0, 0]); set(t, 'chest', [0.2, 0, 0]);
        set(t, 'handL', [-0.05, -0.95, 0.75]); set(t, 'handR', [-0.05, -0.95, 0.75]); set(t, 'spaceL', 1); set(t, 'spaceR', 1);
        set(t, 'footL', [0.18, 0, 0.1]); set(t, 'footR', [0.18, 0, -0.05]);
        return 30;
      }
      case 'barrage': {
        if (time < ab.finisherAt - 0.25) {
          const k = Math.floor(time / 0.16) % 2;
          const u = (time % 0.16) / 0.16;
          const e = Math.sin(u * Math.PI);
          if (k === 0) { set(t, 'handR', [-0.1, 0.1, 0.45 + 0.55 * e]); set(t, 'chest', [0.1, 0.35 * e, 0]); }
          else { set(t, 'handL', [-0.1, 0.1, 0.45 + 0.55 * e]); set(t, 'chest', [0.1, -0.35 * e, 0]); }
          return 60;
        }
        const u = clamp01((time - (ab.finisherAt - 0.25)) / 0.3);
        if (u < 0.8) { set(t, 'handL', [-0.15, 1.05, 0.05]); set(t, 'handR', [-0.15, 1.05, 0.05]); set(t, 'chest', [-0.3, 0, 0]); }
        else { set(t, 'handL', [-0.2, -0.3, 0.85]); set(t, 'handR', [-0.2, -0.3, 0.85]); set(t, 'chest', [0.55, 0, 0]); set(t, 'hipsOff', [0, -0.16, 0]); }
        return 45;
      }
      case 'blitz': {
        const k = Math.floor(time / 0.13) % 3;
        set(t, 'hipsOff', [0, -0.15, 0]); set(t, 'spine', [0.3, 0, 0]);
        if (k === 0) { set(t, 'handR', [-0.1, 0.1, 1.0]); }
        else if (k === 1) { set(t, 'footR', [0.05, 0.6, 0.85]); }
        else { set(t, 'handL', [-0.1, 0.1, 1.0]); }
        return 70;
      }
      case 'launcher': {
        if (time < ab.startup) { set(t, 'hipsOff', [0, -0.35, 0]); set(t, 'handR', [0.1, -0.6, 0.2]); set(t, 'chest', [0.35, 0.2, 0]); return 40; }
        set(t, 'handR', [-0.1, 1.05, 0.3]); set(t, 'chest', [-0.3, 0.4, 0]); set(t, 'footL', [0.07, 0.3, 0.1]); set(t, 'head', [-0.3, 0, 0]);
        return 45;
      }
      case 'spear': {
        if (time < ab.startup) { set(t, 'hipsOff', [0, -0.3, 0]); set(t, 'spine', [0.5, 0, 0]); set(t, 'handL', [0.3, -0.5, 0.3]); set(t, 'handR', [0.3, -0.5, 0.3]); return 40; }
        set(t, 'hipsOff', [0, -0.28, 0]); set(t, 'spine', [0.75, 0, 0]); set(t, 'chest', [0.3, 0, 0]); set(t, 'head', [-0.5, 0, 0]);
        set(t, 'handL', [0.3, -0.2, 0.7]); set(t, 'handR', [0.3, -0.2, 0.7]);
        const ph = Math.sin(time * 22);
        set(t, 'footL', [0.07, 0.2 * Math.max(0, ph), 0.3 * ph]); set(t, 'footR', [0.07, 0.2 * Math.max(0, -ph), -0.3 * ph]);
        return 40;
      }
      case 'spin': {
        const u = clamp01((time - ab.startup) / (ab.active + 0.15));
        set(t, 'bodyYaw', time < ab.startup ? -0.4 : -0.4 + u * (Math.PI * 2 + 0.4));
        if (time >= ab.startup) { set(t, 'footR', [0.9, 0.7, 0.1]); set(t, 'handL', [0.9, 0.3, 0]); set(t, 'handR', [0.9, 0.3, 0]); set(t, 'hipsRot', [0, 0, -0.3]); }
        return 55;
      }
    }
    return 30;
  }
}
