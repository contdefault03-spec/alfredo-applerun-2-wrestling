// PoseSolver – applies a flat "pose vector" to an auto-rigged skeleton.
//
// Poses are expressed in body-relative units so one animation works for every
// body shape (tiny Lucky, hulking Ajan, lanky Masked):
//   • hand targets: [out, up, fwd] relative to the shoulder, in arm lengths
//   • foot targets: [out, up, fwd] relative to the hip (up = height above the
//     planted ankle), in leg lengths
//   • torso joints: euler [pitch(+fwd), yaw(+left), roll]
// Limbs are solved with two-bone IK; twist is inherited from the parent bone
// so skinning does not candy-wrap.
import * as THREE from 'three';

// ── pose vector layout ──
export const P = {
  hipsOff: 0, hipsRot: 3, spine: 6, chest: 9, neck: 12, head: 15,
  handL: 18, handR: 21, elbowL: 24, elbowR: 27,
  footL: 30, footR: 33, kneeL: 36, kneeR: 39,
  wristL: 42, wristR: 45,
  tilt: 48,      // [pitch, roll] of the whole body around the pelvis
  drop: 50,      // 0..1 : lower the body pivot to lie on the floor
  spaceL: 51, spaceR: 52, // 0 = hand target in root space, 1 = chest space
  bodyYaw: 53,   // extra yaw (spins)
  lift: 54,      // vertical offset in body heights (visual hop)
  grip: 55,      // 1 = left hand grips next to the right hand (two-handed items)
  SIZE: 56,
};

export function newPose() { return new Float32Array(P.SIZE); }
export function copyPose(dst, src) { dst.set(src); return dst; }
export function lerpPose(out, a, b, t) {
  for (let i = 0; i < P.SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
/** set(pose, 'handR', [x,y,z]) */
export function set(pose, key, v) {
  const o = P[key];
  if (typeof v === 'number') pose[o] = v; else for (let i = 0; i < v.length; i++) pose[o + i] = v[i];
  return pose;
}
export function add(pose, key, v, w = 1) {
  const o = P[key];
  if (typeof v === 'number') pose[o] += v * w; else for (let i = 0; i < v.length; i++) pose[o + i] += v[i] * w;
  return pose;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function eulerQ(out, arr, o) { _e.set(arr[o], arr[o + 1], arr[o + 2], 'YXZ'); return out.setFromEuler(_e); }

export class PoseSolver {
  constructor(rig) {
    this.rig = rig;
    const J = rig.joints;
    this.J = J;
    this.dims = rig.dims;
    this.b = rig.bones;
    // rest directions (rig space)
    const dir = (a, b) => new THREE.Vector3().subVectors(J[b], J[a]).normalize();
    this.rest = {
      upperArm_L: dir('upperArm_L', 'lowerArm_L'), lowerArm_L: dir('lowerArm_L', 'hand_L'),
      upperArm_R: dir('upperArm_R', 'lowerArm_R'), lowerArm_R: dir('lowerArm_R', 'hand_R'),
      upperLeg_L: dir('upperLeg_L', 'lowerLeg_L'), lowerLeg_L: dir('lowerLeg_L', 'foot_L'),
      upperLeg_R: dir('upperLeg_R', 'lowerLeg_R'), lowerLeg_R: dir('lowerLeg_R', 'foot_R'),
    };
    this.len = {
      upperArm_L: J.upperArm_L.distanceTo(J.lowerArm_L), lowerArm_L: J.lowerArm_L.distanceTo(J.hand_L),
      upperArm_R: J.upperArm_R.distanceTo(J.lowerArm_R), lowerArm_R: J.lowerArm_R.distanceTo(J.hand_R),
      upperLeg_L: J.upperLeg_L.distanceTo(J.lowerLeg_L), lowerLeg_L: J.lowerLeg_L.distanceTo(J.foot_L),
      upperLeg_R: J.upperLeg_R.distanceTo(J.lowerLeg_R), lowerLeg_R: J.lowerLeg_R.distanceTo(J.foot_R),
    };
    this.armLen = { L: this.len.upperArm_L + this.len.lowerArm_L, R: this.len.upperArm_R + this.len.lowerArm_R };
    this.legLen = (this.len.upperLeg_L + this.len.lowerLeg_L + this.len.upperLeg_R + this.len.lowerLeg_R) / 2;
    // shoulder position in chest local space (rest)
    this.shoulderInChest = { L: J.upperArm_L.clone().sub(J.chest), R: J.upperArm_R.clone().sub(J.chest) };
    // rig-space FK cache
    this.wq = {}; this.wp = {};
    for (const n of Object.keys(this.b)) { this.wq[n] = new THREE.Quaternion(); this.wp[n] = new THREE.Vector3(); }
    // world-space outputs other systems can read (hand positions etc.)
    this.handPos = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  }

  _fk(name, parent) {
    const b = this.b[name];
    if (!parent) { this.wq[name].copy(b.quaternion); this.wp[name].copy(b.position); return; }
    this.wq[name].multiplyQuaternions(this.wq[parent], b.quaternion);
    this.wp[name].copy(b.position).applyQuaternion(this.wq[parent]).add(this.wp[parent]);
  }

  /** Set a bone so that its (rest) direction points along `d` (rig space). */
  _aim(name, parent, d) {
    const r = _v3.copy(this.rest[name]).applyQuaternion(this.wq[parent]);
    _q.setFromUnitVectors(r, d);
    const wq = _q2.multiplyQuaternions(_q, this.wq[parent]);
    this.b[name].quaternion.copy(this.wq[parent]).invert().multiply(wq);
    this._fk(name, parent);
  }

  _twoBone(upper, lower, S, T, a, b, pole) {
    const toT = _v.subVectors(T, S);
    let d = toT.length();
    const dir = toT.normalize();
    d = Math.min(Math.max(d, Math.abs(a - b) + 1e-4), a + b - 1e-4);
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(dir, -dir.y);
    perp.normalize();
    const elbow = new THREE.Vector3().copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    const hand = new THREE.Vector3().copy(S).addScaledVector(dir, d);
    const parent = this.b[upper].parent.name;
    this._aim(upper, parent, elbow.clone().sub(S).normalize());
    this._aim(lower, upper, hand.clone().sub(elbow).normalize());
    return hand;
  }

  apply(pose) {
    const J = this.J, b = this.b, L = this.legLen;
    // torso FK
    b.hips.position.set(J.hips.x + pose[P.hipsOff] * L, J.hips.y + pose[P.hipsOff + 1] * L, J.hips.z + pose[P.hipsOff + 2] * L);
    eulerQ(b.hips.quaternion, pose, P.hipsRot); this._fk('hips', null);
    eulerQ(b.spine.quaternion, pose, P.spine); this._fk('spine', 'hips');
    eulerQ(b.chest.quaternion, pose, P.chest); this._fk('chest', 'spine');
    eulerQ(b.neck.quaternion, pose, P.neck); this._fk('neck', 'chest');
    eulerQ(b.head.quaternion, pose, P.head); this._fk('head', 'neck');

    // arms: compute both targets first (two-handed grip needs the right one)
    const T = {}, Sh = {};
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const A = this.armLen[s];
      const o = P['hand' + s];
      const local = _v.set(pose[o] * sx * A, pose[o + 1] * A, pose[o + 2] * A);
      const tRoot = new THREE.Vector3().copy(J['upperArm_' + s]).add(local);
      const tChest = new THREE.Vector3().copy(this.shoulderInChest[s]).add(local).applyQuaternion(this.wq.chest).add(this.wp.chest);
      T[s] = tRoot.lerp(tChest, pose[P['space' + s]]);
      Sh[s] = new THREE.Vector3().copy(this.shoulderInChest[s]).applyQuaternion(this.wq.chest).add(this.wp.chest);
    }
    const grip = pose[P.grip];
    if (grip > 0.001) {
      const off = _v.set(this.armLen.L * 0.3, 0, 0).applyQuaternion(this.wq.chest);
      const gl = new THREE.Vector3().copy(T.R).add(off);
      T.L.lerp(gl, Math.min(1, grip));
    }
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const po = P['elbow' + s];
      const pole = new THREE.Vector3(pose[po] * sx, pose[po + 1], pose[po + 2]);
      if (pole.lengthSq() < 1e-6) pole.set(0.3 * sx, -0.5, -0.8);
      const hand = this._twoBone('upperArm_' + s, 'lowerArm_' + s, Sh[s], T[s], this.len['upperArm_' + s], this.len['lowerArm_' + s], pole.normalize());
      this.handPos[s].copy(hand);
      eulerQ(b['hand_' + s].quaternion, pose, P['wrist' + s]); this._fk('hand_' + s, 'lowerArm_' + s);
    }

    // legs
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? 1 : -1;
      const o = P['foot' + s];
      const hipRest = J['upperLeg_' + s];
      const ankleRest = J['foot_' + s];
      const T = new THREE.Vector3(hipRest.x + pose[o] * sx * L, ankleRest.y + pose[o + 1] * L, ankleRest.z + pose[o + 2] * L);
      const S = new THREE.Vector3().copy(b['upperLeg_' + s].position).applyQuaternion(this.wq.hips).add(this.wp.hips);
      const po = P['knee' + s];
      const pole = new THREE.Vector3(pose[po] * sx, pose[po + 1], pose[po + 2]);
      if (pole.lengthSq() < 1e-6) pole.set(0.05 * sx, 0, 1);
      this._twoBone('upperLeg_' + s, 'lowerLeg_' + s, S, T, this.len['upperLeg_' + s], this.len['lowerLeg_' + s], pole.normalize());
      // keep feet flat (rest orientation) unless the pose says otherwise
      const fq = _q.setFromEuler(_e.set(0, 0, 0));
      b['foot_' + s].quaternion.copy(this.wq['lowerLeg_' + s]).invert().multiply(fq);
      this._fk('foot_' + s, 'lowerLeg_' + s);
    }
  }
}
