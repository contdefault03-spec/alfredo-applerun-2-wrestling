// Progressive, force-driven ring collapse (authoritative sim).
// The legacy +1 accumulation path is covered in ring.test.js; here we exercise
// the force path: structural weakness at the edges/corners and the shockwave
// that pre-weakens neighbouring sections so the ring caves in progressively.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/World.js';
import { RING_BREAK_HITS } from '../shared/sim/constants.js';
import { cellCenter } from '../shared/sim/RingDestruction.js';

function live(chars = ['ajan', 'lucky']) {
  const w = new World({ mode: 'normal', fighters: chars.map((c, i) => ({ charId: c, team: i })) });
  while (w.match.phase !== 'live') w.step();
  w.takeEvents();
  return w;
}

test('edges and corners are structurally weaker than the centre', () => {
  const w = live();
  // grid is 3×3: cell 4 is the centre, 1 an edge, 0/8 corners
  assert.ok(w.ring.weakness(4) === 1, 'centre is the baseline');
  assert.ok(w.ring.weakness(1) > w.ring.weakness(4), 'edge weaker than centre');
  assert.ok(w.ring.weakness(0) > w.ring.weakness(1), 'corner weaker than edge');
  assert.equal(w.ring.weakness(8), w.ring.weakness(0), 'all corners equal');
});

test('the same slam force cracks a corner while the centre holds', () => {
  const w = live();
  const corner = cellCenter(8), centre = cellCenter(4);
  w.ring.registerImpact(corner.x, corner.z, 1.4); // 1.4 × 1.5 = 2.1 → cracked
  w.ring.registerImpact(centre.x, centre.z, 1.4); // 1.4 × 1.0 = 1.4 → intact
  assert.equal(w.ring.level(8), 1, 'the corner cracks');
  assert.equal(w.ring.level(4), 0, 'the centre holds under the same force');
});

test('force scales damage: one heavy slam does what many light taps would', () => {
  const w = live();
  const c = cellCenter(4);
  w.ring.registerImpact(c.x, c.z, 3.5); // overwhelming force at the centre
  assert.equal(w.ring.level(4), 2, 'a big enough slam breaks a fresh section outright');
});

test('a heavy impact sends a shockwave that pre-weakens neighbours, caving the ring in progressively', () => {
  const w = live();
  const centre = cellCenter(4);
  w.ring.registerImpact(centre.x, centre.z, 2.0); // centre cracks; neighbours take 40% shockwave
  assert.equal(w.ring.level(4), 1, 'the struck section cracks');
  assert.ok(w.ring.hits[1] > 0 && w.ring.level(1) < 2, 'an unstruck neighbour is softened but not broken');
  // the softened neighbour now collapses from a single direct slam it would otherwise survive
  const nb = cellCenter(1);
  w.ring.registerImpact(nb.x, nb.z, 2.0);
  assert.equal(w.ring.level(1), 2, 'the pre-weakened neighbour caves in on the next slam');
});

test('shockwaves never break a neighbour outright, only soften it', () => {
  const w = live();
  const c = cellCenter(4);
  for (let i = 0; i < 6; i++) w.ring.registerImpact(c.x, c.z, 5); // hammer the centre repeatedly
  // every neighbour the shockwave reached stays at most cracked until struck directly
  for (const nk of w.ring.neighbors(4)) {
    assert.ok(w.ring.hits[nk] < RING_BREAK_HITS, `neighbour ${nk} not broken by shockwave alone`);
  }
});
