// ArenaBuilder – builds the whole venue: ring (deformable ropes, posts,
// turnbuckle pads, apron), steel steps, mats, barricades, commentary desk,
// entrance stage + titantron, stands, light rig with volumetric cones,
// LED ribbon boards and the Hell-in-a-Cell structure.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from '@shared/config/arena.js';
import { RING_GRID } from '@shared/sim/constants.js';
import { CELL, EXTENT, cellCenter, levelFromHits } from '@shared/sim/RingDestruction.js';
import * as TX from './Textures.js';

const R = ARENA.ring;

// a spider-web cracked-glass texture (transparent, white crack lines) for a smashed windshield
let _crackTex = null;
function crackedGlassTexture() {
  if (_crackTex) return _crackTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(190,220,235,0.12)'; x.fillRect(0, 0, 256, 256);
  const cx = 150, cy = 120;                                 // impact point, off-centre
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineJoin = 'round';
  // radial fractures
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    x.lineWidth = 0.8 + Math.random() * 1.6;
    x.beginPath(); x.moveTo(cx, cy);
    let px = cx, py = cy;
    const segs = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < segs; s++) { px += Math.cos(a) * (18 + Math.random() * 30) + (Math.random() - 0.5) * 14; py += Math.sin(a) * (18 + Math.random() * 30) + (Math.random() - 0.5) * 14; x.lineTo(px, py); }
    x.stroke();
  }
  // concentric web rings
  for (let r = 14; r < 120; r += 16 + Math.random() * 10) {
    x.lineWidth = 0.6; x.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.3) { const rr = r * (0.85 + Math.random() * 0.3); const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; a === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  _crackTex = t; return t;
}

function std(opts) { return new THREE.MeshStandardMaterial(opts); }
function add(parent, geo, mat, { cast = true, receive = true, pos = null } = {}) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive;
  if (pos) m.position.set(...pos);
  parent.add(m); return m;
}
function boxAt(w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; }

export class ArenaView {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group(); this.group.name = 'arena';
    scene.add(this.group);
    this.ropes = [];         // { mesh, uniforms, side, index }
    this.ropeSides = [0, 1, 2, 3].map(() => ({ push: 0, vel: 0, t: 0.5, target: 0, ttarget: 0.5 }));
    this.seats = [];         // crowd seat transforms
    this.screens = [];
    this.movingLights = [];
    this.cones = [];
    this.cageShake = 0;
    this.buildFloor();
    this.buildRing();
    this.buildBarricades();
    this.buildDesk();
    this.buildEntrance();
    this.buildStands();
    this.buildLights();
    this.buildCage();
    this.buildZipline();
    this.buildBroadcastCameras();
  }

  /**
   * Physical TV broadcast cameras in the moat around the ring: a tripod + pan
   * head + camera body that tracks the action, each with a cameraman behind it.
   * Purely decorative world props; aimBroadcast() swings them toward the action.
   */
  buildBroadcastCameras() {
    this.broadcastCams = [];
    const metal = std({ color: 0x14151b, roughness: 0.5, metalness: 0.7 });
    const body = std({ color: 0x0b0c10, roughness: 0.6, metalness: 0.3 });
    const lensMat = std({ color: 0x05060a, roughness: 0.2, metalness: 0.9, emissive: 0x101826, emissiveIntensity: 0.4 });
    const skin = std({ color: 0x9a6a44, roughness: 0.8 });
    const shirt = std({ color: 0x1b2744, roughness: 0.8 });
    // moat positions (between apron 3.7 and barricade ~8), each aimed inward
    const spots = [
      { x: 6.4, z: 5.6 }, { x: -6.4, z: 5.6 },   // the two near (hard-cam side) corners
      { x: 6.4, z: -5.4 }, { x: -6.4, z: -5.4 }, // the two far corners
    ];
    for (const s of spots) {
      const rig = new THREE.Group(); rig.position.set(s.x, 0, s.z); this.group.add(rig);
      // tripod: three splayed legs + a short column
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = add(rig, new THREE.CylinderGeometry(0.03, 0.04, 1.45, 6), metal, { pos: [Math.cos(a) * 0.28, 0.7, Math.sin(a) * 0.28] });
        leg.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
      }
      add(rig, new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), metal, { pos: [0, 1.4, 0] });
      // pan head: yaws/pitches to track the action
      const head = new THREE.Group(); head.position.set(0, 1.5, 0); rig.add(head);
      add(head, new THREE.BoxGeometry(0.4, 0.3, 0.6), body);                          // camera body
      add(head, new THREE.CylinderGeometry(0.11, 0.13, 0.4, 16).rotateX(Math.PI / 2), body, { pos: [0, 0.02, 0.42] }); // lens barrel
      add(head, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 16).rotateX(Math.PI / 2), lensMat, { pos: [0, 0.02, 0.63] }); // glass
      add(head, new THREE.BoxGeometry(0.18, 0.1, 0.18), body, { pos: [0, 0.22, -0.1] }); // viewfinder hood
      const tally = add(head, new THREE.SphereGeometry(0.03, 8, 8), std({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 1.2, roughness: 0.4 }), { pos: [0.16, 0.14, 0.2] });
      // cameraman standing behind the rig
      const op = new THREE.Group(); op.position.set(0, 0, -0.45); rig.add(op);
      add(op, new THREE.CylinderGeometry(0.17, 0.2, 0.9, 10), shirt, { pos: [0, 0.95, 0] }); // torso
      add(op, new THREE.CylinderGeometry(0.13, 0.15, 0.85, 8), std({ color: 0x12131a, roughness: 0.85 }), { pos: [0, 0.42, 0] }); // legs
      add(op, new THREE.SphereGeometry(0.15, 12, 12), skin, { pos: [0, 1.52, 0.02] }); // head
      // face the rig toward the ring to start
      rig.rotation.y = Math.atan2(-s.x, -s.z);
      this.broadcastCams.push({ rig, head, op, x: s.x, z: s.z });
    }
  }

  /** Swing every broadcast camera (and its operator) to track a world point. */
  aimBroadcast(dt, cx = 0, cz = 0, cy = 1.4) {
    if (!this.broadcastCams) return;
    const k = Math.min(1, dt * 3);
    for (const b of this.broadcastCams) {
      const dx = cx - b.x, dz = cz - b.z;
      const yaw = Math.atan2(dx, dz);
      const dist = Math.hypot(dx, dz) || 1;
      const pitch = Math.atan2((b.head.position.y + 0) - cy, dist); // tilt down toward lower action
      b.head.rotation.y += (yaw - b.head.rotation.y) * k;
      b.head.rotation.x += (pitch - b.head.rotation.x) * k;
      b.op.rotation.y += (yaw - b.op.rotation.y) * k; // operator turns with the camera
    }
  }

  /** A zipline from a platform in the back stands up over the ring (the overhead-drop route). */
  buildZipline() {
    const B = ARENA.barricade, topY = 7.2, startZ = -(B.halfZ + 1.2);
    const metal = std({ color: 0x1a1c22, roughness: 0.5, metalness: 0.85 });
    // launch platform + support tower at the back
    add(this.group, new THREE.BoxGeometry(2.4, 0.2, 1.6), metal, { pos: [0, topY, startZ] });
    for (const sx of [-1, 1]) add(this.group, new THREE.CylinderGeometry(0.1, 0.12, topY, 10), metal, { pos: [sx * 1.0, topY / 2, startZ] });
    // a real staircase up to the platform (this is how you physically get up there)
    const steps = 10, rise = topY / steps, run = 0.34;
    for (let i = 0; i < steps; i++) {
      add(this.group, new THREE.BoxGeometry(1.5, rise * 0.9, run), metal,
        { cast: false, pos: [0, rise * (i + 0.5), startZ - 1.0 - i * run] });
    }
    // handrails either side of the flight
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, steps * run * 1.45), metal);
      rail.position.set(sx * 0.78, topY * 0.62, startZ - 1.0 - (steps * run) / 2);
      rail.rotation.x = -Math.atan2(topY, steps * run);
      this.group.add(rail);
    }
    // the cable itself, sloping down from the platform to above the ring centre
    const a = new THREE.Vector3(0, topY + 0.2, startZ), bpt = new THREE.Vector3(0, topY - 0.4, 0.3);
    const len = a.distanceTo(bpt);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), std({ color: 0x0a0a0c, metalness: 0.7, roughness: 0.4 }));
    cable.position.copy(a).lerp(bpt, 0.5);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bpt.clone().sub(a).normalize());
    cable.frustumCulled = false; this.group.add(cable);
  }

  // ── floor & mats ──
  buildFloor() {
    const floor = add(this.group, new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), std({ map: TX.floorTexture(), roughness: 0.55, metalness: 0.2 }), { cast: false });
    floor.position.y = -0.002;
    const B = ARENA.barricade;
    const matGeo = new THREE.PlaneGeometry(B.halfX * 2, B.halfZ * 2).rotateX(-Math.PI / 2);
    add(this.group, matGeo, std({ map: TX.matTexture(), roughness: 0.62, metalness: 0.05 }), { cast: false, pos: [0, 0.004, 0] });
  }

  // ── ring ──
  buildRing() {
    const g = new THREE.Group(); g.name = 'ring'; this.group.add(g);
    const H = R.height, A = R.apronHalf;
    // platform body with apron skirt
    const apronTex = TX.apronTexture();
    const skirt = std({ map: apronTex, roughness: 0.8 });
    const canvasMat = std({ map: TX.ringCanvasTexture(), roughness: 0.88, metalness: 0 });
    // Recessed platform: the solid body stops SUB below the canvas, leaving an
    // under-ring space. The canvas surface is a grid of tiles on top; break a tile
    // and there's a real hole down to the dark subfloor (a fallen wrestler is visible).
    const SUB = 0.8;
    const subMat = std({ color: 0x241913, roughness: 1 }); // dark wooden subfloor seen through holes
    const plat = new THREE.BoxGeometry(A * 2, H - SUB, A * 2);
    add(g, plat, [skirt, skirt, subMat, skirt, skirt, skirt], { pos: [0, (H - SUB) / 2, 0] });
    // the 9 destructible canvas tiles over the playing area (indexed by destruction cell)
    this._surfaceTiles = [];
    const tileGeo = new THREE.BoxGeometry(CELL, 0.08, CELL);
    for (let k = 0; k < 9; k++) { const c = cellCenter(k); this._surfaceTiles[k] = add(g, tileGeo, canvasMat, { pos: [c.x, H - 0.04, c.z] }); }
    // solid canvas border frame from the playing area out to the apron edge (never breaks)
    const bw = A - EXTENT;
    for (const [ox, oz, w, d] of [[0, (A + EXTENT) / 2, A * 2, bw], [0, -(A + EXTENT) / 2, A * 2, bw], [(A + EXTENT) / 2, 0, bw, EXTENT * 2], [-(A + EXTENT) / 2, 0, bw, EXTENT * 2]])
      add(g, new THREE.BoxGeometry(w, 0.08, d), canvasMat, { pos: [ox, H - 0.04, oz] });
    // apron edge trim
    const trim = std({ color: 0x0a0c14, roughness: 0.4, metalness: 0.4 });
    for (const s of [-1, 1]) {
      add(g, new THREE.BoxGeometry(A * 2 + 0.04, 0.06, 0.06), trim, { pos: [0, H, s * A] });
      add(g, new THREE.BoxGeometry(0.06, 0.06, A * 2 + 0.04), trim, { pos: [s * A, H, 0] });
    }
    // posts & turnbuckle pads
    const steel = std({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.3 });
    const padMat = std({ color: 0xc8102e, roughness: 0.55 });
    const padMat2 = std({ color: 0x1a2a55, roughness: 0.55 });
    const pi = R.postInset;
    const top = H + R.postHeight;
    const postGeo = new THREE.CylinderGeometry(0.065, 0.075, top, 16); postGeo.translate(0, top / 2, 0);
    const cornerPad = new THREE.BoxGeometry(0.28, R.postHeight * 0.92, 0.28); cornerPad.translate(0, H + R.postHeight * 0.46 + 0.02, 0);
    for (const [sx, sz, i] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) {
      add(g, postGeo, steel, { pos: [sx * pi, 0, sz * pi] });
      const pad = add(g, cornerPad, i % 2 ? padMat2 : padMat, { pos: [sx * (pi - 0.1), 0, sz * (pi - 0.1)] });
      pad.rotation.y = Math.PI / 4;
      // turnbuckle hardware
      for (const rh of R.ropeHeights) add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8).rotateZ(Math.PI / 2), steel, { pos: [sx * (pi - 0.12), H + rh, sz * (pi - 0.12)] });
    }
    // ropes (deformable via vertex shader)
    const ropeColors = [0xc8102e, 0xf0f0f0, 0x1a3a8f];
    const sides = [
      { a: [-pi, pi], b: [pi, pi] },   // +z
      { a: [pi, pi], b: [pi, -pi] },   // +x
      { a: [pi, -pi], b: [-pi, -pi] }, // -z
      { a: [-pi, -pi], b: [-pi, pi] }, // -x
    ];
    sides.forEach((sd, side) => {
      R.ropeHeights.forEach((rh, idx) => {
        const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
        const geo = new THREE.CylinderGeometry(0.032, 0.032, len, 10, 40, true);
        geo.rotateZ(Math.PI / 2); // along X
        const pos = geo.attributes.position;
        const tAttr = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) tAttr[i] = pos.getX(i) / len + 0.5;
        geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1));
        const uniforms = { uPush: { value: new THREE.Vector3() }, uT: { value: 0.5 } };
        const mat = std({ color: ropeColors[idx], roughness: 0.45, metalness: 0.05 });
        mat.onBeforeCompile = (sh) => {
          Object.assign(sh.uniforms, uniforms);
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aT; uniform vec3 uPush; uniform float uT;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              float tent = aT < uT ? aT / max(uT, 0.001) : (1.0 - aT) / max(1.0 - uT, 0.001);
              tent = smoothstep(0.0, 1.0, tent);
              transformed += (inverse(mat3(modelMatrix)) * uPush) * tent;`);
        };
        const m = add(g, geo, mat, { cast: true, receive: false });
        m.position.set((sd.a[0] + sd.b[0]) / 2, H + rh, (sd.a[1] + sd.b[1]) / 2);
        m.rotation.y = -Math.atan2(sd.b[1] - sd.a[1], sd.b[0] - sd.a[0]);
        m.frustumCulled = false;
        this.ropes.push({ mesh: m, uniforms, side, index: idx, height: rh });
      });
    });
    // rope ties between ropes at the middle of each side
    // steel steps at two corners
    const stepsMat = std({ color: 0x6c737c, metalness: 0.85, roughness: 0.4 });
    for (const [sx, sz] of [[1, -1], [-1, 1]]) {
      const st = new THREE.Group();
      for (let k = 0; k < 3; k++) add(st, new THREE.BoxGeometry(1.1, 0.34, 0.45), stepsMat, { pos: [0, 0.17 + k * 0.34, -k * 0.38] });
      st.position.set(sx * (A + 0.55), 0, sz * (A + 0.55));
      st.rotation.y = Math.atan2(sx, sz) + Math.PI;
      g.add(st);
    }
    // ring bell table (timekeeper)
    add(g, new THREE.BoxGeometry(1.2, 0.72, 0.6), std({ color: 0x0b0e18, roughness: 0.6 }), { pos: [2.6, 0.36, -6.3] });
  }

  /** Deform the ropes based on nearby fighters (push = metres). */
  updateRopes(dt, fighters) {
    const lim = R.ropeLine;
    for (const s of this.ropeSides) { s.target = 0; }
    for (const f of fighters) {
      if (f.hidden || f.zone !== 'ring') continue;
      const r = f.c ? f.c.radius : 0.35;
      const cand = [
        { side: 0, pen: f.z + r * 0.8 - lim, t: (f.x + R.postInset) / (2 * R.postInset) },
        { side: 1, pen: f.x + r * 0.8 - lim, t: (R.postInset - f.z) / (2 * R.postInset) },
        { side: 2, pen: -f.z + r * 0.8 - lim, t: (R.postInset - f.x) / (2 * R.postInset) },
        { side: 3, pen: -f.x + r * 0.8 - lim, t: (f.z + R.postInset) / (2 * R.postInset) },
      ];
      for (const c of cand) {
        if (c.pen > -0.05) {
          const s = this.ropeSides[c.side];
          const p = Math.min(0.42, Math.max(0, c.pen + 0.05) * 1.3);
          if (p > s.target) { s.target = p; s.ttarget = Math.min(0.92, Math.max(0.08, c.t)); s.h = f.y; }
        }
      }
    }
    const normals = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let i = 0; i < 4; i++) {
      const s = this.ropeSides[i];
      // spring toward target so ropes wobble after release
      const k = 260, c = 9;
      s.vel += (k * (s.target - s.push) - c * s.vel) * dt;
      s.push += s.vel * dt;
      s.t += (s.ttarget - s.t) * Math.min(1, dt * 12);
    }
    for (const rope of this.ropes) {
      const s = this.ropeSides[rope.side];
      const n = normals[rope.side];
      // ropes near the torso height get pushed more
      const hw = s.h != null ? Math.max(0.35, 1 - Math.abs((s.h + 1.0) - (R.height + rope.height)) * 0.8) : 1;
      rope.uniforms.uPush.value.set(n[0] * s.push * hw, 0, n[1] * s.push * hw);
      rope.uniforms.uT.value = s.t;
    }
  }

  /** Kick a rope side (rebound / impact) for visible vibration. */
  twang(x, z, amount = 0.25) {
    const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 1 : 3) : (z > 0 ? 0 : 2);
    this.ropeSides[side].vel += amount * 12;
  }

  // ── barricades ──
  buildBarricades() {
    const B = ARENA.barricade;
    const padMat = std({ map: TX.barricadeTexture(), roughness: 0.7 });
    const rail = std({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.3 });
    const segs = [];
    const railGeos = [];
    const h = B.height;
    const addSeg = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(len, h - 0.1, 0.1);
      g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      g.translate((x0 + x1) / 2, (h - 0.1) / 2, (z0 + z1) / 2);
      segs.push(g);
      const r = new THREE.CylinderGeometry(0.035, 0.035, len, 8); r.rotateZ(Math.PI / 2); r.rotateY(-Math.atan2(z1 - z0, x1 - x0));
      r.translate((x0 + x1) / 2, h, (z0 + z1) / 2);
      railGeos.push(r);
    };
    addSeg(-B.halfX, -B.halfZ, B.halfX, -B.halfZ);
    addSeg(B.halfX, -B.halfZ, B.halfX, B.halfZ);
    addSeg(-B.halfX, B.halfZ, -B.halfX, -B.halfZ);
    addSeg(B.halfX, B.halfZ, B.gapHalf, B.halfZ);
    addSeg(-B.gapHalf, B.halfZ, -B.halfX, B.halfZ);
    const bm = add(this.group, mergeGeometries(segs), padMat); bm.name = 'barricades';
    add(this.group, mergeGeometries(railGeos), rail);
    this.barricadeMeshes = [bm];
    this.buildAds();
    this.buildRingDamage();
  }

  /**
   * Park the two car models (car1.glb / car2.glb) by the entrance. Each gets a
   * breakable windshield pane we can shatter when a wrestler is slammed into it.
   * @param {object} assets AssetManager (props already loaded)
   */
  placeCars(assets) {
    const E = ARENA.entrance, stageZ = E.zEnd + 2;
    const specs = [{ id: 'car1', x: -6.5, z: 12.5 }, { id: 'car2', x: 6.8, z: 12.8 }];
    this.cars = [];
    for (const s of specs) {
      const src = assets.props?.[s.id]; if (!src) continue;
      const car = src.clone(true);
      const box = new THREE.Box3().setFromObject(car);
      const len = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
      const scale = 4.3 / len;                                   // ~4.3 m long
      car.scale.setScalar(scale);
      car.position.set(s.x, -box.min.y * scale, s.z);
      car.rotation.y = Math.atan2(-s.x, -s.z);                   // face the arena/ring (center)
      car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      this.group.add(car);
      // a windshield pane (breakable) sitting on the car, tilted, facing the stage
      const rotY = car.rotation.y;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x9fd0e6, transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide }));
      const b2 = new THREE.Box3().setFromObject(car);
      pane.position.set(s.x + Math.sin(rotY) * 0.6, (b2.max.y - b2.min.y) * 0.6, s.z + Math.cos(rotY) * 0.6);
      pane.rotation.set(-0.9, rotY, 0);
      this.group.add(pane);
      this.cars.push({ group: car, pane, x: s.x, z: s.z, rotY, broken: false });
    }
  }

  /** Nearest car within `range` of (x,z), or null. */
  carNear(x, z, range = 2.6) {
    if (!this.cars) return null;
    let best = null, bd = range;
    for (const c of this.cars) { const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /**
   * Windshield damage, two beats: first impact CRACKS it (spider-web texture),
   * the next SHATTERS it (pane gone → empty frame; glass shards spawned by the
   * caller's carCrashFX). Returns 'crack' | 'shatter' | false (nothing to do).
   */
  breakCar(car) {
    if (!car || car.broken) return false;
    if (!car.cracked) {
      car.cracked = true;
      if (car.pane) {
        car.pane.material.map = crackedGlassTexture();
        car.pane.material.color.set(0xffffff);
        car.pane.material.opacity = 0.9;
        car.pane.material.needsUpdate = true;
        car.pane.rotation.z += 0.03;
      }
      return 'crack';
    }
    car.broken = true;
    if (car.pane) { car.pane.visible = false; }   // shattered out – just the dark empty frame remains
    return 'shatter';
  }

  /** Restore both cars' windshields (called on match cleanup). */
  resetCars() {
    for (const car of this.cars || []) {
      car.broken = false; car.cracked = false; car._crashing = false;
      if (car.pane) { car.pane.visible = true; car.pane.material.map = null; car.pane.material.color.set(0x9fd0e6); car.pane.material.opacity = 0.45; car.pane.material.needsUpdate = true; }
    }
  }

  // ── ring destruction overlays (cracks + holes), toggled from the snapshot ──
  buildRingDamage() {
    this.ringDmgCells = [];
    this.ringDmgState = [];
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x15151a, transparent: true, opacity: 0.7, toneMapped: false });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
    this._ringDmgMats = { crack: crackMat, hole: holeMat };
    const geo = new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2);
    for (let k = 0; k < RING_GRID * RING_GRID; k++) {
      const c = cellCenter(k);
      const m = new THREE.Mesh(geo, crackMat);
      m.position.set(c.x, R.height + 0.02, c.z);
      m.visible = false; m.castShadow = false; m.receiveShadow = false;
      this.group.add(m);
      this.ringDmgCells.push(m);
      this.ringDmgState.push(0);
    }
  }

  /** Layered collapsed section: dark pit, torn tilted canvas, exposed wood beams + planks. */
  spawnRingDebris(k) {
    this._debris = this._debris || {};
    if (this._debris[k]) return;
    const c = cellCenter(k);
    const grp = new THREE.Group(); grp.position.set(c.x, R.height, c.z);
    const plankMat = std({ color: 0x5a3d22, roughness: 0.95 });
    const beamMat = std({ color: 0x3f2c18, roughness: 1 });
    const darkMat = std({ color: 0x100c08, roughness: 1 });
    const canvasMat = std({ color: 0xcfd2d6, roughness: 0.9 });
    // sunken dark pit floor
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.98, CELL * 0.98).rotateX(-Math.PI / 2), darkMat);
    pit.position.y = -1.5; grp.add(pit);
    // exposed support beams across the gap (tilted, broken)
    for (let i = 0; i < 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.9, 0.1, 0.14), beamMat);
      beam.position.set((Math.random() - 0.5) * 0.3, -0.35 - i * 0.2, (i - 0.5) * CELL * 0.5);
      beam.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 0.5, (Math.random() - 0.5) * 0.5);
      beam.castShadow = true; grp.add(beam);
    }
    // the whole section has COLLAPSED: a big canvas+plywood slab hinged at one
    // edge and tilted ~38° down into the hole (physical, not a flat decal)
    const tilt = 0.66; // ~38°, within the 30–45° ask
    const slab = new THREE.Group();
    const plankTop = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.9), canvasMat);
    plankTop.rotation.x = -Math.PI / 2; plankTop.material.side = THREE.DoubleSide; slab.add(plankTop);
    const woodUnder = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.92, 0.08, CELL * 0.9), std({ color: 0x6b4a28, roughness: 0.95 }));
    woodUnder.position.y = -0.06; slab.add(woodUnder);
    // hinge at the -z edge, dip the +z edge into the pit
    slab.position.set(0, -0.02, -CELL * 0.45);
    slab.rotation.x = tilt;
    slab.position.z += Math.sin(tilt) * CELL * 0.45; slab.position.y -= Math.sin(tilt) * CELL * 0.35;
    grp.add(slab);
    // torn canvas flaps folding down into the hole (tilted slabs, not a flat square)
    for (const s of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.55, CELL * 0.5), canvasMat);
      flap.position.set(s * CELL * 0.26, -0.1, 0);
      flap.rotation.set(-Math.PI / 2 + s * 0.8, s * 0.3, 0); // peeled up and tilted into the pit
      flap.material.side = THREE.DoubleSide; grp.add(flap);
    }
    // splintered planks strewn around the rim
    for (let i = 0; i < 8; i++) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.1 + Math.random() * 0.12, 0.06, 0.5 + Math.random() * 0.6), plankMat);
      pl.position.set((Math.random() - 0.5) * CELL * 0.9, 0.03 + Math.random() * 0.14, (Math.random() - 0.5) * CELL * 0.9);
      pl.rotation.set((Math.random() - 0.5) * 0.8, Math.random() * Math.PI, (Math.random() - 0.5) * 0.7);
      pl.castShadow = true; grp.add(pl);
    }
    // a ring of dirt/dust on the canvas around the break (child of grp so it clears with it)
    const dirt = new THREE.Mesh(new THREE.RingGeometry(CELL * 0.45, CELL * 0.72, 20).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.5, depthWrite: false }));
    dirt.position.set(0, 0.015, 0); dirt.renderOrder = 2; grp.add(dirt);
    this.group.add(grp); this._debris[k] = grp;
  }

  /**
   * Snap a rope on a given side: it stays anchored at one post and the broken
   * half droops/hangs down to the mat from the snap point. Returns true if it broke.
   */
  breakRope(side, idx = Math.floor(Math.random() * 3)) {
    this._brokenRopes = this._brokenRopes || new Set();
    const key = side + '-' + idx;
    if (this._brokenRopes.has(key)) return false;
    const rope = this.ropes.find((r) => r.side === side && r.index === idx);
    if (!rope) return false;
    this._brokenRopes.add(key);
    rope.mesh.visible = false;                              // taut rope is gone
    rope.broken = true;
    const pi = R.postInset, H = R.height, y = H + rope.height;
    const ends = [
      [[-pi, pi], [pi, pi]], [[pi, pi], [pi, -pi]], [[pi, -pi], [-pi, -pi]], [[-pi, -pi], [-pi, pi]],
    ][side];
    const a = new THREE.Vector3(ends[0][0], y, ends[0][1]);
    const b = new THREE.Vector3(ends[1][0], y, ends[1][1]);
    const col = [0xc8102e, 0xf0f0f0, 0x1a3a8f][idx];
    const mat = std({ color: col, roughness: 0.5 });
    const grp = new THREE.Group(); this.group.add(grp);
    // the attached half still spans ~60% from post A, sagging
    const mid = a.clone().lerp(b, 0.55);
    const seg1 = this._ropePiece(a, mid.clone().setY(y - 0.25), mat); grp.add(seg1);
    // the snapped half hangs straight down from the break point to the mat
    const hangTop = mid.clone().setY(y - 0.25);
    const hangBot = mid.clone().setY(H + 0.05);
    grp.add(this._ropePiece(hangTop, hangBot, mat));
    // a frayed stub dangling off post B
    grp.add(this._ropePiece(b, b.clone().setY(y - 0.4).lerp(a, 0.08), mat));
    this._ropeDebris = this._ropeDebris || []; this._ropeDebris.push(grp);
    return true;
  }
  _ropePiece(p0, p1, mat) {
    const len = p0.distanceTo(p1);
    const geo = new THREE.CylinderGeometry(0.032, 0.032, Math.max(0.05, len), 8);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p0).lerp(p1, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    m.castShadow = true; m.frustumCulled = false;
    return m;
  }

  /** Clear all ring-break visuals (called between matches). */
  resetRingDamage() {
    if (this._debris) {
      for (const g of Object.values(this._debris)) {
        this.group.remove(g);
        g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } });
      }
      this._debris = {};
    }
    if (this.ringDmgCells) for (let k = 0; k < this.ringDmgCells.length; k++) { this.ringDmgCells[k].visible = false; this.ringDmgState[k] = 0; }
    if (this._surfaceTiles) for (const t of this._surfaceTiles) t.visible = true;   // restore broken canvas tiles
    // restore snapped ropes
    if (this._ropeDebris) { for (const g of this._ropeDebris) { this.group.remove(g); g.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); o.material?.dispose?.(); } }); } this._ropeDebris = []; }
    for (const rope of this.ropes || []) { rope.mesh.visible = true; rope.broken = false; }
    this._brokenRopes = new Set();
  }

  /** Target shadow on the canvas showing where a rafter diver will land. */
  showDropShadow(x, z, on) {
    if (!this._dropShadow) {
      const g = new THREE.RingGeometry(0.5, 1.3, 28).rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.5, toneMapped: false });
      this._dropShadow = new THREE.Mesh(g, m); this._dropShadow.visible = false;
      this._dropShadow.renderOrder = 2; this.group.add(this._dropShadow);
    }
    const s = this._dropShadow;
    s.visible = !!on;
    if (on) {
      s.position.set(x, R.height + 0.03, z);
      s.material.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(performance.now() * 0.012)); // pulse
    }
  }

  /** Update crack/hole overlays from the authoritative hit-count array. */
  updateRingDamage(cells) {
    if (!cells || !this.ringDmgCells) return;
    for (let k = 0; k < this.ringDmgCells.length; k++) {
      const lvl = levelFromHits(cells[k] || 0);
      if (lvl === this.ringDmgState[k]) continue;
      this.ringDmgState[k] = lvl;
      const m = this.ringDmgCells[k];
      if (lvl === 0) { m.visible = false; continue; }
      if (lvl === 2) {
        // broken: remove the canvas tile → a real hole down to the subfloor, then add debris
        m.visible = false;
        if (this._surfaceTiles?.[k]) this._surfaceTiles[k].visible = false;
        this.spawnRingDebris(k);
      } else {
        // cracked/bent canvas: a dark sagging patch tilted slightly
        m.visible = true; m.material = this._ringDmgMats.crack;
        m.position.y = R.height + 0.015;
        m.rotation.set(0.06, 0, 0.05); // slight sag/bend (geometry is already flat)
        m.renderOrder = 3;
      }
    }
  }

  // ── ringside advertising hoardings on the barricades (face the ring) ──
  buildAds() {
    const B = ARENA.barricade;
    const base = ((typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/').replace(/\/$/, '');
    const loader = new THREE.TextureLoader();
    const mats = ['assets/ads/add1.png', 'assets/ads/add2.png'].map((p) => {
      const tex = loader.load(base + '/' + p);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    });
    const W = 2.6, H = 0.8, y = 0.55, inset = 0.06;
    const geo = new THREE.PlaneGeometry(W, H);
    let n = 0;
    const banner = (x, z, rotY) => {
      const m = add(this.group, geo, mats[n++ % mats.length], { cast: false, receive: false, pos: [x, y, z] });
      m.rotation.y = rotY;
    };
    // back side (z = -halfZ), faces +Z toward the ring
    for (const x of [-4.2, 0, 4.2]) banner(x, -B.halfZ + inset, 0);
    // left / right sides, face inward
    for (const z of [-3, 1.5]) banner(-B.halfX + inset, z, Math.PI / 2);
    for (const z of [-3, 1.5]) banner(B.halfX - inset, z, -Math.PI / 2);
    // entrance side (z = +halfZ) either side of the walkway gap, face -Z
    for (const x of [-5.2, 5.2]) banner(x, B.halfZ - inset, Math.PI);
    this.buildWallAds(mats);
  }

  /** Big sponsor boards high on the far left/right black walls + an overhead light/metal rig. */
  buildWallAds(mats) {
    const St = ARENA.stands;
    const wallX = St.innerX + St.rows * St.rowDepth + 1.5;   // just behind the top of the stands
    const bigGeo = new THREE.PlaneGeometry(14, 6);
    // a big board on each side wall, facing inward, up above the crowd
    const L = add(this.group, bigGeo, mats[0], { cast: false, receive: false, pos: [-wallX, 7.5, 0] }); L.rotation.y = Math.PI / 2;
    const Rr = add(this.group, bigGeo, mats[1 % mats.length], { cast: false, receive: false, pos: [wallX, 7.5, 0] }); Rr.rotation.y = -Math.PI / 2;
    // dark backing walls behind the boards so they read on "black walls"
    const wallMat = std({ color: 0x050507, roughness: 1 });
    const wallGeo = new THREE.PlaneGeometry(26, 12);
    const bL = add(this.group, wallGeo, wallMat, { cast: false, pos: [-wallX - 0.1, 7, 0] }); bL.rotation.y = Math.PI / 2;
    const bR = add(this.group, wallGeo, wallMat, { cast: false, pos: [wallX + 0.1, 7, 0] }); bR.rotation.y = -Math.PI / 2;
    // overhead metal truss rig + light fixtures
    const metal = std({ color: 0x1a1c22, roughness: 0.5, metalness: 0.8 });
    const bulb = new THREE.MeshBasicMaterial({ color: 0xfff4d8, toneMapped: false });
    const trussY = 12.5;
    for (const sx of [-1, 1]) {
      // a truss beam running along each side, up high
      add(this.group, new THREE.BoxGeometry(0.4, 0.4, 20), metal, { cast: false, pos: [sx * (St.innerX - 0.5), trussY, 0] });
      // a row of downlight fixtures hung off it
      for (const z of [-7, -3.5, 0, 3.5, 7]) {
        add(this.group, new THREE.BoxGeometry(0.5, 0.3, 0.5), metal, { cast: false, pos: [sx * (St.innerX - 0.5), trussY - 0.4, z] });
        add(this.group, new THREE.CircleGeometry(0.22, 12), bulb, { cast: false, pos: [sx * (St.innerX - 0.5), trussY - 0.62, z] }).rotation.x = -Math.PI / 2;
      }
    }
    // cross beams front/back
    for (const z of [-9, 9]) add(this.group, new THREE.BoxGeometry(St.innerX * 2, 0.35, 0.35), metal, { cast: false, pos: [0, trussY, z] });
  }

  // ── commentary desk ──
  buildDesk() {
    const D = ARENA.desk;
    const g = new THREE.Group(); g.position.set(D.x, 0, D.z); this.group.add(g);
    const skirt = std({ map: TX.deskTexture(), roughness: 0.6 });
    const topMat = std({ color: 0x0c0f18, roughness: 0.25, metalness: 0.3 });
    add(g, new THREE.BoxGeometry(D.halfX * 2, D.height - 0.05, D.halfZ * 2), [skirt, skirt, topMat, topMat, skirt, skirt], { pos: [0, (D.height - 0.05) / 2, 0] });
    add(g, new THREE.BoxGeometry(D.halfX * 2 + 0.1, 0.05, D.halfZ * 2 + 0.1), topMat, { pos: [0, D.height, 0] });
    // monitors + mics
    const mon = std({ color: 0x111111, roughness: 0.4 });
    const monScreen = new THREE.MeshBasicMaterial({ color: 0x3a6aff });
    for (const sx of [-0.8, 0.8]) {
      add(g, new THREE.BoxGeometry(0.5, 0.32, 0.04), mon, { pos: [sx, D.height + 0.2, 0.05] }).rotation.x = -0.2;
      add(g, new THREE.PlaneGeometry(0.46, 0.28), monScreen, { pos: [sx, D.height + 0.2, 0.075], cast: false }).rotation.set(-0.2, Math.PI, 0);
    }
    this.deskSeats = [{ x: D.x - 0.8, z: D.z - 0.7, yaw: 0 }, { x: D.x + 0.8, z: D.z - 0.7, yaw: 0 }];
    // chairs
    const chairMat = std({ color: 0x1a1a1a, roughness: 0.6 });
    for (const s of this.deskSeats) add(this.group, new THREE.BoxGeometry(0.5, 0.5, 0.5), chairMat, { pos: [s.x, 0.25, s.z - 0.15] });
  }

  // ── entrance stage & titantron ──
  buildEntrance() {
    const E = ARENA.entrance, B = ARENA.barricade;
    const g = new THREE.Group(); this.group.add(g);
    // walkway
    const walkMat = std({ color: 0x0c0c12, roughness: 0.5, metalness: 0.2 });
    add(g, new THREE.BoxGeometry(E.halfX * 2, 0.05, E.zEnd - B.halfZ + 4), walkMat, { pos: [0, 0.025, (B.halfZ + E.zEnd + 4) / 2 - 2] });
    // LED edge strips
    const strip = new THREE.MeshBasicMaterial({ color: 0x3a7bff });
    for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.05, 0.06, E.zEnd - B.halfZ + 4), strip, { pos: [s * E.halfX, 0.05, (B.halfZ + E.zEnd + 4) / 2 - 2], cast: false });
    this.walkStrip = strip;
    // stage
    const stageZ = E.zEnd + 0.5;
    add(g, new THREE.BoxGeometry(18, 0.8, 6), std({ color: 0x0a0a0f, roughness: 0.4, metalness: 0.3 }), { pos: [0, 0.4, stageZ + 3] });
    // titantron
    const tron = TX.screenCanvas(1280, 720);
    this.tron = tron;
    const tronMat = new THREE.MeshBasicMaterial({ map: tron.texture, toneMapped: false });
    const screen = add(g, new THREE.PlaneGeometry(14, 7.9), tronMat, { cast: false, receive: false, pos: [0, 7.6, stageZ + 5.4] });
    screen.rotation.y = Math.PI;
    add(g, new THREE.BoxGeometry(14.6, 8.5, 0.4), std({ color: 0x050507, roughness: 0.5 }), { pos: [0, 7.6, stageZ + 5.7] });
    // tunnel opening
    add(g, new THREE.BoxGeometry(4.2, 3.2, 0.3), std({ color: 0x020203, roughness: 1 }), { pos: [0, 2.4, stageZ + 5.5], cast: false });
    // side LED pillars
    this.pillars = [];
    for (const s of [-1, 1]) {
      const pc = TX.screenCanvas(256, 1024);
      const pm = new THREE.MeshBasicMaterial({ map: pc.texture, toneMapped: false });
      const p = add(g, new THREE.PlaneGeometry(2.2, 9), pm, { cast: false, receive: false, pos: [s * 8.6, 5.3, stageZ + 5.2] });
      p.rotation.y = Math.PI;
      this.pillars.push(pc);
    }
    this.screens.push(tron);
  }

  // ── stands ──
  buildStands() {
    const S = ARENA.stands;
    const stepMat = std({ color: 0x1b1d24, roughness: 0.85 });
    const geos = [];
    const sides = [
      { axis: 'z', sign: -1, inner: S.innerZ, from: -S.innerX - 2, to: S.innerX + 2 },
      { axis: 'x', sign: 1, inner: S.innerX, from: -S.innerZ, to: S.innerZ + 3 },
      { axis: 'x', sign: -1, inner: S.innerX, from: -S.innerZ, to: S.innerZ + 3 },
      { axis: 'z', sign: 1, inner: S.innerZ + 2.5, from: -S.innerX - 2, to: -9.5 },
      { axis: 'z', sign: 1, inner: S.innerZ + 2.5, from: 9.5, to: S.innerX + 2 },
    ];
    const seatSpacing = 0.64;
    for (const sd of sides) {
      const len = sd.to - sd.from, mid = (sd.from + sd.to) / 2;
      for (let r = 0; r < S.rows; r++) {
        const d = sd.inner + r * S.rowDepth, y = 0.55 + r * S.rowRise;
        const geo = new THREE.BoxGeometry(sd.axis === 'z' ? len : S.rowDepth, y, sd.axis === 'z' ? S.rowDepth : len);
        if (sd.axis === 'z') geo.translate(mid, y / 2, sd.sign * (d + S.rowDepth / 2));
        else geo.translate(sd.sign * (d + S.rowDepth / 2), y / 2, mid);
        geos.push(geo);
        // seats
        const n = Math.floor(len / seatSpacing);
        for (let k = 0; k < n; k++) {
          const a = sd.from + (k + 0.5) * (len / n) + (Math.random() - 0.5) * 0.12;
          const seat = sd.axis === 'z'
            ? { x: a, y, z: sd.sign * (d + S.rowDepth * 0.55) }
            : { x: sd.sign * (d + S.rowDepth * 0.55), y, z: a };
          seat.yaw = Math.atan2(-seat.x * (sd.axis === 'x' ? 1 : 0.15), -seat.z * (sd.axis === 'z' ? 1 : 0.15));
          seat.row = r; seat.side = this.seats.length;
          this.seats.push(seat);
        }
      }
      // front wall + LED ribbon board
      const front = sd.inner - 0.05;
      const board = TX.ledBoard(2048, 96);
      board.draw(['ALFREDO APPLERUN 2', 'WRESTLING', 'LIVE', '★']);
      const bm = new THREE.MeshBasicMaterial({ map: board.texture, toneMapped: false });
      board.texture.repeat.set(len / 12, 1);
      const bg = new THREE.PlaneGeometry(len, 0.5);
      const mesh = add(this.group, bg, bm, { cast: false, receive: false });
      if (sd.axis === 'z') { mesh.position.set(mid, 0.3, sd.sign * front); mesh.rotation.y = sd.sign > 0 ? Math.PI : 0; }
      else { mesh.position.set(sd.sign * front, 0.3, mid); mesh.rotation.y = -sd.sign * Math.PI / 2; }
      this.screens.push({ ...board, ribbon: true, mesh });
    }
    const stands = add(this.group, mergeGeometries(geos), stepMat, { cast: false });
    stands.name = 'stands';
    // back walls + ceiling (dark bowl for depth)
    const wallMat = std({ color: 0x07080c, roughness: 1 });
    const back = 10.5 + S.rows * S.rowDepth + 1.5;
    add(this.group, new THREE.BoxGeometry(back * 2 + 4, 26, 0.5), wallMat, { cast: false, pos: [0, 13, -back - 2] });
    add(this.group, new THREE.BoxGeometry(0.5, 26, back * 2 + 10), wallMat, { cast: false, pos: [back + 2, 13, 2] });
    add(this.group, new THREE.BoxGeometry(0.5, 26, back * 2 + 10), wallMat, { cast: false, pos: [-back - 2, 13, 2] });
    add(this.group, new THREE.BoxGeometry(back * 2 + 4, 26, 0.5), wallMat, { cast: false, pos: [0, 13, 30] });
    add(this.group, new THREE.PlaneGeometry(back * 2 + 10, 50).rotateX(Math.PI / 2), wallMat, { cast: false, pos: [0, 24, 4] });
  }

  // ── lighting rig ──
  buildLights() {
    const sc = this.scene;
    const hemi = new THREE.HemisphereLight(0x8a9cff, 0x141018, 0.35);
    sc.add(hemi);
    // key light (shadows) – overhead
    const key = new THREE.DirectionalLight(0xfff4e6, 1.5);
    key.position.set(4, 22, 6);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const q = this.quality;
    key.shadow.mapSize.set(q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096, q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096);
    const cam = key.shadow.camera;
    cam.left = -10; cam.right = 10; cam.top = 10; cam.bottom = -10; cam.near = 5; cam.far = 40;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    sc.add(key, key.target);
    // cool rim/back light: separates the wrestlers from the dark arena (no shadow cost)
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.1);
    rim.position.set(-8, 9, -12); sc.add(rim);
    const fill = new THREE.DirectionalLight(0xffd2a0, 0.35);
    fill.position.set(10, 5, 9); sc.add(fill);
    this.keyLight = key;
    // ring spots from the truss
    const spotCol = [0xffffff, 0xfff0dd, 0xffffff, 0xfff0dd];
    this.spots = [];
    [[1, 1], [-1, -1]].forEach(([sx, sz], i) => {
      const s = new THREE.SpotLight(spotCol[i], 34, 30, 0.55, 0.7, 1.5);
      s.position.set(sx * 6, 11, sz * 6);
      s.target.position.set(sx * 0.6, R.height, sz * 0.6);
      sc.add(s, s.target); this.spots.push(s);
    });
    // coloured sweeping lights for the crowd / entrance
    const cols = [0x3a5bff, 0xff2a6a];
    cols.forEach((c, i) => {
      const s = new THREE.SpotLight(c, 90, 40, 0.3, 0.7, 1.4);
      s.position.set(i ? 9 : -9, 16, 2);
      sc.add(s, s.target);
      this.movingLights.push({ light: s, phase: i * 2.1, speed: 0.35 + i * 0.1 });
    });
    // entrance light

    // visible truss + fixtures + volumetric cones
    const truss = std({ color: 0x2a2d33, metalness: 0.8, roughness: 0.4 });
    const T = 6.8, TH = 11.2;
    const tg = [];
    for (const s of [-1, 1]) { tg.push(boxAt(T * 2, 0.35, 0.35, 0, TH, s * T)); tg.push(boxAt(0.35, 0.35, T * 2, s * T, TH, 0)); }
    add(this.group, mergeGeometries(tg), truss, { cast: false });
    const canMat = std({ color: 0x111111, metalness: 0.6, roughness: 0.4 });
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false });
    const coneMat = new THREE.MeshBasicMaterial({ map: TX.coneTexture(), color: 0xfff1d6, transparent: true, opacity: 0.02, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const canGeo = new THREE.CylinderGeometry(0.22, 0.28, 0.5, 14);
    const lensGeo = new THREE.CircleGeometry(0.21, 16);
    const fixtures = [];
    for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) { fixtures.push([i * 2.4, s * T]); fixtures.push([s * T, i * 2.4]); }
    const canGeos = [], lensGeos = [];
    let fixtureIndex = 0;
    for (const [fx, fz] of fixtures) {
      const withCone = fixtureIndex++ % 2 === 0;
      const tgt = new THREE.Vector3(fx * 0.18, R.height, fz * 0.18);
      const posv = new THREE.Vector3(fx, TH - 0.45, fz);
      const dir = tgt.clone().sub(posv).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      canGeos.push(canGeo.clone().applyMatrix4(new THREE.Matrix4().compose(posv, q, new THREE.Vector3(1, 1, 1))));
      lensGeos.push(lensGeo.clone().applyMatrix4(new THREE.Matrix4().compose(posv.clone().addScaledVector(dir, 0.26), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir), new THREE.Vector3(1, 1, 1))));
      const len = posv.distanceTo(tgt);
      const coneGeo = new THREE.ConeGeometry(1.1, len, 20, 1, true); coneGeo.translate(0, -len / 2, 0);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.copy(posv);
      cone.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate()));
      cone.renderOrder = 5;
      if (withCone) { this.group.add(cone); this.cones.push(cone); }
    }
    add(this.group, mergeGeometries(canGeos), canMat, { cast: false, receive: false });
    add(this.group, mergeGeometries(lensGeos), lensMat, { cast: false, receive: false });
    this.coneMat = coneMat;
    // big ceiling glows
    const glow = new THREE.SpriteMaterial({ map: TX.glowTexture(), color: 0xfff0d8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 });
    for (const [fx, fz] of fixtures.filter((_, i) => i % 2 === 0)) {
      const sp = new THREE.Sprite(glow); sp.position.set(fx, TH - 0.6, fz); sp.scale.setScalar(1.6); this.group.add(sp);
    }
  }

  // ── Hell in a Cell ──
  buildCage() {
    const C = ARENA.cage;
    const g = new THREE.Group(); g.name = 'cage'; g.visible = false;
    const link = TX.chainLinkTexture();
    const mat = new THREE.MeshStandardMaterial({ map: link, alphaMap: null, transparent: false, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.85, roughness: 0.35, color: 0x9da3aa });
    const wallGeo = new THREE.PlaneGeometry(C.half * 2, C.height);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      if (i === 0) { // +Z wall: two side panels leaving a door gap, plus a door panel
        const dh = C.doorHalf ?? 1.0, side = C.half - dh;
        for (const sx of [-1, 1]) {
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(side, C.height), mat);
          panel.position.set(sx * (dh + side / 2), C.height / 2, C.half); panel.castShadow = true; g.add(panel);
        }
        const door = new THREE.Mesh(new THREE.PlaneGeometry(dh * 2, C.height * 0.74), mat.clone());
        door.position.set(0, C.height * 0.37, C.half); door.castShadow = true; door.name = 'cagedoor';
        g.add(door); this.cageDoorMesh = door;
        continue;
      }
      const w = new THREE.Mesh(wallGeo, mat);
      w.position.set(Math.sin(a) * C.half, C.height / 2, Math.cos(a) * C.half);
      w.rotation.y = a;
      w.castShadow = true;
      g.add(w);
    }
    const roofTex = link.clone(); roofTex.needsUpdate = true; roofTex.repeat.set(16, 16);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(C.half * 2, C.half * 2), new THREE.MeshStandardMaterial({ map: roofTex, alphaTest: 0.45, side: THREE.DoubleSide, metalness: 0.85, roughness: 0.35, color: 0x8d939a }));
    roof.rotation.x = -Math.PI / 2; roof.position.y = C.height; roof.castShadow = true; g.add(roof);
    // frame
    const frameMat = std({ color: 0x3b3f45, metalness: 0.9, roughness: 0.35 });
    const beams = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) beams.push(boxAt(0.18, C.height, 0.18, sx * C.half, C.height / 2, sz * C.half));
    for (const s of [-1, 1]) {
      beams.push(boxAt(C.half * 2, 0.16, 0.16, 0, C.height, s * C.half), boxAt(0.16, 0.16, C.half * 2, s * C.half, C.height, 0));
      beams.push(boxAt(C.half * 2, 0.12, 0.12, 0, 2.2, s * C.half), boxAt(0.12, 0.12, C.half * 2, s * C.half, 2.2, 0));
      beams.push(boxAt(C.half * 2, 0.12, 0.12, 0, 0.06, s * C.half), boxAt(0.12, 0.12, C.half * 2, s * C.half, 0.06, 0));
    }
    const fm = new THREE.Mesh(mergeGeometries(beams), frameMat); fm.castShadow = true; g.add(fm);
    this.group.add(g);
    this.cage = g;
  }

  /** Open/close the Hell-in-a-Cell door (broken = swung open and knocked loose). */
  setCageDoor(broken) {
    const d = this.cageDoorMesh; if (!d) return;
    if (broken && d.visible) { d.rotation.y = -1.2; d.position.x = -(ARENA.cage.doorHalf ?? 1.0) + 0.1; d.material.opacity = 0.9; } // swung open
    else if (!broken && d.rotation.y !== 0) { d.rotation.y = 0; d.position.x = 0; }
    d.visible = true;
  }

  setMode(rules) {
    this.cage.visible = !!rules?.cage;
    this.barricadeMeshes.forEach((m) => { m.visible = true; });
  }

  /** Per-frame animation: moving lights, cone flicker, cage shake. */
  update(dt, time, excitement = 0.3) {
    for (const m of this.movingLights) {
      const a = time * m.speed + m.phase;
      const r = 11 + Math.sin(a * 0.7) * 2;
      m.light.target.position.set(Math.cos(a) * r, 3 + Math.sin(a * 1.3) * 2, Math.sin(a) * r);
      m.light.intensity = 60 + excitement * 90;
    }
    this.coneMat.opacity = 0.012 + excitement * 0.012;
    if (this.cageShake > 0) {
      this.cageShake = Math.max(0, this.cageShake - dt * 2.5);
      this.cage.position.set((Math.random() - 0.5) * this.cageShake * 0.06, 0, (Math.random() - 0.5) * this.cageShake * 0.06);
    }
    const hue = (time * 20) % 360;
    this.walkStrip.color.setHSL(hue / 360, 0.8, 0.5);
  }
}
