// Championship belt tests: the flat belt1 strap must curl into a wearable waist loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { curlBeltGeometry } from '../client/src/render/Belt.js';
import { GAME_MODES } from '../shared/config/gameModes.js';

/** A flat strap like belt1.glb: long on X, tall on Y, almost no Z. */
function flatStrap() {
  const g = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = -0.5 + i / 40;
    for (const y of [0, 0.22]) for (const z of [-0.028, 0.028]) pts.push(x, y, z);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

test('a flat belt strap curls into a closed waist loop', () => {
  const g = flatStrap();
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.z - g.boundingBox.min.z < 0.1, 'starts flat in Z');

  curlBeltGeometry(g, { rx: 0.30, rz: 0.24, arc: Math.PI * 1.92 });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z, dy = bb.max.y - bb.min.y;
  assert.ok(dz > 0.35, `wraps round in Z (got ${dz.toFixed(2)})`);
  assert.ok(dx > 0.45 && dx < 0.75, `waist width is belt-sized (got ${dx.toFixed(2)})`);
  assert.ok(Math.abs(dy - 0.22) < 0.01, 'belt height is unchanged by the curl');
});

test('the curl keeps the plate (strap centre) at the front', () => {
  const g = flatStrap();
  curlBeltGeometry(g);
  const pos = g.attributes.position;
  // the vertex that started at x≈0 should end up at max +Z (front of the waist)
  let bestZ = -Infinity;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) < 0.02) bestZ = Math.max(bestZ, pos.getZ(i));
  assert.ok(bestZ > 0.2, `strap centre sits at the front (+Z), got ${bestZ.toFixed(2)}`);
});

test('championship mode is configured and awards a belt', () => {
  const m = GAME_MODES.championship;
  assert.ok(m, 'championship mode exists');
  assert.equal(m.championship, true);
  assert.equal(m.belt, 'belt1');
  assert.ok(m.minFighters >= 2 && m.winBy.includes('pin'));
});
