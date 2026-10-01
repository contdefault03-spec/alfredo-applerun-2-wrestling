// CameraSystem – broadcast-style third-person camera.
//  auto: frames the local wrestler and their opponent, swinging slowly to a
//        side-on "TV" angle; free: mouse/right-stick orbit.
//  Shake (trauma model), FOV punches, cinematic shots for specials, arena
//  clamping (never inside walls / stands / the cell).
import * as THREE from 'three';
import { ARENA } from '@shared/config/arena.js';

const _v = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;
function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

export class CameraSystem {
  constructor(camera, settings) {
    this.cam = camera; this.settings = settings;
    this.mode = settings.get().cameraMode || 'auto';
    this.yaw = Math.PI; this.pitch = 0.32; this.dist = 7.5;
    this.focus = new THREE.Vector3(0, 2, 0);
    this.pos = new THREE.Vector3(0, 6, 12);
    this.trauma = 0; this.fovKick = 0; this.baseFov = 55;
    this.cine = null; this.time = 0;
    this.menuT = 0;
    this.cage = false;
  }

  toggleMode() { this.mode = this.mode === 'auto' ? 'free' : 'auto'; this.settings.set({ cameraMode: this.mode }); return this.mode; }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount * this.settings.get().cameraShake); }
  punch(amount) { this.fovKick = Math.min(12, this.fovKick + amount); }

  /** Cinematic shot: { kind:'crush', subject, target, dur } */
  cinematic(shot) { this.cine = { t: 0, ...shot }; }

  clampPosition(p) {
    const S = ARENA.stands;
    if (this.cage) {
      const C = ARENA.cage.half - 0.35;
      p.x = Math.max(-C, Math.min(C, p.x)); p.z = Math.max(-C, Math.min(C, p.z)); p.y = Math.min(ARENA.cage.height - 0.4, p.y);
    } else {
      const lim = 12.5;
      p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim + 4, p.z));
      // above the stands' seating rake
      const ax = Math.abs(p.x) - S.innerX, az = -p.z - S.innerZ;
      const into = Math.max(ax, az, p.z > S.innerZ + 2.5 && Math.abs(p.x) > 9.5 ? p.z - (S.innerZ + 2.5) : -1);
      if (into > 0) p.y = Math.max(p.y, 0.55 + (into / S.rowDepth) * S.rowRise + 2.2);
    }
    p.y = Math.max(0.6, Math.min(20, p.y));
    return p;
  }

  update(dt, { me, opp, look, menu = null } = {}) {
    this.time += dt;
    const cam = this.cam;
    if (menu) return this.menuShot(dt, menu);
    if (this.cine && this.cineShot(dt)) return;
    if (!me) return;
    const s = this.settings.get();
    // input look
    if (look && (look.dx || look.dy)) {
      this.mode === 'auto' && Math.abs(look.dx) > 2 && (this.manualT = 2.5);
      this.yaw -= look.dx * 0.0035 * s.mouseSens;
      this.pitch = Math.max(0.08, Math.min(1.1, this.pitch + look.dy * 0.0025 * s.mouseSens * (s.invertY ? -1 : 1)));
    }
    this.manualT = Math.max(0, (this.manualT || 0) - dt);
    const mePos = _v.set(me.x, me.y + me.c.height * 0.6, me.z).clone();
    let target = mePos.clone(), sep = 0;
    if (opp && !opp.hidden) {
      const op = new THREE.Vector3(opp.x, opp.y + opp.c.height * 0.55, opp.z);
      sep = Math.hypot(op.x - mePos.x, op.z - mePos.z);
      if (sep < 14) target.lerp(op, 0.42);
      if (this.mode === 'auto' && this.manualT <= 0 && sep > 0.4 && sep < 14) {
        // side-on broadcast angle: perpendicular to the line between them, on the side closest to the current view
        const lineYaw = Math.atan2(op.x - mePos.x, op.z - mePos.z);
        const c1 = wrap(lineYaw + Math.PI / 2), c2 = wrap(lineYaw - Math.PI / 2);
        // bias: keep the local wrestler on the near side (slightly behind them)
        const want0 = Math.abs(wrap(c1 - this.yaw)) < Math.abs(wrap(c2 - this.yaw)) ? c1 : c2;
        const want = wrap(want0 + wrap(lineYaw - want0) * 0.25);
        this.yaw = wrap(this.yaw + wrap(want - this.yaw) * Math.min(1, dt * 0.9));
      }
    } else if (this.mode === 'auto' && this.manualT <= 0 && Math.hypot(me.vx || 0, me.vz || 0) > 2) {
      const mv = Math.atan2(me.vx, me.vz);
      this.yaw = wrap(this.yaw + wrap(mv - this.yaw) * Math.min(1, dt * 0.5));
    }
    const wantDist = Math.max(5.2, Math.min(13, 5.8 + sep * 0.55 + (me.c.height > 2 ? 1 : 0)));
    this.dist = lerp(this.dist, wantDist, Math.min(1, dt * 2.5));
    this.focus.lerp(target, Math.min(1, dt * 6));
    // camera looks along yaw; sits behind the focus
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const want = new THREE.Vector3(this.focus.x - fx * this.dist * cp, this.focus.y + this.dist * sp + 0.6, this.focus.z - fz * this.dist * cp);
    this.clampPosition(want);
    this.pos.lerp(want, Math.min(1, dt * 7));
    this.apply(dt, this.focus);
  }

  apply(dt, lookAt) {
    const cam = this.cam;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const n = (k) => Math.sin(this.time * (37 + k * 11) + k * 3.1) * 0.6 + Math.sin(this.time * (61 + k * 7)) * 0.4;
    cam.position.copy(this.pos).add(new THREE.Vector3(n(1) * 0.35 * sh, n(2) * 0.3 * sh, n(3) * 0.35 * sh));
    cam.lookAt(lookAt.x + n(4) * 0.15 * sh, lookAt.y + n(5) * 0.15 * sh, lookAt.z);
    this.fovKick = Math.max(0, this.fovKick - dt * 18);
    const fov = this.baseFov - this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  cineShot(dt) {
    const c = this.cine; c.t += dt;
    const subj = c.subject?.();
    if (!subj || c.t > c.dur) { this.cine = null; return false; }
    if (c.kind === 'crush') {
      const tgt = c.target?.() || subj;
      const mid = new THREE.Vector3((subj.x + tgt.x) / 2, 0, (subj.z + tgt.z) / 2);
      const dir = new THREE.Vector3(tgt.x - subj.x, 0, tgt.z - subj.z).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      let pos, look;
      if (c.t < 0.45) { // low hero shot on Ajan preparing
        pos = new THREE.Vector3(subj.x, subj.y + 0.7, subj.z).addScaledVector(side, 3.2).addScaledVector(dir, 2.2);
        look = new THREE.Vector3(subj.x, subj.y + 1.4, subj.z);
        this.baseFov = 48;
      } else { // wide tracking shot of the leap + landing
        pos = mid.clone().addScaledVector(side, 8.5).add(new THREE.Vector3(0, subj.y * 0.4 + 3.2, 0));
        look = new THREE.Vector3(subj.x, subj.y * 0.75 + 1.2, subj.z);
        this.baseFov = 58;
      }
      this.clampPosition(pos);
      this.pos.lerp(pos, Math.min(1, dt * (c.t < 0.5 ? 12 : 5)));
      this.focus.lerp(look, Math.min(1, dt * 10));
      this.apply(dt, this.focus);
      if (c.t > c.dur - 0.05) this.baseFov = 55;
      return true;
    }
    return false;
  }

  menuShot(dt, menu) {
    this.menuT += dt;
    let pos, look;
    if (menu.kind === 'showcase' && menu.subject) {
      const s = menu.subject; const h = s.height || 1.8;
      const a = menu.angle ?? 0.35;
      const d = 2.6 + h * 1.25;
      pos = new THREE.Vector3(s.x + Math.sin(a) * d, s.y + h * 0.65 + 0.3, s.z + Math.cos(a) * d);
      look = new THREE.Vector3(s.x - Math.cos(a) * h * 0.35, s.y + h * 0.5, s.z + Math.sin(a) * h * 0.35);
    } else {
      const a = this.menuT * 0.06 + 0.6;
      pos = new THREE.Vector3(Math.sin(a) * 13, 5.5 + Math.sin(this.menuT * 0.1) * 1.2, Math.cos(a) * 13);
      look = new THREE.Vector3(0, 1.6, 0);
    }
    this.pos.lerp(pos, Math.min(1, dt * 2.5));
    this.focus.lerp(look, Math.min(1, dt * 3));
    this.apply(dt, this.focus);
  }
}
