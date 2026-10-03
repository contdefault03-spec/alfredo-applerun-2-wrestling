// Belt.js – championship belts.
//   belt.glb  is modelled ALREADY curled (bbox 1.0 x 0.27 x 0.81) – use as-is.
//   belt1.glb is a FLAT strap   (bbox 1.0 x 0.22 x 0.06) – we curl it around the
//   waist ourselves so it reads as a real belt worn on the body.
import * as THREE from 'three';

/**
 * Bend a flat belt strap (long on X, thin on Z) into a waist oval around +Y.
 * x maps to the angle around the waist, the strap's own z becomes radial thickness,
 * y stays the belt height. The plate (strap centre) ends up at the FRONT (+Z).
 */
export function curlBeltGeometry(geo, { rx = 0.30, rz = 0.24, arc = Math.PI * 1.92 } = {}) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const len = (bb.max.x - bb.min.x) || 1;
  const cx = (bb.max.x + bb.min.x) / 2;
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.x - cx) / len;                 // -0.5 .. 0.5 along the strap
    const th = t * arc;                         // wrap angle (just under a full turn)
    const k = 1 + v.z / Math.max(rx, 1e-6);     // strap thickness pushes outward
    pos.setXYZ(i, Math.sin(th) * rx * k, v.y, Math.cos(th) * rz * k);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  return geo;
}

/** First mesh in a loaded GLB scene, with node transforms baked in. */
function firstMesh(src) {
  let found = null;
  src.updateMatrixWorld(true);
  src.traverse((o) => { if (o.isMesh && !found) found = o; });
  return found;
}

/**
 * Build a belt mesh in world (metre) scale.
 * @param {THREE.Object3D} src loaded GLB scene
 * @param {boolean} curl  true for the flat belt1 strap
 * @param {number} waistD target waist diameter in metres
 */
export function makeBeltMesh(src, { curl = false, waistD = 0.58 } = {}) {
  const m = firstMesh(src);
  if (!m) return null;
  const geo = m.geometry.clone();
  geo.applyMatrix4(m.matrixWorld);
  if (curl) curlBeltGeometry(geo);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  // centre it on the waist axis and sit the strap around y=0
  const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2, cy = (bb.max.y + bb.min.y) / 2;
  geo.translate(-cx, -cy, -cz);
  geo.computeBoundingBox();
  const b2 = geo.boundingBox;
  const dia = Math.max(b2.max.x - b2.min.x, b2.max.z - b2.min.z) || 1;
  const s = waistD / dia;
  const mat = m.material?.clone?.() || new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(s);
  mesh.castShadow = true; mesh.frustumCulled = false;
  return mesh;
}
