// CrowdSystem – hundreds of spectators in a handful of draw calls.
// Each stand section is an InstancedMesh (near rows detailed, far rows a
// cheaper LOD). All animation (sit/stand, bounce, arms up, cheering waves)
// runs in the vertex shader from per-instance attributes + a few uniforms.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// part ids: 0 torso, 1 left arm, 2 right arm, 3 legs, 4 head
// colour selectors: 0 shirt, 1 skin, 2 hair, 3 pants
function part(geo, partId, colorSel) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(partId), 1));
  geo.setAttribute('aSel', new THREE.BufferAttribute(new Float32Array(n).fill(colorSel), 1));
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  return geo;
}
function spectatorGeometry(detail) {
  const seg = detail ? 7 : 4;
  const parts = [];
  const torso = new THREE.CapsuleGeometry(0.17, 0.36, 2, seg); torso.scale(1, 1, 0.7); torso.translate(0, 1.2, 0);
  parts.push(part(torso, 0, 0));
  const head = new THREE.SphereGeometry(0.11, seg + 1, seg); head.translate(0, 1.58, 0.01); parts.push(part(head, 4, 1));
  if (detail) { const hair = new THREE.SphereGeometry(0.115, seg + 1, 4, 0, Math.PI * 2, 0, Math.PI * 0.5); hair.translate(0, 1.6, -0.01); parts.push(part(hair, 4, 2)); }
  for (const s of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.05, 0.46, 1, seg); arm.translate(s * 0.23, 1.14, 0);
    parts.push(part(arm, s < 0 ? 2 : 1, 0));
    const hand = new THREE.SphereGeometry(0.05, 5, 4); hand.translate(s * 0.23, 0.86, 0); parts.push(part(hand, s < 0 ? 2 : 1, 1));
  }
  const legs = new THREE.BoxGeometry(0.3, 0.85, 0.18); legs.translate(0, 0.45, 0); parts.push(part(legs, 3, 3));
  return mergeGeometries(parts);
}

const VERT_HEAD = `
attribute float aPart; attribute float aSel;
attribute vec3 iShirt; attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iPants;
attribute vec4 iParams; // phase, energy, standBias, team
uniform float uTime; uniform float uExcite; uniform float uPulse; uniform float uStand; uniform float uCelebrate; uniform vec3 uFocus;
varying vec3 vCrowdColor;
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
`;
const VERT_BODY = `
  float ph = iParams.x; float en = iParams.y;
  float excite = clamp(uExcite * (0.55 + en) + uPulse * en, 0.0, 1.4);
  float stand = clamp(iParams.z + uStand * (0.6 + en * 0.6) + step(0.95, excite) * 0.6 + uCelebrate, 0.0, 1.0);
  vec3 p = transformed;
  // sitting: fold the legs forward at the hip and lower the body
  if (aPart == 3.0) {
    vec3 hip = vec3(0.0, 0.85, 0.0);
    p = hip + rotX(-1.45 * (1.0 - stand)) * (p - hip);
  }
  // arms: raise with excitement, pump when cheering
  float wave = sin(uTime * (6.0 + en * 4.0) + ph * 6.283);
  float raise = clamp(excite * 1.25 - 0.35 + uCelebrate, 0.0, 1.0);
  if (aPart == 1.0 || aPart == 2.0) {
    float side = aPart == 1.0 ? 1.0 : -1.0;
    vec3 sh = vec3(side * 0.23, 1.38, 0.0);
    float a = raise * (2.7 + 0.25 * wave) + (1.0 - raise) * 0.15 * wave * excite;
    float clap = (1.0 - raise) * clamp(excite * 2.0 - 0.6, 0.0, 1.0);
    p = sh + rotZ(side * a) * rotX(-clap * (1.1 + 0.3 * wave)) * (p - sh);
  }
  if (aPart == 4.0) { p.x += sin(uTime * 1.3 + ph * 20.0) * 0.02; }
  // bounce + sit height
  float bounce = abs(sin(uTime * 7.0 + ph * 6.283)) * 0.07 * clamp(excite - 0.25, 0.0, 1.0) * (0.4 + stand);
  p.y += bounce - (1.0 - stand) * 0.42;
  transformed = p;
  vCrowdColor = aSel < 0.5 ? iShirt : aSel < 1.5 ? iSkin : aSel < 2.5 ? iHair : iPants;
`;

const SHIRTS = ['#c8102e', '#1a3a8f', '#f2f2f2', '#111111', '#ffcc00', '#2e8b57', '#ff6a00', '#6a0dad', '#444a55', '#e0e0e0', '#0f5c8a', '#8b0000'];
const SKINS = ['#f1c7a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac'];
const HAIRS = ['#1b1b1b', '#3b2412', '#6a4e2a', '#b08d57', '#999999', '#d8c078'];
const PANTS = ['#1d2433', '#2b2b2b', '#3c4b6b', '#4a3b2a', '#101010'];

export class CrowdSystem {
  constructor(scene, seats, { density = 1 } = {}) {
    this.uniforms = {
      uTime: { value: 0 }, uExcite: { value: 0.25 }, uPulse: { value: 0 }, uStand: { value: 0 }, uCelebrate: { value: 0 },
      uFocus: { value: new THREE.Vector3() },
    };
    this.excite = 0.25; this.target = 0.25; this.pulse = 0; this.stand = 0; this.celebrate = 0;
    this.meshes = [];
    const nearGeo = spectatorGeometry(true), farGeo = spectatorGeometry(false);
    const material = new THREE.MeshLambertMaterial({ color: 0x9a9a9a });
    material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = VERT_HEAD + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY);
      sh.fragmentShader = 'varying vec3 vCrowdColor;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vCrowdColor, opacity );');
    };
    // group seats by side + LOD
    const groups = new Map();
    for (const s of seats) {
      if (Math.random() > density * 0.93) continue; // some empty seats
      const key = s.side + ':' + (s.row < 5 ? 'n' : 'f');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    // re-bucket: seats carry a per-seat side index – bucket per 120 seats to keep culling useful
    const buckets = [];
    for (const [key, list] of groups) buckets.push({ near: key.endsWith('n'), list });
    const merged = new Map();
    for (const b of buckets) {
      const s0 = b.list[0];
      const k = (b.near ? 'n' : 'f') + ':' + Math.round(Math.atan2(s0.x, s0.z) * 2);
      if (!merged.has(k)) merged.set(k, { near: b.near, list: [] });
      merged.get(k).list.push(...b.list);
    }
    const col = new THREE.Color();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    this.count = 0;
    for (const { near, list } of merged.values()) {
      const geo = (near ? nearGeo : farGeo).clone();
      const n = list.length;
      const shirt = new Float32Array(n * 3), skin = new Float32Array(n * 3), hair = new Float32Array(n * 3), pants = new Float32Array(n * 3), params = new Float32Array(n * 4);
      const mesh = new THREE.InstancedMesh(geo, material, n);
      list.forEach((s, i) => {
        const size = 0.9 + Math.random() * 0.2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw + (Math.random() - 0.5) * 0.3);
        pos.set(s.x, s.y + 0.02, s.z); sc.setScalar(size);
        m4.compose(pos, q, sc); mesh.setMatrixAt(i, m4);
        col.set(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]).convertSRGBToLinear(); shirt.set([col.r, col.g, col.b], i * 3);
        col.set(SKINS[Math.floor(Math.random() * SKINS.length)]).convertSRGBToLinear(); skin.set([col.r, col.g, col.b], i * 3);
        col.set(HAIRS[Math.floor(Math.random() * HAIRS.length)]).convertSRGBToLinear(); hair.set([col.r, col.g, col.b], i * 3);
        col.set(PANTS[Math.floor(Math.random() * PANTS.length)]).convertSRGBToLinear(); pants.set([col.r, col.g, col.b], i * 3);
        params.set([Math.random(), 0.2 + Math.random() * 0.8, Math.random() < 0.12 ? 1 : 0, 0], i * 4);
      });
      geo.setAttribute('iShirt', new THREE.InstancedBufferAttribute(shirt, 3));
      geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 3));
      geo.setAttribute('iHair', new THREE.InstancedBufferAttribute(hair, 3));
      geo.setAttribute('iPants', new THREE.InstancedBufferAttribute(pants, 3));
      geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 4));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false; mesh.receiveShadow = false;
      scene.add(mesh);
      this.meshes.push(mesh);
      this.count += n;
    }
    this.buildFlashes(scene, seats);
  }

  /** Camera flashes in the stands on big moments. */
  buildFlashes(scene, seats) {
    const n = 220;
    const pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = seats[Math.floor(Math.random() * seats.length)];
      pos.set([s.x, s.y + 1.3, s.z], i * 3); ph[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this.flashU = { uTime: { value: 0 }, uAmt: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.flashU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aPh; uniform float uTime; uniform float uAmt; varying float vA;
        void main(){ float k = fract(uTime * 1.7 + aPh * 13.0); vA = step(0.985 - uAmt * 0.06, fract(aPh * 91.0 + floor(uTime * 9.0 + aPh * 5.0) * 0.137)) * uAmt;
        vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = 90.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0,1.0,1.0, vA * smoothstep(0.5,0.0,d)); }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    scene.add(pts);
  }

  /** React to a game event. */
  react(kind, amount = 0.3) {
    switch (kind) {
      case 'pop': this.pulse = Math.min(1.2, this.pulse + amount); this.target = Math.min(1, this.target + amount * 0.3); break;
      case 'big': this.pulse = 1.2; this.target = Math.min(1, this.target + 0.25); this.stand = Math.min(1, this.stand + 0.5); break;
      case 'celebrate': this.celebrate = 1; this.target = 1; break;
      case 'calm': this.celebrate = 0; this.target = 0.25; this.stand = 0; break;
      case 'nearfall': this.stand = Math.min(1, this.stand + 0.3); this.pulse = Math.min(1.2, this.pulse + 0.5); break;
    }
  }

  update(dt, time) {
    this.target += (0.3 - this.target) * dt * 0.05;
    this.excite += (this.target - this.excite) * Math.min(1, dt * 2);
    this.pulse = Math.max(0, this.pulse - dt * 0.9);
    this.stand = Math.max(0, this.stand - dt * 0.08);
    const u = this.uniforms;
    u.uTime.value = time; u.uExcite.value = this.excite; u.uPulse.value = this.pulse; u.uStand.value = this.stand; u.uCelebrate.value = this.celebrate;
    this.flashU.uTime.value = time; this.flashU.uAmt.value = Math.min(1, this.pulse * 0.8 + this.celebrate * 0.6 + Math.max(0, this.excite - 0.6));
  }

  /** 0..1 – used by audio for crowd loudness. */
  loudness() { return Math.min(1, this.excite * 0.7 + this.pulse * 0.5 + this.celebrate * 0.3); }
}
