// Clips – procedural animation library. Every clip is described as pose
// overrides (see PoseSolver for units) on top of a base stance, keyed in time.
// Attack keys may use symbolic times: 'S' end of startup, 'M' middle of the
// active window, 'A' end of active, 'R' mid-recovery.
import { P, newPose, set } from './PoseSolver.js';

// ── base poses ──
export const GUARD = {
  hipsOff: [0, -0.07, 0], hipsRot: [0.05, 0, 0], spine: [0.1, 0, 0], chest: [0.04, 0, 0], neck: [-0.05, 0, 0], head: [-0.06, 0, 0],
  handL: [-0.08, 0.02, 0.48], handR: [-0.12, -0.02, 0.4], spaceL: 1, spaceR: 1,
  elbowL: [0.5, -1, -0.1], elbowR: [0.5, -1, -0.1],
  footL: [0.06, 0, 0.14], footR: [0.1, 0, -0.16], kneeL: [0.2, 0, 1], kneeR: [0.2, 0, 1],
};
export const RELAXED = {
  hipsOff: [0, -0.01, 0], spine: [0.02, 0, 0], chest: [0, 0, 0],
  handL: [0.18, -0.9, 0.08], handR: [0.18, -0.9, 0.08], spaceL: 1, spaceR: 1,
  elbowL: [0.3, 0, -1], elbowR: [0.3, 0, -1],
  footL: [0.07, 0, 0.02], footR: [0.07, 0, -0.02], kneeL: [0.1, 0, 1], kneeR: [0.1, 0, 1],
};
export const LYING = {
  hipsOff: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  handL: [0.75, -0.25, -0.05], handR: [0.8, -0.2, 0.05], spaceL: 1, spaceR: 1, elbowL: [0, 0, -1], elbowR: [0, 0, -1],
  footL: [0.14, 0.02, 0.05], footR: [0.1, 0.05, -0.05], kneeL: [0.3, 0, 1], kneeR: [0.2, 0, 1],
};

const MIRROR_TORSO = ['hipsRot', 'spine', 'chest', 'neck', 'head'];
/** Mirror an override object left<->right. */
export function mirror(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    let key = k;
    if (k.endsWith('L')) key = k.slice(0, -1) + 'R'; else if (k.endsWith('R')) key = k.slice(0, -1) + 'L';
    let val = v;
    if (MIRROR_TORSO.includes(k)) val = [v[0], -v[1], -v[2]];
    else if (k === 'hipsOff') val = [-v[0], v[1], v[2]];
    else if (k === 'bodyYaw') val = -v;
    else if (k === 'tilt') val = [v[0], -v[1]];
    r[key] = val;
  }
  return r;
}

// strike helper: windup W, extension X, optional follow-through F.
// The striking hand's extension is in ROOT space so the fist drives straight
// at the target even while the torso twists (chest space would swing it sideways).
const rootHands = (o) => ({ ...o, ...(o.handR ? { spaceR: 0 } : {}), ...(o.handL ? { spaceL: 0 } : {}) });
const strike = (W, X, F = null) => [[0, {}], ['S', W], ['M', rootHands(X)], ['A', rootHands(X)], ...(F ? [['R', rootHands(F)]] : []), [1, {}]];

export const ATTACK_CLIPS = {
  jab_r: strike({ handR: [-0.05, 0.05, 0.22], chest: [0.06, -0.2, 0] },
    { handR: [-0.3, 0.08, 1.3], chest: [0.08, 0.42, 0], spine: [0.12, 0.1, 0], footR: [0.1, 0, -0.26], elbowR: [0.6, -0.4, 0] }),
  hook_l: strike({ handL: [0.35, 0.05, 0.25], chest: [0.05, 0.3, 0] },
    { handL: [-0.45, 0.1, 1.15], elbowL: [0.3, 0.8, -0.3], chest: [0.08, -0.6, 0], spine: [0.1, -0.2, 0] }),
  uppercut_r: strike({ handR: [0.0, -0.45, 0.3], hipsOff: [0, -0.17, 0], chest: [0.28, 0.15, 0] },
    { handR: [-0.2, 0.5, 0.85], chest: [-0.15, 0.38, 0], spine: [-0.05, 0.1, 0], hipsOff: [0, 0.0, 0], head: [-0.2, 0, 0] }),
  kick_front: strike({ footR: [0.05, 0.38, 0.08], kneeR: [0, 0.4, 1], hipsRot: [0.12, 0, 0] },
    { footR: [0.05, 0.6, 0.92], hipsRot: [-0.22, 0, 0], spine: [-0.06, 0, 0], handL: [0.3, -0.1, 0.35], handR: [0.4, -0.2, 0.1] }),
  roundhouse: strike({ footR: [0.28, 0.35, -0.12], hipsRot: [0, 0.5, 0], chest: [0, -0.3, 0] },
    { footR: [-0.4, 0.9, 0.55], kneeR: [0, 1, 0.3], hipsRot: [-0.12, -1.0, -0.35], chest: [0.1, 0.65, 0.2], spine: [-0.12, 0.1, 0.1], handL: [0.6, 0.1, 0], handR: [0.5, -0.1, -0.2] }),
  haymaker: strike({ handR: [0.55, 0.25, -0.35], chest: [0.0, -0.65, 0], hipsRot: [0, -0.2, 0] },
    { handR: [-0.35, 0.05, 1.35], chest: [0.16, 0.75, 0], spine: [0.16, 0.22, 0], footR: [0.1, 0, -0.32] }),
  hook_r: null, jab_l: null,
  clothesline: [[0, {}], ['S', { handR: [1.0, 0.12, 0.05], spaceR: 1 }], ['A', { handR: [1.0, 0.15, 0.3], chest: [0, 0.35, 0] }], [1, { handR: [0.9, 0.1, 0.3] }]],
  charge: [[0, {}], ['S', { chest: [0.5, 0, 0], spine: [0.35, 0, 0], head: [-0.35, 0, 0], handL: [0.25, -0.3, 0.55], handR: [0.25, -0.3, 0.55], hipsOff: [0, -0.1, 0] }],
    ['A', { chest: [0.55, 0, 0], spine: [0.4, 0, 0], head: [-0.4, 0, 0], handL: [0.3, -0.2, 0.6], handR: [0.3, -0.2, 0.6], hipsOff: [0, -0.12, 0] }], [1, {}]],
  dropkick: [[0, {}], ['S', { hipsOff: [0, -0.12, 0], handL: [0.5, 0.3, -0.2], handR: [0.5, 0.3, -0.2] }],
    ['M', { tilt: [-1.25, 0], lift: 0.32, footL: [0.06, 0.75, 0.8], footR: [0.1, 0.72, 0.85], kneeL: [0, 1, 0.2], kneeR: [0, 1, 0.2], handL: [0.85, 0.2, -0.3], handR: [0.85, 0.2, -0.3] }],
    ['R', { tilt: [-1.52, 0], drop: 0.95, footL: [0.08, 0.3, 0.3], footR: [0.12, 0.3, 0.3], handL: [0.7, -0.2, 0], handR: [0.7, -0.2, 0] }],
    [1, { tilt: [-0.3, 0], hipsOff: [0, -0.3, 0] }]],
  jump_knee: [[0, {}], ['S', { footR: [0.05, 0.6, 0.35], kneeR: [0, 0, 1], handL: [0.1, 0.55, 0.35], handR: [0.1, 0.55, 0.35] }],
    ['A', { footR: [0.05, 0.62, 0.4], handL: [0.3, 0.6, 0.2], handR: [0.3, 0.6, 0.2] }], [1, {}]],
  stomp: strike({ footR: [0.05, 0.45, 0.32] }, { footR: [0.05, 0.02, 0.45], hipsOff: [0, -0.06, 0.05], spine: [0.25, 0, 0], head: [0.3, 0, 0] }),
  elbow_drop: [[0, {}], ['S', { lift: 0.18, handR: [0.3, 0.55, 0.0], footL: [0.05, 0.2, 0], footR: [0.1, 0.25, 0] }],
    ['M', { tilt: [1.38, 0], drop: 0.88, handR: [-0.1, -0.2, 0.5], handL: [0.5, -0.2, 0.2] }], ['R', { tilt: [1.2, 0], drop: 0.8, handR: [0, -0.5, 0.4] }],
    [1, { hipsOff: [0, -0.3, 0], tilt: [0.3, 0] }]],
  item_swing: strike({ handR: [0.45, 0.65, -0.3], chest: [-0.1, -0.55, 0], elbowR: [1, 0.5, 0] },
    { handR: [-0.35, 0.05, 1.2], chest: [0.22, 0.65, 0], spine: [0.1, 0.2, 0] }),
  item_overhead: strike({ handR: [-0.3, 1.05, 0.12], chest: [-0.28, 0, 0], spine: [-0.12, 0, 0], grip: 1, elbowR: [0.5, 0.3, -0.5] },
    { handR: [-0.3, -0.25, 0.85], chest: [0.5, 0, 0], spine: [0.22, 0, 0], hipsOff: [0, -0.14, 0], grip: 1 }),
  item_throw: strike({ handR: [0.3, 0.85, -0.45], chest: [-0.12, -0.45, 0] }, { handR: [-0.2, 0.35, 0.95], chest: [0.16, 0.45, 0] }),
  double_smash: strike({ handL: [0.45, 0.4, -0.25], handR: [0.45, 0.4, -0.25], chest: [-0.18, 0, 0] },
    { handL: [-0.28, 0.08, 1.2], handR: [-0.28, 0.08, 1.2], chest: [0.28, 0, 0], spine: [0.1, 0, 0] }),
  overhead_smash: strike({ handL: [-0.15, 1.05, 0.05], handR: [-0.15, 1.05, 0.05], chest: [-0.28, 0, 0], elbowL: [0.4, 0.4, -0.6], elbowR: [0.4, 0.4, -0.6] },
    { handL: [-0.22, -0.32, 0.82], handR: [-0.22, -0.32, 0.82], chest: [0.55, 0, 0], spine: [0.22, 0, 0], hipsOff: [0, -0.16, 0] }),
  food_slap: strike({ handL: [0.9, 0.25, -0.3], chest: [0, 0.5, 0], elbowL: [0.6, 0.3, -0.6] },
    { handL: [-0.38, 0.02, 1.15], chest: [0.1, -0.65, 0], spine: [0.06, -0.22, 0] }),
  food_smash: strike({ handL: [0.0, 1.05, 0.0], chest: [-0.22, 0.2, 0], handR: [0.5, 0.2, 0.2] },
    { handL: [-0.18, -0.38, 0.8], chest: [0.48, -0.2, 0], hipsOff: [0, -0.16, 0], spine: [0.2, 0, 0] }),
  headbutt: [[0, { handL: [-0.3, 0.15, 0.55], handR: [-0.3, 0.1, 0.55] }], ['S', { handL: [-0.3, 0.15, 0.55], handR: [-0.3, 0.1, 0.55], chest: [-0.2, 0, 0], head: [-0.3, 0, 0] }],
    ['M', { handL: [-0.3, 0.15, 0.55], handR: [-0.3, 0.1, 0.55], chest: [0.4, 0, 0], neck: [0.3, 0, 0], head: [0.35, 0, 0] }], [1, { handL: [-0.3, 0.15, 0.55], handR: [-0.3, 0.1, 0.55] }]],
  takedown: [[0, {}], [0.4, { hipsOff: [0, -0.38, 0.12], spine: [0.55, 0, 0], handL: [0, -0.65, 0.8], handR: [0, -0.65, 0.8], footR: [0.25, 0.1, 0.4] }], [1, { hipsOff: [0, -0.2, 0] }]],
  item_throw_anim: null,
};
ATTACK_CLIPS.hook_r = ATTACK_CLIPS.hook_l.map(([t, o]) => [t, mirror(o)]);
ATTACK_CLIPS.jab_l = ATTACK_CLIPS.jab_r.map(([t, o]) => [t, mirror(o)]);
ATTACK_CLIPS.item_throw_anim = ATTACK_CLIPS.item_throw;

const HOLD_HANDS = { handL: [-0.1, 0.16, 0.62], handR: [-0.1, 0.1, 0.62], chest: [0.14, 0, 0], elbowL: [0.9, -0.2, -0.3], elbowR: [0.9, -0.2, -0.3] };
export const HOLD = HOLD_HANDS;
export const HELD = { handL: [-0.05, 0.05, 0.5], handR: [-0.05, 0.0, 0.5], chest: [0.2, 0, 0], head: [0.1, 0, 0], hipsOff: [0, -0.05, 0] };

// grapple moves (grabber), keyed in seconds of the move
export const GRAPPLE_CLIPS = {
  body_slam: [[0, HOLD_HANDS], [0.3, { ...HOLD_HANDS, hipsOff: [0, -0.18, 0], handL: [-0.1, -0.1, 0.5], handR: [-0.1, -0.15, 0.5] }],
    [0.65, { handL: [-0.1, 1.05, 0.25], handR: [-0.1, 1.0, 0.25], chest: [-0.15, 0, 0], hipsOff: [0, 0, 0] }],
    [0.95, { handL: [-0.1, -0.1, 0.9], handR: [-0.1, -0.1, 0.9], chest: [0.45, 0, 0], spine: [0.15, 0, 0], hipsOff: [0, -0.12, 0] }], [1.25, {}]],
  suplex: [[0, HOLD_HANDS], [0.4, { handL: [-0.25, 0.35, 0.35], handR: [-0.25, 0.3, 0.35], chest: [-0.3, 0, 0], hipsOff: [0, -0.1, 0] }],
    [0.75, { tilt: [-0.95, 0], handL: [-0.1, 0.9, 0.1], handR: [-0.1, 0.9, 0.1], chest: [-0.4, 0, 0] }],
    [1.0, { tilt: [-1.35, 0], drop: 0.6, handL: [0.1, 0.8, 0], handR: [0.1, 0.8, 0] }], [1.35, { tilt: [-0.5, 0], hipsOff: [0, -0.25, 0] }]],
  powerbomb: [[0, HOLD_HANDS], [0.45, { handL: [-0.15, 0.45, 0.4], handR: [-0.15, 0.4, 0.4], hipsOff: [0, -0.2, 0], chest: [0.3, 0, 0] }],
    [1.0, { handL: [-0.12, 1.05, 0.3], handR: [-0.12, 1.0, 0.3], chest: [-0.12, 0, 0] }],
    [1.3, { handL: [-0.12, -0.45, 0.85], handR: [-0.12, -0.45, 0.85], hipsOff: [0, -0.55, -0.05], chest: [0.3, 0, 0], footL: [0.1, 0.1, 0.5], footR: [0.12, 0.1, 0.5] }], [1.6, {}]],
};
export const THROW_CLIPS = {
  throw: [[0, HOLD_HANDS], [0.25, { handR: [0.35, 0.1, 0.9], handL: [0.3, 0.0, 0.3], chest: [0.1, 0.55, 0] }], [0.55, {}]],
  heave: [[0, HOLD_HANDS], [0.3, { handL: [-0.2, -0.35, 0.6], handR: [-0.2, -0.35, 0.6], hipsOff: [0, -0.2, 0], chest: [0.35, 0, 0] }],
    [0.45, { handL: [-0.2, 0.75, 0.9], handR: [-0.2, 0.75, 0.9], chest: [-0.25, 0, 0] }], [0.8, {}]],
};

// ── sampling ──
const TMP = newPose();
const SYMS = ['S', 'M', 'A', 'R'];

/** Build a full pose: base overrides + clip override object. */
export function applyOverrides(out, base, o) {
  out.fill(0);
  for (const [k, v] of Object.entries(base)) set(out, k, v);
  if (o) for (const [k, v] of Object.entries(o)) set(out, k, v);
  return out;
}

function smooth(u) { return u * u * (3 - 2 * u); }

/**
 * Sample a keyed clip at normalized time u (0..1) or seconds (if `secs`).
 * anchors: {S,M,A,R} normalized times for symbolic keys.
 */
export function sampleClip(out, clip, base, u, anchors) {
  const keys = clip.map(([t, o]) => [typeof t === 'string' ? anchors[t] : t, o]);
  let i = 1;
  while (i < keys.length - 1 && u > keys[i][0]) i++;
  const [t0, o0] = keys[i - 1], [t1, o1] = keys[i];
  const k = t1 > t0 ? smooth(Math.min(1, Math.max(0, (u - t0) / (t1 - t0)))) : 1;
  applyOverrides(out, base, o0);
  applyOverrides(TMP, base, o1);
  for (let j = 0; j < P.SIZE; j++) out[j] += (TMP[j] - out[j]) * k;
  return out;
}

export { SYMS };
