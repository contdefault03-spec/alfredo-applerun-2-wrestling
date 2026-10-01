// ─────────────────────────────────────────────────────────────────────────────
// CHARACTER CONFIGURATION
// Every gameplay number for a wrestler lives here. To add a character:
//   1. drop the GLB into assets/source/ and add it to tools/process-assets.mjs
//   2. copy one of the entries below, change id/name/model/stats
//   3. (optional) tune `rig` landmarks – they are in the model's normalized
//      space (the GLB's own units, model facing +Z, +X = model's LEFT side).
//      If `rig` is omitted, AutoRig estimates the joints from the mesh.
// Units: metres, seconds, m/s. Health is in hit points.
// ─────────────────────────────────────────────────────────────────────────────

/** Default values – every character inherits these, then overrides. */
export const BASE_STATS = {
  maxHealth: 1000,
  height: 1.82,            // standing height in metres (model is scaled to this)
  radius: 0.34,            // body collision radius (m)
  weight: 100,             // kg-ish – affects knockback taken & dealt, grab difficulty
  walkSpeed: 2.6,
  runSpeed: 5.6,
  acceleration: 22,
  turnSpeed: 12,           // rad/s
  jumpStrength: 5.2,       // initial vertical velocity
  attackPower: 1.0,        // damage multiplier on every attack
  attackSpeed: 1.0,        // >1 = faster startup/recovery
  defense: 0.0,            // 0..0.6 – fraction of damage ignored
  grabStrength: 1.0,       // grapple power: escaping, reversals, throw distance
  knockbackResistance: 0.0,// 0..0.9 – reduces knockback + downgrades light reactions
  dodgeSpeed: 8.5,
  dodgeDuration: 0.34,
  dodgeCooldown: 0.55,
  recoverySpeed: 1.0,      // >1 = gets up / recovers from stun faster
  downTimeMul: 1.0,        // how long opponents stay down after this wrestler's knockdowns
  maxStamina: 100,
  staminaRegen: 18,        // per second
  special: null,           // ability id from shared/config/abilities.js
  specialCooldown: 14,     // seconds
  specialCost: 50,         // special meter cost (meter fills 0..100 in a match)
  moveset: {},             // overrides: slot -> attack id (see attacks.js)
  hands: null,             // held-object info (Max's weights, Ajan's food)
  voicePitch: 1.0,         // character grunts
  color: '#ffffff',        // UI accent colour
};

export const CHARACTERS = {
  max: {
    id: 'max', name: 'MAX', model: 'assets/characters/max.glb',
    tagline: 'The Iron Fist',
    description: 'Carries a pair of iron weights that turn every strike into a weapon shot. Armed punches hit hard and ring off the steel.',
    height: 1.84, radius: 0.34, weight: 108,
    walkSpeed: 2.5, runSpeed: 5.4,
    attackPower: 1.12, attackSpeed: 0.95, defense: 0.05,
    special: 'iron_barrage', specialCooldown: 13,
    hands: { left: 'weight', right: 'weight', armedStrikes: true, strikeBonus: 1.25, sound: 'metal' },
    moveset: { punch: 'max_weight_jab', punch2: 'max_weight_hook', punch3: 'max_double_smash', heavy: 'max_overhead_smash' },
    voicePitch: 0.95, color: '#e0a040',
    rig: {
      shoulder: [0.105, 0.80, -0.01], elbow: [0.24, 0.79, -0.02], wrist: [0.36, 0.775, -0.01], handTip: [0.44, 0.765, 0],
      neck: 0.83, headTop: 1.0, hip: [0.055, 0.50], knee: [0.055, 0.27], ankle: [0.062, 0.065], pelvis: 0.52,
    },
  },

  masked: {
    id: 'masked', name: 'MASKED', model: 'assets/characters/masked.glb',
    tagline: 'The Faceless Technician',
    description: 'A balanced, textbook wrestler. No gimmicks — clean strikes, reliable grapples and a devastating driver.',
    height: 1.88, radius: 0.32, weight: 96,
    special: 'masked_driver',
    voicePitch: 1.0, color: '#7fb0ff',
    rig: {
      shoulder: [0.10, 0.78, 0], elbow: [0.2175, 0.605, -0.01], wrist: [0.2775, 0.49, 0], handTip: [0.34, 0.40, 0.01],
      neck: 0.82, headTop: 1.0, hip: [0.036, 0.43], knee: [0.036, 0.215], ankle: [0.04, 0.065], pelvis: 0.45,
    },
  },

  ajan: {
    id: 'ajan', name: 'AJAN', model: 'assets/characters/ajan.glb',
    tagline: 'The Silverback',
    description: 'A colossal gorilla who fights with the food in his left hand. Slow, massive and nearly impossible to knock down.',
    height: 2.2, radius: 0.62, weight: 260,
    maxHealth: 1350,
    walkSpeed: 1.9, runSpeed: 4.1, acceleration: 12, turnSpeed: 7,
    jumpStrength: 5.6,
    attackPower: 1.2, attackSpeed: 0.8, defense: 0.12,
    grabStrength: 1.8, knockbackResistance: 0.5,
    downTimeMul: 0.6,      // opponents he knocks down get back up faster
    dodgeSpeed: 5.5, dodgeCooldown: 1.1, recoverySpeed: 0.85,
    maxStamina: 130, staminaRegen: 16,
    special: 'ajan_crush', specialCooldown: 22, specialCost: 60,
    hands: { left: 'food', foodStrikes: true, sound: 'food' },
    moveset: { punch: 'ajan_food_slap', punch2: 'ajan_backhand', punch3: 'ajan_food_smash', kick: 'ajan_stomp_kick', heavy: 'ajan_double_axe', running: 'ajan_charge' },
    voicePitch: 0.5, color: '#9a6a3a',
    // animation stance overrides (body-relative units, see client/src/anim/PoseSolver.js)
    poses: { guard: { handL: [0.3, -0.5, 0.5], elbowL: [0.6, -1, -0.2], handR: [-0.05, -0.05, 0.5] } },
    rig: {
      // Ajan is asymmetric: the food bowl sits in his left hand (+X).
      left: { shoulder: [0.17, 0.605, 0.02], elbow: [0.29, 0.56, 0.03], wrist: [0.37, 0.545, 0.03], handTip: [0.43, 0.535, 0.04] },
      right: { shoulder: [-0.17, 0.605, 0.02], elbow: [-0.31, 0.555, 0.03], wrist: [-0.42, 0.54, 0.03], handTip: [-0.495, 0.53, 0.04] },
      neck: 0.62, headTop: 0.762, hip: [0.09, 0.28], knee: [0.125, 0.14], ankle: [0.135, 0.05], pelvis: 0.30,
      handRadius: 2.2, // food bowl is big – let the hand bone own more of it
      prop: { side: 'L', center: [0.385, 0.575], radius: 0.11 }, // the food bowl – eaten in his victory celebration
    },
  },

  rise: {
    id: 'rise', name: 'RISE', model: 'assets/characters/rise.glb',
    tagline: 'The Ascending Star',
    description: 'A well-rounded athlete. Solid strikes, solid grapples, and a launching uppercut that sends rivals skyward.',
    height: 1.83, radius: 0.33, weight: 98,
    attackSpeed: 1.05,
    special: 'rising_uppercut',
    voicePitch: 1.05, color: '#ff7a4a',
    rig: {
      shoulder: [0.12, 0.79, -0.01], elbow: [0.255, 0.775, -0.02], wrist: [0.3975, 0.77, -0.01], handTip: [0.477, 0.777, 0],
      neck: 0.83, headTop: 1.0, hip: [0.052, 0.49], knee: [0.055, 0.26], ankle: [0.07, 0.065], pelvis: 0.53,
    },
  },

  cave: {
    id: 'cave', name: 'CAVE', model: 'assets/characters/cave.glb',
    tagline: 'The Long Coat',
    description: 'A standard brawler with a heavy coat and a spear tackle that folds opponents in half.',
    height: 1.8, radius: 0.34, weight: 102,
    defense: 0.05,
    special: 'cave_in',
    voicePitch: 0.9, color: '#8a8aa0',
    rig: {
      shoulder: [0.105, 0.7625, -0.01], elbow: [0.195, 0.65, -0.01], wrist: [0.27, 0.575, 0], handTip: [0.3075, 0.50, 0.01],
      neck: 0.82, headTop: 1.0, hip: [0.05, 0.52], knee: [0.06, 0.23], ankle: [0.07, 0.065], pelvis: 0.55,
    },
  },

  rot: {
    id: 'rot', name: 'ROT', model: 'assets/characters/rot.glb',
    tagline: 'The Spinning Storm',
    description: 'A standard fighter with quick feet and a spinning heel kick that clears space.',
    height: 1.72, radius: 0.31, weight: 88,
    walkSpeed: 2.7, runSpeed: 5.8, attackSpeed: 1.05,
    special: 'rot_spin',
    voicePitch: 1.2, color: '#ff9ad0',
    rig: {
      shoulder: [0.0975, 0.77, 0], elbow: [0.195, 0.65, -0.01], wrist: [0.2775, 0.56, 0], handTip: [0.318, 0.485, 0.01],
      neck: 0.82, headTop: 1.0, hip: [0.042, 0.50], knee: [0.042, 0.28], ankle: [0.045, 0.065], pelvis: 0.53,
    },
  },

  lucky: {
    id: 'lucky', name: 'LUCKY', model: 'assets/characters/lucky.glb',
    tagline: 'The Four-Leaf Blur',
    description: 'Tiny, blazing fast and slippery. Weak hits, but he dances around bigger wrestlers and ducks under high attacks.',
    height: 1.08, radius: 0.24, weight: 48,
    maxHealth: 780,
    walkSpeed: 3.6, runSpeed: 8.2, acceleration: 40, turnSpeed: 20,
    jumpStrength: 5.8,
    attackPower: 0.62, attackSpeed: 1.45, defense: 0.0,
    grabStrength: 0.6, knockbackResistance: 0.0,
    dodgeSpeed: 12.5, dodgeDuration: 0.3, dodgeCooldown: 0.25, recoverySpeed: 1.6,
    maxStamina: 120, staminaRegen: 30,
    special: 'clover_blitz', specialCooldown: 10, specialCost: 40,
    moveset: { running: 'lucky_dropkick' },
    voicePitch: 1.8, color: '#4fd06a',
    rig: {
      shoulder: [0.195, 0.73, 0], elbow: [0.30, 0.707, -0.01], wrist: [0.36, 0.70, 0], handTip: [0.408, 0.692, 0],
      neck: 0.765, headTop: 0.93, hip: [0.07, 0.34], knee: [0.07, 0.17], ankle: [0.075, 0.065], pelvis: 0.37,
    },
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);

/** Fully-resolved stats for a character (base defaults + overrides). */
export function getCharacter(id) {
  const c = CHARACTERS[id] || CHARACTERS.masked;
  return { ...BASE_STATS, ...c, moveset: { ...c.moveset } };
}
