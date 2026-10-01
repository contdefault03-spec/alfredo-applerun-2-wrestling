// ─────────────────────────────────────────────────────────────────────────────
// ATTACK CONFIGURATION
// Timings are seconds at attackSpeed 1.0 (divided by the character's attackSpeed).
//   startup  – wind-up before the hitbox is live
//   active   – hitbox live window
//   recovery – vulnerable cool-down
// Hitbox: sphere at `reach` metres in front of the attacker's body surface and
//   `height` × attacker height above the feet, radius `hitRadius`. Reach and
//   hitRadius scale with the attacker's size (height / 1.8).
// reaction: flinch | stagger | knockdown | launch
// anim: animation clip id (client/src/anim/Clips.js)
// sound: punch | kick | heavy | metal | food | wood | slam
// ─────────────────────────────────────────────────────────────────────────────
const A = (o) => ({
  type: 'strike', startup: 0.12, active: 0.08, recovery: 0.25, damage: 40, stamina: 5,
  reach: 0.55, height: 0.78, hitRadius: 0.28, knockback: 1.5, launch: 0, reaction: 'flinch',
  stun: 0.3, hitstop: 0.06, sound: 'punch', lunge: 1.2, cancel: 0.6, next: null, crowd: 0.1,
  onlyDowned: false, hitsDowned: false, armor: false, guardBreak: false, weapon: false, ...o,
});

export const ATTACKS = {
  // ── default striking chain (PUNCH, PUNCH, PUNCH) ──
  jab:        A({ name: 'Jab', anim: 'jab_r', damage: 34, startup: 0.1, next: 'hook' }),
  hook:       A({ name: 'Hook', anim: 'hook_l', damage: 46, startup: 0.13, height: 0.8, knockback: 2, next: 'uppercut', stun: 0.36 }),
  uppercut:   A({ name: 'Uppercut', anim: 'uppercut_r', damage: 72, startup: 0.2, active: 0.1, recovery: 0.4, height: 0.62, hitRadius: 0.34,
                  knockback: 3, launch: 4.2, reaction: 'launch', sound: 'heavy', hitstop: 0.1, crowd: 0.35 }),
  // ── KICK ──
  kick:       A({ name: 'Front Kick', anim: 'kick_front', damage: 55, startup: 0.17, active: 0.1, recovery: 0.34, reach: 0.75, height: 0.48,
                  hitRadius: 0.34, knockback: 4.2, reaction: 'stagger', stun: 0.55, sound: 'kick', next: 'roundhouse' }),
  roundhouse: A({ name: 'Roundhouse', anim: 'roundhouse', damage: 88, startup: 0.26, active: 0.12, recovery: 0.45, reach: 0.8, height: 0.62,
                  hitRadius: 0.42, knockback: 6, launch: 2.5, reaction: 'knockdown', sound: 'kick', hitstop: 0.1, crowd: 0.35 }),
  // ── HEAVY (PUNCH + KICK or hold) ──
  heavy:      A({ name: 'Haymaker', anim: 'haymaker', damage: 95, startup: 0.34, active: 0.1, recovery: 0.5, reach: 0.65, height: 0.78, hitRadius: 0.4,
                  knockback: 6.5, launch: 2, reaction: 'knockdown', sound: 'heavy', hitstop: 0.12, guardBreak: true, crowd: 0.4, lunge: 2 }),
  // ── context attacks ──
  running_strike: A({ name: 'Running Clothesline', anim: 'clothesline', type: 'running', damage: 90, startup: 0.08, active: 0.18, recovery: 0.4,
                  reach: 0.4, height: 0.8, hitRadius: 0.5, knockback: 5, launch: 3, reaction: 'knockdown', sound: 'heavy', lunge: 5.5, crowd: 0.45 }),
  running_kick: A({ name: 'Dropkick', anim: 'dropkick', type: 'running', damage: 95, startup: 0.12, active: 0.2, recovery: 0.6, reach: 0.6, height: 0.6,
                  hitRadius: 0.5, knockback: 7, launch: 3, reaction: 'knockdown', sound: 'kick', lunge: 6, crowd: 0.5 }),
  jump_attack: A({ name: 'Jumping Knee', anim: 'jump_knee', type: 'aerial', damage: 70, startup: 0.06, active: 0.25, recovery: 0.25, reach: 0.45, height: 0.55,
                  hitRadius: 0.45, knockback: 4, launch: 2, reaction: 'knockdown', sound: 'kick', lunge: 0 }),
  stomp:      A({ name: 'Stomp', anim: 'stomp', type: 'ground', damage: 42, startup: 0.16, active: 0.08, recovery: 0.3, reach: 0.35, height: 0.08,
                  hitRadius: 0.45, knockback: 0.3, reaction: 'flinch', onlyDowned: true, hitsDowned: true, sound: 'kick', stun: 0.2, lunge: 0.5 }),
  elbow_drop: A({ name: 'Elbow Drop', anim: 'elbow_drop', type: 'ground', damage: 85, startup: 0.35, active: 0.12, recovery: 0.8, reach: 0.4, height: 0.1,
                  hitRadius: 0.55, knockback: 0.2, reaction: 'flinch', onlyDowned: true, hitsDowned: true, sound: 'slam', hitstop: 0.1, crowd: 0.35, lunge: 1 }),
  dive:       A({ name: 'Diving Splash', anim: 'dive', type: 'aerial', damage: 170, startup: 0, active: 0.9, recovery: 0.7, reach: 0, height: 0.2,
                  hitRadius: 0.9, knockback: 1, reaction: 'knockdown', hitsDowned: true, sound: 'slam', hitstop: 0.14, crowd: 1.0 }),
  // ── items ──
  item_swing: A({ name: 'Item Swing', anim: 'item_swing', type: 'item', damage: 0, startup: 0.22, active: 0.12, recovery: 0.4, reach: 0.75, height: 0.7,
                  hitRadius: 0.5, knockback: 5, reaction: 'stagger', stun: 0.6, sound: 'metal', hitstop: 0.1, weapon: true, crowd: 0.5 }),
  item_smash: A({ name: 'Overhead Item Smash', anim: 'item_overhead', type: 'item', damage: 0, startup: 0.4, active: 0.12, recovery: 0.55, reach: 0.7, height: 0.6,
                  hitRadius: 0.55, knockback: 4, launch: 1, reaction: 'knockdown', sound: 'metal', hitstop: 0.14, weapon: true, guardBreak: true, crowd: 0.7, hitsDowned: true }),

  // ── grapples (performed from a hold). `victim` path: [t, fwd, up, side, tilt] in grabber space ──
  grapple_strike: A({ name: 'Headbutt', anim: 'headbutt', type: 'grapple_strike', damage: 38, startup: 0.18, active: 0.06, recovery: 0.25, sound: 'heavy', stun: 0 }),
  body_slam:  { id: 'body_slam', name: 'Body Slam', type: 'grapple', anim: 'body_slam', victimAnim: 'lifted', duration: 1.25, impact: 0.95, damage: 120,
                sound: 'slam', crowd: 0.6, liftRatio: 1.35,
                victim: [[0, 0.75, 0, 0, 0], [0.35, 0.45, 0.9, 0, -1.4], [0.7, 0.55, 1.55, 0, -1.57], [0.95, 0.95, 0.05, 0, -1.57], [1.25, 0.95, 0, 0, -1.57]] },
  suplex:     { id: 'suplex', name: 'Suplex', type: 'grapple', anim: 'suplex', victimAnim: 'suplexed', duration: 1.35, impact: 1.0, damage: 135,
                sound: 'slam', crowd: 0.7, liftRatio: 1.25,
                victim: [[0, 0.7, 0, 0, 0], [0.4, 0.35, 1.2, 0, -1.2], [0.75, -0.3, 1.5, 0, -2.8], [1.0, -1.0, 0.05, 0, -1.57], [1.35, -1.0, 0, 0, -1.57]] },
  powerbomb:  { id: 'powerbomb', name: 'Powerbomb', type: 'grapple', anim: 'powerbomb', victimAnim: 'powerbombed', duration: 1.6, impact: 1.3, damage: 175,
                sound: 'slam', crowd: 0.9, liftRatio: 1.1,
                victim: [[0, 0.7, 0, 0, 0], [0.5, 0.45, 1.25, 0, -2.9], [1.0, 0.5, 1.7, 0, -2.4], [1.3, 0.85, 0.05, 0, -1.57], [1.6, 0.85, 0, 0, -1.57]] },
  irish_whip: { id: 'irish_whip', name: 'Irish Whip', type: 'throw', anim: 'throw', duration: 0.55, release: 0.25, speed: 8.5, damage: 0, sound: 'grunt' },
  heavy_throw:{ id: 'heavy_throw', name: 'Heave Toss', type: 'throw', anim: 'heave', duration: 0.8, release: 0.45, speed: 10, launch: 5, damage: 60, sound: 'grunt', crowd: 0.4 },

  takedown:   A({ name: 'Leg Sweep Takedown', anim: 'takedown', type: 'grapple_takedown', startup: 0.5, active: 0, recovery: 0.05, damage: 0, noHitbox: true }),

  item_throw_anim: A({ name: 'Item Throw', anim: 'item_throw', type: 'item_throw', startup: 0.2, active: 0, recovery: 0.25, damage: 0, noHitbox: true, lunge: 0 }),

  // ── MAX: armed with iron weights – every punch is a weapon shot ──
  max_weight_jab:    A({ name: 'Iron Jab', anim: 'jab_r', damage: 44, startup: 0.12, sound: 'metal', weapon: true, next: 'max_weight_hook' }),
  max_weight_hook:   A({ name: 'Iron Hook', anim: 'hook_l', damage: 58, startup: 0.15, knockback: 2.6, stun: 0.4, sound: 'metal', weapon: true, next: 'max_double_smash' }),
  max_double_smash:  A({ name: 'Double Iron Smash', anim: 'double_smash', damage: 96, startup: 0.26, active: 0.1, recovery: 0.45, height: 0.66, hitRadius: 0.42,
                         knockback: 5.5, launch: 1.5, reaction: 'knockdown', sound: 'metal', weapon: true, hitstop: 0.12, crowd: 0.45 }),
  max_overhead_smash:A({ name: 'Iron Hammer', anim: 'overhead_smash', damage: 118, startup: 0.4, active: 0.1, recovery: 0.55, height: 0.7, hitRadius: 0.45,
                         knockback: 5, launch: 1, reaction: 'knockdown', sound: 'metal', weapon: true, guardBreak: true, hitstop: 0.14, crowd: 0.55, lunge: 2 }),

  // ── AJAN: food in the left hand, heavy everything ──
  ajan_food_slap:  A({ name: 'Food Slap', anim: 'food_slap', damage: 60, startup: 0.2, active: 0.1, recovery: 0.32, reach: 0.6, height: 0.72, hitRadius: 0.45,
                       knockback: 4, reaction: 'stagger', stun: 0.5, sound: 'food', next: 'ajan_backhand', lunge: 1.5 }),
  ajan_backhand:   A({ name: 'Silverback Backhand', anim: 'hook_r', damage: 70, startup: 0.22, active: 0.1, recovery: 0.34, reach: 0.6, height: 0.74, hitRadius: 0.45,
                       knockback: 5, reaction: 'stagger', stun: 0.55, sound: 'heavy', next: 'ajan_food_smash' }),
  ajan_food_smash: A({ name: 'Feast Smash', anim: 'food_smash', damage: 100, startup: 0.36, active: 0.12, recovery: 0.55, reach: 0.65, height: 0.62, hitRadius: 0.55,
                       knockback: 7.5, launch: 3, reaction: 'knockdown', sound: 'food', hitstop: 0.14, guardBreak: true, crowd: 0.55 }),
  ajan_stomp_kick: A({ name: 'Gorilla Push Kick', anim: 'kick_front', damage: 75, startup: 0.24, active: 0.1, recovery: 0.4, reach: 0.7, height: 0.35,
                       hitRadius: 0.5, knockback: 7, reaction: 'knockdown', sound: 'heavy', hitstop: 0.1, next: 'roundhouse' }),
  ajan_double_axe: A({ name: 'Double Axe Handle', anim: 'overhead_smash', damage: 110, startup: 0.5, active: 0.12, recovery: 0.6, reach: 0.6, height: 0.6,
                       hitRadius: 0.6, knockback: 8, launch: 2, reaction: 'knockdown', sound: 'heavy', guardBreak: true, hitstop: 0.16, crowd: 0.6, armor: true }),
  ajan_charge:     A({ name: 'Silverback Charge', anim: 'charge', type: 'running', damage: 100, startup: 0.1, active: 0.3, recovery: 0.55, reach: 0.4, height: 0.55,
                       hitRadius: 0.7, knockback: 10, launch: 3, reaction: 'knockdown', sound: 'heavy', lunge: 6.5, armor: true, crowd: 0.6 }),

  // ── LUCKY ──
  lucky_dropkick:  A({ name: 'Lucky Missile', anim: 'dropkick', type: 'running', damage: 70, startup: 0.08, active: 0.2, recovery: 0.35, reach: 0.55, height: 0.55,
                       hitRadius: 0.5, knockback: 5, launch: 2, reaction: 'knockdown', sound: 'kick', lunge: 9, crowd: 0.5 }),
};
for (const [id, a] of Object.entries(ATTACKS)) a.id = id;

/** Which attack a button press maps to, given the fighter's context. */
export const DEFAULT_MOVESET = {
  punch: 'jab', punch2: 'hook', punch3: 'uppercut',
  kick: 'kick', heavy: 'heavy',
  running: 'running_strike', runningKick: 'running_kick',
  aerial: 'jump_attack', ground: 'stomp', groundHeavy: 'elbow_drop',
  grappleStrike: 'grapple_strike',
  slam: 'body_slam', slamHeavy: 'powerbomb', slamAlt: 'suplex',
  throw: 'irish_whip', heavyThrow: 'heavy_throw',
};
