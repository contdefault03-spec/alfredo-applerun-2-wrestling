// Procedural meshes for ringside props (PBR materials, merged geometry).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.85, roughness: 0.35 }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.45 }),
  bamboo: new THREE.MeshStandardMaterial({ color: 0xc9a660, metalness: 0, roughness: 0.55 }),
  tape: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5534, roughness: 0.7 }),
  tableTop: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.65 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a93a, metalness: 1, roughness: 0.25 }),
  cone: new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
  can: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.9, roughness: 0.4 }),
};

function box(w, h, d, x = 0, y = 0, z = 0, rx = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; }
function cyl(r0, r1, h, x = 0, y = 0, z = 0, seg = 12, rz = 0, rx = 0) { const g = new THREE.CylinderGeometry(r0, r1, h, seg); if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; }
function mesh(geos, mat) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; m.receiveShadow = true; return m; }

const BUILDERS = {
  chair() {
    const g = new THREE.Group();
    g.add(mesh([box(0.44, 0.03, 0.42, 0, 0.46, 0), box(0.44, 0.34, 0.03, 0, 0.78, -0.2, 0.12)], M.steel));
    const legs = [];
    for (const sx of [-0.2, 0.2]) {
      legs.push(cyl(0.013, 0.013, 0.95, sx, 0.47, -0.08, 8, 0, 0.25));
      legs.push(cyl(0.013, 0.013, 0.5, sx, 0.24, 0.12, 8, 0, -0.35));
    }
    legs.push(cyl(0.01, 0.01, 0.4, 0, 0.1, 0.18, 6, Math.PI / 2));
    g.add(mesh(legs, M.darkSteel));
    return g;
  },
  kendo_stick() {
    const g = new THREE.Group();
    g.add(mesh([cyl(0.022, 0.018, 1.1, 0, 0.55, 0, 10)], M.bamboo));
    g.add(mesh([cyl(0.025, 0.025, 0.25, 0, 0.12, 0, 10), cyl(0.024, 0.024, 0.02, 0, 0.5, 0, 10), cyl(0.023, 0.023, 0.02, 0, 0.85, 0, 10)], M.tape));
    return g;
  },
  trash_can() {
    const g = new THREE.Group();
    const ribs = [cyl(0.25, 0.22, 0.62, 0, 0.31, 0, 20)];
    for (let i = 0; i < 4; i++) ribs.push(cyl(0.255 - i * 0.008, 0.255 - i * 0.008, 0.02, 0, 0.12 + i * 0.14, 0, 20));
    g.add(mesh(ribs, M.can));
    g.add(mesh([cyl(0.27, 0.27, 0.03, 0, 0.64, 0, 20), box(0.12, 0.03, 0.03, 0, 0.67, 0)], M.darkSteel));
    return g;
  },
  table() {
    const g = new THREE.Group();
    g.add(mesh([box(1.8, 0.04, 0.76, 0, 0.74, 0)], M.tableTop));
    const legs = [];
    for (const sx of [-0.75, 0.75]) for (const sz of [-0.3, 0.3]) legs.push(cyl(0.015, 0.015, 0.72, sx, 0.36, sz, 8));
    legs.push(cyl(0.012, 0.012, 0.6, -0.75, 0.3, 0, 6, 0, Math.PI / 2), cyl(0.012, 0.012, 0.6, 0.75, 0.3, 0, 6, 0, Math.PI / 2));
    g.add(mesh(legs, M.darkSteel));
    return g;
  },
  ring_bell() {
    const g = new THREE.Group();
    g.add(mesh([box(0.3, 0.05, 0.2, 0, 0.025, 0)], M.wood));
    const dome = new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(0, 0.08, 0);
    g.add(mesh([dome, cyl(0.02, 0.02, 0.04, 0, 0.21, 0)], M.brass));
    return g;
  },
  cone() {
    const g = new THREE.Group();
    g.add(mesh([cyl(0.03, 0.16, 0.55, 0, 0.3, 0, 16), box(0.36, 0.03, 0.36, 0, 0.015, 0)], M.cone));
    g.add(mesh([cyl(0.075, 0.1, 0.1, 0, 0.32, 0, 16)], M.white));
    return g;
  },
};

/** Build a prop mesh; falls back to a crate for unknown ids. */
export function buildItemMesh(type) {
  const b = BUILDERS[type];
  if (b) return b();
  const g = new THREE.Group(); g.add(mesh([box(0.4, 0.4, 0.4, 0, 0.2, 0)], M.wood)); return g;
}

/** How a held item sits in the hand bone (local offsets, in metres). */
export const HOLD_OFFSETS = {
  chair: { pos: [0, -0.05, 0.15], rot: [Math.PI / 2, 0, 0], twoHanded: true },
  kendo_stick: { pos: [0, -0.02, 0.05], rot: [Math.PI / 2, 0, 0] },
  trash_can: { pos: [0.1, -0.1, 0.2], rot: [0, 0, 0], twoHanded: true },
  table: { pos: [0.3, -0.2, 0.2], rot: [0, 0, Math.PI / 2], twoHanded: true },
  ring_bell: { pos: [0, -0.1, 0.05], rot: [0, 0, 0] },
  cone: { pos: [0, -0.1, 0.05], rot: [Math.PI, 0, 0] },
};

/** Broken table pieces. */
export function buildTableDebris() {
  const g = new THREE.Group();
  const pieces = [];
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.5, 0.04, 0.2 + Math.random() * 0.4), M.tableTop);
    p.position.set((Math.random() - 0.5) * 1.6, 0.03 + Math.random() * 0.05, (Math.random() - 0.5) * 0.8);
    p.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 3, (Math.random() - 0.5) * 0.4);
    p.castShadow = true; pieces.push(p); g.add(p);
  }
  return g;
}
