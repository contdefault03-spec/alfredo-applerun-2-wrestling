// AutoRig – turns a static (unrigged) character mesh into a SkinnedMesh.
//
// The supplied Tripo GLBs have no skeleton or animations, so we build one at
// load time: joint landmarks come from shared/config/characters.js (`rig`),
// or are estimated from the mesh. Skin weights use distance to each bone
// segment normalised by the bone's thickness, with anatomical region masks so
// e.g. a torso vertex never follows an arm. Rest pose = the model's own pose
// (T- or A-pose); the animator works with directions/IK so both are fine.
import * as THREE from 'three';

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperArm_L', 'lowerArm_L', 'hand_L', 'upperArm_R', 'lowerArm_R', 'hand_R',
  'upperLeg_L', 'lowerLeg_L', 'foot_L', 'upperLeg_R', 'lowerLeg_R', 'foot_R',
];
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArm_L: 'chest', lowerArm_L: 'upperArm_L', hand_L: 'lowerArm_L',
  upperArm_R: 'chest', lowerArm_R: 'upperArm_R', hand_R: 'lowerArm_R',
  upperLeg_L: 'hips', lowerLeg_L: 'upperLeg_L', foot_L: 'lowerLeg_L',
  upperLeg_R: 'hips', lowerLeg_R: 'upperLeg_R', foot_R: 'lowerLeg_R',
};

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2] ?? 0);

/** Mean Z of vertices near (x,y) – lets landmarks be specified in 2D. */
function localZ(pos, x, y, r = 0.035) {
  let s = 0, n = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - x, dy = pos.getY(i) - y;
    if (dx * dx + dy * dy < r * r) { s += pos.getZ(i); n++; }
  }
  return n ? s / n : 0;
}

/** Estimate landmarks from the geometry when a character has no `rig` entry. */
export function estimateRig(geometry) {
  const pos = geometry.attributes.position;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox; const H = bb.max.y;
  let maxX = 0, tipY = 0, n = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getX(i) > bb.max.x - 0.02) { tipY += pos.getY(i); n++; }
  tipY /= Math.max(1, n); maxX = bb.max.x;
  const sh = [0.11 * H, 0.79 * H, 0];
  const tip = [maxX, tipY, 0];
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  return {
    shoulder: sh, elbow: lerp(sh, tip, 0.45), wrist: lerp(sh, tip, 0.85), handTip: tip,
    neck: 0.83 * H, headTop: H, hip: [0.055 * H, 0.5 * H], knee: [0.055 * H, 0.27 * H], ankle: [0.06 * H, 0.065 * H], pelvis: 0.52 * H,
  };
}

/** Resolve a character's rig config into full 3D joint positions (model space). */
export function resolveJoints(rigCfg, geometry) {
  const pos = geometry.attributes.position;
  const rig = rigCfg || estimateRig(geometry);
  const side = (s) => {
    const src = rig[s === 1 ? 'left' : 'right'];
    const pick = (k) => {
      if (src && src[k]) return src[k].slice();
      const b = rig[k]; return [b[0] * s, b[1], b[2] ?? null];
    };
    const out = {};
    for (const k of ['shoulder', 'elbow', 'wrist', 'handTip']) {
      const p = pick(k); if (p[2] == null) p[2] = localZ(pos, p[0], p[1]); out[k] = v3(p);
    }
    const hip = [rig.hip[0] * s, rig.hip[1]], knee = [rig.knee[0] * s, rig.knee[1]], ank = [rig.ankle[0] * s, rig.ankle[1]];
    out.hip = v3([hip[0], hip[1], localZ(pos, 0, hip[1], 0.06)]);
    out.knee = v3([knee[0], knee[1], localZ(pos, knee[0], knee[1], 0.04)]);
    out.ankle = v3([ank[0], ank[1], localZ(pos, ank[0], ank[1], 0.03) - 0.005]);
    // toe: most-forward vertex of this foot
    let tz = out.ankle.z;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), x = pos.getX(i);
      if (y < rig.ankle[1] * 0.9 && x * s > 0 && Math.abs(x - ank[0]) < 0.08) tz = Math.max(tz, pos.getZ(i));
    }
    out.toe = new THREE.Vector3(ank[0], 0.012, Math.max(tz - 0.01, out.ankle.z + 0.03));
    return out;
  };
  const L = side(1), R = side(-1);
  const pelvisY = rig.pelvis, neckY = rig.neck, headTop = rig.headTop;
  const zc = localZ(pos, 0, pelvisY, 0.06);
  const zChest = localZ(pos, 0, pelvisY + (neckY - pelvisY) * 0.7, 0.06);
  const zNeck = localZ(pos, 0, neckY, 0.04);
  const zHead = localZ(pos, 0, neckY + (headTop - neckY) * 0.45, 0.05);
  const J = {
    hips: new THREE.Vector3(0, pelvisY, zc),
    spine: new THREE.Vector3(0, pelvisY + (neckY - pelvisY) * 0.33, (zc + zChest) / 2),
    chest: new THREE.Vector3(0, pelvisY + (neckY - pelvisY) * 0.68, zChest),
    neck: new THREE.Vector3(0, neckY, zNeck),
    head: new THREE.Vector3(0, neckY + (headTop - neckY) * 0.28, zHead),
    headTop: new THREE.Vector3(0, headTop, zHead),
    upperArm_L: L.shoulder, lowerArm_L: L.elbow, hand_L: L.wrist, handTip_L: L.handTip,
    upperArm_R: R.shoulder, lowerArm_R: R.elbow, hand_R: R.wrist, handTip_R: R.handTip,
    upperLeg_L: L.hip, lowerLeg_L: L.knee, foot_L: L.ankle, toe_L: L.toe,
    upperLeg_R: R.hip, lowerLeg_R: R.knee, foot_R: R.ankle, toe_R: R.toe,
  };
  return { J, rig };
}

/** Measure limb thickness: robust percentile of vertex distance to the bone axis. */
function measureRadius(pos, a, b, filter, pct = 0.45) {
  const ab = new THREE.Vector3().subVectors(b, a); const l2 = ab.lengthSq();
  const p = new THREE.Vector3(); const ds = [];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (!filter(p)) continue;
    const t = p.clone().sub(a).dot(ab) / l2;
    if (t < 0.25 || t > 0.75) continue;
    const d = segDist(p, a, b);
    if (d < 0.25) ds.push(d);
  }
  if (ds.length < 20) return null;
  ds.sort((x, y) => x - y);
  return ds[Math.floor(ds.length * pct)];
}

function segDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-9;
  let t = (apx * abx + apy * aby + apz * abz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Build a SkinnedMesh from a static mesh.
 * Returns { mesh, bones, joints, dims }.
 */
export function autoRig(srcMesh, rigCfg) {
  const geometry = srcMesh.geometry.clone();
  geometry.applyMatrix4(srcMesh.matrixWorld); // bake any node transform
  const { J, rig } = resolveJoints(rigCfg, geometry);

  // ── bones (identity rotations, positions = joint landmarks) ──
  const bones = {};
  for (const name of BONE_NAMES) { const b = new THREE.Bone(); b.name = name; bones[name] = b; }
  for (const name of BONE_NAMES) {
    const p = PARENT[name];
    if (p) { bones[p].add(bones[name]); bones[name].position.copy(J[name]).sub(J[p]); }
    else bones[name].position.copy(J[name]);
  }

  // ── skin weights ──
  const torsoW = Math.max(0.06, Math.abs(J.upperArm_L.x - J.upperArm_R.x) * 0.5);
  const armLen = J.upperArm_L.distanceTo(J.lowerArm_L) + J.lowerArm_L.distanceTo(J.hand_L);
  const legLen = J.upperLeg_L.distanceTo(J.lowerLeg_L) + J.lowerLeg_L.distanceTo(J.foot_L);
  const posAttr = geometry.attributes.position;
  const shX = Math.abs(J.upperArm_L.x);
  const mArm = measureRadius(posAttr, J.upperArm_L, J.lowerArm_L, (p) => p.x > shX * 1.05);
  const mLeg = measureRadius(posAttr, J.upperLeg_L, J.lowerLeg_L, (p) => p.x > 0.004 && p.y < J.hips.y);
  const armR = rig.armRadius ?? Math.min(0.12, Math.max(0.03, (mArm ?? armLen * 0.12) * 1.35));
  const legR = rig.legRadius ?? Math.min(0.14, Math.max(0.045, (mLeg ?? legLen * 0.14) * 1.35));
  const handK = rig.handRadius ?? 1.2;
  const segs = [
    ['hips', J.hips, J.spine, torsoW * 1.1],
    ['spine', J.spine, J.chest, torsoW * 1.1],
    ['chest', J.chest, J.neck, torsoW * 1.1],
    ['neck', J.neck, J.head, torsoW * 0.5],
    ['head', J.head, J.headTop, torsoW * 0.9],
  ];
  for (const s of ['L', 'R']) {
    segs.push([`upperArm_${s}`, J[`upperArm_${s}`], J[`lowerArm_${s}`], armR]);
    segs.push([`lowerArm_${s}`, J[`lowerArm_${s}`], J[`hand_${s}`], armR * 0.9]);
    segs.push([`hand_${s}`, J[`hand_${s}`], J[`handTip_${s}`], armR * handK]);
    segs.push([`upperLeg_${s}`, J[`upperLeg_${s}`], J[`lowerLeg_${s}`], legR]);
    segs.push([`lowerLeg_${s}`, J[`lowerLeg_${s}`], J[`foot_${s}`], legR * 0.8]);
    segs.push([`foot_${s}`, J[`foot_${s}`], J[`toe_${s}`], legR * 0.8]);
  }
  const boneIndex = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
  const pos = geometry.attributes.position;
  const N = pos.count;
  const skinIndex = new Uint16Array(N * 4), skinWeight = new Float32Array(N * 4);
  const p = new THREE.Vector3();
  const shoulderX = Math.abs(J.upperArm_L.x);
  const legTop = J.hips.y + 0.03;
  const armpitY = Math.min(J.upperArm_L.y, J.upperArm_R.y) - armR * 2.2;
  const scores = new Float32Array(segs.length);
  for (let i = 0; i < N; i++) {
    p.fromBufferAttribute(pos, i);
    const sideSign = p.x >= 0 ? 1 : -1;
    for (let k = 0; k < segs.length; k++) {
      const [name, a, b, r] = segs[k];
      const isArm = name.includes('Arm') || name.startsWith('hand');
      const isLeg = name.includes('Leg') || name.startsWith('foot');
      let ok = true;
      if (isArm || isLeg) {
        const s = name.endsWith('_L') ? 1 : -1;
        if (s !== sideSign) ok = false;
        if (isArm && Math.abs(p.x) < shoulderX * 0.55) ok = false;
        if (isLeg && (p.y > legTop || Math.abs(p.x) < 0.004)) ok = false;
      }
      if ((name === 'head' || name === 'neck') && p.y < J.neck.y - 0.03) ok = false;
      // torso must not swallow the arms of wide characters (armpit and above)
      if ((name === 'chest' || name === 'spine') && Math.abs(p.x) > shoulderX * 1.02 && p.y > armpitY) ok = false;
      if (!ok) { scores[k] = 0; continue; }
      const nd = segDist(p, a, b) / r;
      scores[k] = 1 / (Math.pow(nd, 5) + 1e-4);
    }
    // top-3
    const idx = [0, 0, 0], val = [0, 0, 0];
    for (let k = 0; k < segs.length; k++) {
      const s = scores[k];
      if (s > val[2]) {
        if (s > val[0]) { idx[2] = idx[1]; val[2] = val[1]; idx[1] = idx[0]; val[1] = val[0]; idx[0] = k; val[0] = s; }
        else if (s > val[1]) { idx[2] = idx[1]; val[2] = val[1]; idx[1] = k; val[1] = s; }
        else { idx[2] = k; val[2] = s; }
      }
    }
    // held props (Max's weights, Ajan's food bowl): everything past the wrist moves rigidly with the hand
    const top = segs[idx[0]][0];
    if (top.startsWith('hand_') || top.startsWith('lowerArm_')) {
      const sd = top.slice(-1);
      const S0 = J['upperArm_' + sd], W0 = J['hand_' + sd];
      const dx = W0.x - S0.x, dy = W0.y - S0.y, dz = W0.z - S0.z;
      const t = ((p.x - S0.x) * dx + (p.y - S0.y) * dy + (p.z - S0.z) * dz) / (dx * dx + dy * dy + dz * dz);
      if (t > 1.02) { idx[0] = segs.findIndex((sg) => sg[0] === 'hand_' + sd); val[0] = 1; val[1] = val[2] = 0; }
    }
    const sum = val[0] + val[1] + val[2] || 1;
    for (let j = 0; j < 3; j++) {
      skinIndex[i * 4 + j] = boneIndex[segs[idx[j]][0]];
      skinWeight[i * 4 + j] = val[j] / sum;
    }
  }
  // optional detachable prop (e.g. Ajan's food bowl): its own bone so it can be scaled away
  const boneList = BONE_NAMES.map((n) => bones[n]);
  if (rig.prop) {
    const sd = rig.prop.side || 'L', hi = boneIndex['hand_' + sd], li = boneIndex['lowerArm_' + sd];
    const [cx, cy] = rig.prop.center, r2 = rig.prop.radius * rig.prop.radius;
    const sel = []; const c = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      if (skinIndex[i * 4] !== hi && skinIndex[i * 4] !== li) continue;
      const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy;
      if (dx * dx + dy * dy < r2) { sel.push(i); c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); }
    }
    if (sel.length > 20) {
      c.multiplyScalar(1 / sel.length);
      const pb = new THREE.Bone(); pb.name = 'prop_' + sd;
      bones['hand_' + sd].add(pb); pb.position.copy(c).sub(J['hand_' + sd]);
      bones[pb.name] = pb;
      const pi = boneList.push(pb) - 1;
      for (const i of sel) { skinIndex[i * 4] = pi; skinWeight[i * 4] = 1; skinWeight[i * 4 + 1] = skinWeight[i * 4 + 2] = skinWeight[i * 4 + 3] = 0; }
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const mesh = new THREE.SkinnedMesh(geometry, srcMesh.material);
  mesh.add(bones.hips);
  const skeleton = new THREE.Skeleton(boneList);
  mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false; // skinned bounds are unreliable when animating

  const dims = {
    armLen, legLen, torsoW,
    upperArm: J.upperArm_L.distanceTo(J.lowerArm_L), lowerArm: J.lowerArm_L.distanceTo(J.hand_L),
    upperArmR: J.upperArm_R.distanceTo(J.lowerArm_R), lowerArmR: J.lowerArm_R.distanceTo(J.hand_R),
    upperLeg: J.upperLeg_L.distanceTo(J.lowerLeg_L), lowerLeg: J.lowerLeg_L.distanceTo(J.foot_L),
    pelvisY: J.hips.y, headTop: J.headTop.y, neckY: J.neck.y,
  };
  return { mesh, bones, joints: J, dims };
}
