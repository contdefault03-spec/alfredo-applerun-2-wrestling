// ArenaBuilder – builds the whole venue: ring (deformable ropes, posts,
// turnbuckle pads, apron), steel steps, mats, barricades, commentary desk,
// entrance stage + titantron, stands, light rig with volumetric cones,
// LED ribbon boards and the Hell-in-a-Cell structure.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA } from '@shared/config/arena.js';
import { RING_GRID } from '@shared/sim/constants.js';
import { CELL, cellCenter, levelFromHits } from '@shared/sim/RingDestruction.js';
import * as TX from './Textures.js';

const R = ARENA.ring;

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
    const plat = new THREE.BoxGeometry(A * 2, H, A * 2);
    add(g, plat, [skirt, skirt, canvasMat, skirt, skirt, skirt], { pos: [0, H / 2, 0] });
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
    this.buildCars();
  }

  // ── a couple of cars parked by the entrance (just for show) ──
  buildCars() {
    const car = (x, z, rotY, color) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY;
      const bodyMat = std({ color, roughness: 0.35, metalness: 0.6 });
      const glassMat = std({ color: 0x101418, roughness: 0.15, metalness: 0.4 });
      const tyreMat = std({ color: 0x111113, roughness: 0.9 });
      add(g, new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat, { pos: [0, 0.62, 0] });            // body
      add(g, new THREE.BoxGeometry(1.8, 0.66, 2.1), bodyMat, { pos: [0, 1.12, -0.1] });          // cabin
      add(g, new THREE.BoxGeometry(1.74, 0.5, 2.0), glassMat, { pos: [0, 1.16, -0.1] });          // windows
      for (const [wx, wz] of [[0.95, 1.4], [-0.95, 1.4], [0.95, -1.4], [-0.95, -1.4]]) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16), tyreMat);
        w.rotation.z = Math.PI / 2; w.position.set(wx, 0.42, wz); g.add(w);
      }
      this.group.add(g);
      return g;
    };
    this.cars = [car(-7.5, 13.6, 0.25, 0x8a1016), car(7.8, 14.2, -0.3, 0x14305a)];
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
      m.visible = true;
      m.material = lvl === 2 ? this._ringDmgMats.hole : this._ringDmgMats.crack;
      // draw on top of the canvas so it reads from above (a hole is a black void)
      m.position.y = R.height + (lvl === 2 ? 0.04 : 0.02);
      m.renderOrder = 3;
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
