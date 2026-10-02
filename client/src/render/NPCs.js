// NPC humans: referee + commentators. Built procedurally in T-pose, then run
// through the same AutoRig + PoseSolver pipeline as the wrestlers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { autoRig } from '../anim/AutoRig.js';
import { PoseSolver, P, newPose, set, add } from '../anim/PoseSolver.js';
import { applyOverrides, RELAXED, GUARD } from '../anim/Clips.js';

const RIG = { shoulder: [0.12, 0.815, 0], elbow: [0.275, 0.815, 0], wrist: [0.42, 0.815, 0], handTip: [0.48, 0.815, 0],
  neck: 0.86, headTop: 1.0, hip: [0.052, 0.5], knee: [0.052, 0.27], ankle: [0.052, 0.05], pelvis: 0.52 };

// texture atlas: 4x4 cells
function atlas(colors, stripes = false) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  colors.forEach((col, i) => { x.fillStyle = col; x.fillRect((i % 4) * 64, Math.floor(i / 4) * 64, 64, 64); });
  if (stripes) { x.fillStyle = '#f4f4f4'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#0c0c0c'; for (let i = 0; i < 64; i += 12) x.fillRect(i, 0, 6, 64); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}
function inCell(geo, cell) {
  const uv = geo.attributes.uv; const cx = (cell % 4) / 4, cy = 1 - (Math.floor(cell / 4) + 1) / 4;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, cx + 0.01 + uv.getX(i) * 0.23, cy + 0.01 + uv.getY(i) * 0.23);
  return geo.index ? geo.toNonIndexed() : geo;
}
function capsuleBetween(a, b, r, cell, seg = 8) {
  const len = a.distanceTo(b);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q); const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
  return inCell(g, cell);
}
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

/** cells: 0 shirt, 1 skin, 2 pants, 3 shoes, 4 hair, 5 accessory */
function humanMesh(tex, { headset = false, jacket = false } = {}) {
  const parts = [];
  const torso = new THREE.CapsuleGeometry(0.085, 0.24, 4, 12); torso.scale(1.22, 1, 0.72); torso.translate(0, 0.69, 0);
  parts.push(inCell(torso, 0));
  const head = new THREE.SphereGeometry(0.062, 16, 12); head.scale(0.92, 1.08, 1); head.translate(0, 0.935, 0.005); parts.push(inCell(head, 1));
  const hair = new THREE.SphereGeometry(0.066, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45); hair.translate(0, 0.945, -0.004); parts.push(inCell(hair, 4));
  parts.push(capsuleBetween(V(0, 0.84), V(0, 0.89), 0.03, 1));
  for (const s of [-1, 1]) {
    parts.push(capsuleBetween(V(s * 0.1, 0.815), V(s * 0.275, 0.815), 0.034, jacket ? 0 : 0));
    parts.push(capsuleBetween(V(s * 0.275, 0.815), V(s * 0.42, 0.815), 0.029, jacket ? 0 : 1));
    const hand = new THREE.SphereGeometry(0.03, 8, 6); hand.scale(1.5, 0.7, 1); hand.translate(s * 0.45, 0.815, 0); parts.push(inCell(hand, 1));
    parts.push(capsuleBetween(V(s * 0.052, 0.52), V(s * 0.052, 0.27), 0.047, 2));
    parts.push(capsuleBetween(V(s * 0.052, 0.27), V(s * 0.052, 0.06), 0.038, 2));
    const foot = new THREE.BoxGeometry(0.06, 0.04, 0.13); foot.translate(s * 0.052, 0.02, 0.03); parts.push(inCell(foot, 3));
  }
  const hips = new THREE.CapsuleGeometry(0.08, 0.06, 4, 12); hips.scale(1.2, 1, 0.8); hips.translate(0, 0.52, 0); parts.push(inCell(hips, 2));
  if (headset) { const hs = new THREE.TorusGeometry(0.067, 0.008, 6, 16, Math.PI); hs.translate(0, 0.95, 0); parts.push(inCell(hs, 5)); }
  const geo = mergeGeometries(parts.map((g) => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  return new THREE.Mesh(geo, mat);
}

class Human {
  constructor(tex, height, opts) {
    const src = humanMesh(tex, opts);
    src.updateMatrixWorld(true);
    const rig = autoRig(src, RIG);
    this.solver = new PoseSolver(rig);
    this.root = new THREE.Group(); this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.scale = height; this.pelvisH = 0.52 * height;
    rig.mesh.scale.setScalar(height); rig.mesh.position.y = -this.pelvisH;
    this.pivot.add(rig.mesh);
    this.cur = newPose(); this.vel = new Float32Array(P.SIZE); this.tgt = newPose();
    applyOverrides(this.cur, RELAXED);
    this.phase = 0; this.time = Math.random() * 5;
    this.legLenM = this.solver.legLen * height;
  }
  /**
   * Replace the procedural body with a GLB model, re-rigged onto the SAME pose
   * skeleton so all existing animation (walk/turn/count/gesture) still drives it
   * (no T-pose). Call once after load.
   */
  setModel(src) {
    let mesh = null; src.updateMatrixWorld(true);
    src.traverse((o) => { if ((o.isMesh || o.isSkinnedMesh) && !mesh) mesh = o; });
    if (!mesh) return false;
    const rig = autoRig(mesh, RIG);
    const topY = rig.joints?.headTop?.y || 1;
    const sc = this.scale / topY;             // normalise the GLB to the NPC height
    if (this._rigMesh) this.pivot.remove(this._rigMesh);
    rig.mesh.scale.setScalar(sc);
    this.pelvisH = (rig.joints?.hips?.y || 0.52) * sc;
    rig.mesh.position.y = -this.pelvisH;
    rig.mesh.frustumCulled = false;
    this.pivot.add(rig.mesh);
    this.solver = new PoseSolver(rig);
    this.legLenM = this.solver.legLen * sc;
    this._rigMesh = rig.mesh;
    return true;
  }

  walk(t, speed, dt) {
    this.phase = (this.phase + speed * dt / (this.legLenM * 1.4)) % 1;
    const m = Math.min(1, speed / 0.6), ph = this.phase * Math.PI * 2;
    set(t, 'footL', [0.07, 0.12 * m * Math.max(0, Math.cos(ph)), 0.3 * m * Math.sin(ph)]);
    set(t, 'footR', [0.07, 0.12 * m * Math.max(0, -Math.cos(ph)), -0.3 * m * Math.sin(ph)]);
    add(t, 'handL', [0, 0, -0.25 * m * Math.sin(ph)]); add(t, 'handR', [0, 0, 0.25 * m * Math.sin(ph)]);
  }
  solve(dt, omega = 18) {
    const k = omega * omega, c = 2 * omega;
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let s = 0; s < steps; s++) for (let i = 0; i < P.SIZE; i++) {
      this.vel[i] += (k * (this.tgt[i] - this.cur[i]) - c * this.vel[i]) * h; this.cur[i] += this.vel[i] * h;
    }
    this.cur[P.spaceL] = this.tgt[P.spaceL]; this.cur[P.spaceR] = this.tgt[P.spaceR];
    this.solver.apply(this.cur);
    const drop = Math.max(0, Math.min(1, this.cur[P.drop]));
    this.pivot.position.y = this.pelvisH + (0.15 - this.pelvisH) * drop;
    this.pivot.rotation.set(this.cur[P.tilt], 0, this.cur[P.tilt + 1], 'YXZ');
  }
}

export class Referee extends Human {
  constructor(scene) {
    super(atlas(['#ffffff', '#e0ac69', '#101010', '#050505', '#1b1b1b', '#222222'], true), 1.78);
    scene.add(this.root);
    this.lastCount = 0; this.slap = 0; this.prev = new THREE.Vector3();
  }
  update(dt, ref) {
    if (!ref) return;
    this.time += dt;
    const speed = this.prev.distanceTo(new THREE.Vector3(ref.x, 0, ref.z)) / Math.max(dt, 1e-3);
    this.prev.set(ref.x, 0, ref.z);
    this.root.position.set(ref.x, ref.y, ref.z);
    this.root.rotation.y = ref.yaw;
    const t = this.tgt;
    if (ref.count !== this.lastCount) { this.lastCount = ref.count; if (ref.count > 0) this.slap = 1; }
    this.slap = Math.max(0, this.slap - dt * 3);
    switch (ref.state) {
      case 'count': case 'slide': {
        // down on the mat beside the pin, slapping the canvas
        applyOverrides(t, RELAXED, { hipsOff: [0, -0.62, 0.1], spine: [0.9, 0, 0], chest: [0.3, 0, 0], head: [-0.6, 0, 0],
          footL: [0.12, 0.05, -0.55], footR: [0.12, 0.05, -0.5], kneeL: [0, -0.3, 1], kneeR: [0, -0.3, 1], handL: [0.3, -0.8, 0.3] });
        const up = ref.state === 'count' ? Math.max(0, 1 - this.slap * 2.2) : 0.3;
        set(t, 'handR', [0.25, -0.9 + up * 1.4, 0.35 - up * 0.1]);
        break;
      }
      case 'signal':
        applyOverrides(t, RELAXED);
        set(t, 'handL', [0.9 * Math.abs(Math.sin(this.time * 6)), 0.2, 0.3]); set(t, 'handR', [0.9 * Math.abs(Math.cos(this.time * 6)), 0.2, 0.3]);
        break;
      case 'raise':
        applyOverrides(t, RELAXED); set(t, 'handR', [0.35, 1.05, 0.05]); set(t, 'handL', [0.2, -0.5, 0.3]);
        break;
      case 'warn':
        // marching in, wagging a finger at the offender
        applyOverrides(t, RELAXED, { hipsOff: [0, -0.06, 0], spine: [0.18, 0, 0] });
        set(t, 'handR', [0.2, 0.75 + 0.15 * Math.sin(this.time * 12), 0.35]); set(t, 'handL', [0.12, -0.55, 0.25]);
        this.walk(t, speed, dt);
        break;
      case 'grabbed': {
        // hoisted off the mat, body limp — arms and head dangling
        const sw = Math.sin(this.time * 6) * 0.12;
        applyOverrides(t, RELAXED, { hipsOff: [0, -0.1, 0], spine: [0.35, sw, 0], chest: [0.25, 0, 0], head: [0.5, sw, 0],
          handL: [-0.1, -0.95, 0.1], handR: [-0.1, -0.95, 0.1], footL: [0.05, -0.2, -0.15], footR: [0.05, -0.2, 0.15], kneeL: [0, -0.1, 0.4], kneeR: [0, -0.1, 0.4] });
        break;
      }
      case 'down':
        // flat on his back on the canvas, out cold
        applyOverrides(t, RELAXED, { hipsOff: [0, -0.62, 0], spine: [0, 0, 0], chest: [-0.1, 0, 0], head: [0.2, 0.3, 0],
          footL: [0.35, 0, -0.5], footR: [0.35, 0, -0.5], kneeL: [0, 0.1, 0.2], kneeR: [0, -0.1, 0.2],
          handL: [0.1, -0.2, -0.9], handR: [0.1, -0.2, -0.9] });
        break;
      default:
        applyOverrides(t, RELAXED, { hipsOff: [0, -0.08, 0], spine: [0.22, 0, 0], handL: [0.12, -0.6, 0.25], handR: [0.12, -0.6, 0.25] });
        this.walk(t, speed, dt);
    }
    this.solve(dt, ref.state === 'count' ? 30 : 16);
  }
}

export class Commentator extends Human {
  constructor(scene, seat, shirt = '#1c2238') {
    super(atlas([shirt, '#d9a778', '#15171d', '#050505', '#3b2412', '#101010']), 1.76, { headset: true, jacket: true });
    scene.add(this.root);
    this.root.position.set(seat.x, 0, seat.z);
    this.root.rotation.y = 0; // facing the ring (+z)
    this.talk = 0; this.excite = 0; this.standT = 0;
  }
  speak(amount = 1) { this.talk = Math.max(this.talk, amount * 3); }
  hype() { this.standT = 3; this.excite = 1; }
  update(dt) {
    this.time += dt;
    this.talk = Math.max(0, this.talk - dt);
    this.standT = Math.max(0, this.standT - dt);
    const t = this.tgt;
    if (this.standT > 0) {
      applyOverrides(t, RELAXED);
      set(t, 'handL', [0.4, 0.9 + Math.sin(this.time * 7) * 0.1, 0.1]); set(t, 'handR', [0.4, 0.8 + Math.cos(this.time * 7) * 0.1, 0.1]);
      set(t, 'chest', [-0.2, Math.sin(this.time * 2) * 0.2, 0]);
    } else {
      // seated at the desk
      applyOverrides(t, RELAXED, { hipsOff: [0, -0.5, -0.2], spine: [0.15, 0, 0], footL: [0.1, 0, 0.35], footR: [0.1, 0, 0.3], kneeL: [0, 0.3, 1], kneeR: [0, 0.3, 1],
        handL: [-0.05, -0.28, 0.6], handR: [-0.05, -0.28, 0.6] });
      if (this.talk > 0) {
        const g = Math.sin(this.time * 5);
        add(t, 'handR', [0.1 * g, 0.25 + 0.1 * g, 0.1]); add(t, 'head', [0.08 * Math.sin(this.time * 9), 0.15 * Math.sin(this.time * 1.7), 0]);
      }
      add(t, 'head', [0, Math.sin(this.time * 0.5) * 0.25, 0]);
    }
    this.solve(dt, 12);
  }
}

/**
 * Ring-side valet (girl.glb): strolls around her corner, waves/salutes the
 * crowd, applauds when a winner is announced, and can walk over to the champ
 * to blow a kiss. Same rig pipeline as the ref/announcer, so no T-pose.
 */
export class RingGirl extends Human {
  constructor(scene, home, shirt = '#d81b60') {
    super(atlas([shirt, '#e8b48a', '#20202a', '#101016', '#2a1a0f', '#ffd24a']), 1.7);
    scene.add(this.root);
    this.home = { x: home.x, z: home.z };
    this.pos = new THREE.Vector3(home.x, 0, home.z);
    this.target = new THREE.Vector3(home.x, 0, home.z);
    this.yaw = Math.atan2(-home.x, -home.z);
    this.prevPos = this.pos.clone();
    this.applaudT = 0; this.kissT = 0; this.patrolT = Math.random() * 3;
    this.root.visible = false;
  }
  applaud(sec = 4) { this.applaudT = Math.max(this.applaudT, sec); }
  /** Walk over toward the champion (x,z) and blow a kiss. */
  toWinner(x, z) { this.target.set(x + (this.home.x > 0 ? 1.6 : -1.6), 0, z + 1.4); this.kissT = 6; this.patrolT = 6; }
  pickPatrol() {
    const r = 1.5;
    this.target.set(this.home.x + (Math.random() - 0.5) * r, 0, this.home.z + (Math.random() - 0.5) * r);
  }
  update(dt) {
    if (!this.root.visible) return;
    this.time += dt;
    this.applaudT = Math.max(0, this.applaudT - dt);
    this.kissT = Math.max(0, this.kissT - dt);
    this.patrolT -= dt;
    const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
    if (this.patrolT <= 0 && d < 0.12 && this.applaudT <= 0 && this.kissT <= 0) { this.pickPatrol(); this.patrolT = 2.5 + Math.random() * 3; }
    const step = Math.min(d, (this.kissT > 0 ? 2.0 : 1.3) * dt);
    if (d > 0.06) {
      this.pos.x += (this.target.x - this.pos.x) / d * step; this.pos.z += (this.target.z - this.pos.z) / d * step;
      this.yaw = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z);
    } else {
      const toRing = Math.atan2(-this.pos.x, -this.pos.z);
      this.yaw += (toRing - this.yaw) * Math.min(1, dt * 3);
    }
    const speed = this.prevPos.distanceTo(this.pos) / Math.max(dt, 1e-3); this.prevPos.copy(this.pos);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const t = this.tgt;
    if (this.kissT > 0 && d < 0.3) {              // blow a kiss to the champ
      applyOverrides(t, RELAXED);
      const k = Math.max(0, Math.sin(this.time * 3));
      set(t, 'handR', [-0.1, 0.5 + 0.3 * k, 0.4]); set(t, 'elbowR', [0.9, -0.5, 0]);
      set(t, 'head', [-0.1, 0, 0]); set(t, 'chest', [-0.1, 0, 0]);
    } else if (this.applaudT > 0) {               // applaud the winner
      applyOverrides(t, RELAXED);
      const c = Math.sin(this.time * 14) * 0.18;
      set(t, 'handL', [0.3, 0.12, 0.5 + c]); set(t, 'handR', [0.3, 0.12, 0.5 - c]);
      set(t, 'elbowL', [0.5, -0.6, 0]); set(t, 'elbowR', [0.5, -0.6, 0]); set(t, 'head', [-0.12, 0, 0]);
    } else if (speed > 0.3) {                      // strolling
      applyOverrides(t, RELAXED, { spine: [0.08, 0, 0] });
      this.walk(t, speed, dt);
    } else {                                       // wave / salute the crowd
      applyOverrides(t, RELAXED);
      const wv = Math.sin(this.time * 5);
      set(t, 'handR', [0.1, 0.75 + 0.2 * wv, 0.2]); set(t, 'elbowR', [0.3, -0.2, 0]);
      add(t, 'head', [0, 0.2 * Math.sin(this.time * 1.5), 0]);
    }
    this.solve(dt, 14);
  }
}

/** Ring announcer in a tuxedo with a microphone: introduces the match and the winner. */
export class Announcer extends Human {
  constructor(scene) {
    super(atlas(['#0b0b10', '#e0b48a', '#0b0b10', '#050505', '#3a2a1a', '#c0c0c0']), 1.8, { jacket: true });
    scene.add(this.root);
    this.home = { x: 1.9, y: 0, z: -6.4 };     // ringside near the timekeeper
    this.pos = new THREE.Vector3(this.home.x, 0, this.home.z); this.yaw = 0;
    this.target = { x: this.home.x, y: 0, z: this.home.z, yaw: 0 };
    this.talkT = 0; this.prevPos = this.pos.clone();
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 }));
    mic.rotation.x = Math.PI / 2; mic.position.set(0, 0, 0.06);
    const b = this.solver.b.hand_R; mic.scale.setScalar(1 / 1.8); mic.position.multiplyScalar(1 / 1.8); b.add(mic);
  }
  /** Walk to a spot (in the ring y = ring height). */
  goTo(x, y, z, yaw) { this.target = { x, y, z, yaw }; }
  goHome() { this.goTo(this.home.x, 0, this.home.z, 0); }
  speak(seconds) { this.talkT = seconds; }
  update(dt) {
    this.time += dt; this.talkT = Math.max(0, this.talkT - dt);
    const d = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z);
    const step = Math.min(d, 2.6 * dt);
    if (d > 0.02) { this.pos.x += (this.target.x - this.pos.x) / d * step; this.pos.z += (this.target.z - this.pos.z) / d * step; this.yaw = Math.atan2(this.target.x - this.pos.x, this.target.z - this.pos.z); }
    else this.yaw += ((this.target.yaw ?? this.yaw) - this.yaw) * Math.min(1, dt * 4);
    // climbs between floor and ring: height eases toward the ring when inside the apron square
    const inRing = Math.abs(this.pos.x) < 3.6 && Math.abs(this.pos.z) < 3.6;
    this.pos.y += ((inRing ? 1.2 : 0) - this.pos.y) * Math.min(1, dt * 5);
    const speed = this.prevPos.distanceTo(this.pos) / Math.max(dt, 1e-3); this.prevPos.copy(this.pos);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const t = this.tgt;
    applyOverrides(t, RELAXED);
    const g = Math.sin(this.time * 4);
    set(t, 'handR', [-0.1, 0.55, 0.32]); set(t, 'elbowR', [0.8, -0.4, 0]); // mic at the mouth
    if (this.talkT > 0) { set(t, 'handL', [0.45 + 0.2 * g, 0.2 + 0.35 * Math.max(0, g), 0.25]); add(t, 'head', [-0.15 + 0.06 * Math.sin(this.time * 11), 0, 0]); add(t, 'chest', [-0.1, 0, 0]); }
    this.walk(t, speed, dt);
    this.solve(dt, 14);
  }
}
