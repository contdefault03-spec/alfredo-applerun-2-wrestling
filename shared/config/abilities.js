// ─────────────────────────────────────────────────────────────────────────────
// SPECIAL ABILITIES – referenced by characters.js `special`.
// Activation costs `specialCost` meter (per character) and starts `specialCooldown`.
//   kind: leap_crush | barrage | blitz | grapple | launcher | spear | spin
// ─────────────────────────────────────────────────────────────────────────────
export const ABILITIES = {
  ajan_crush: {
    id: 'ajan_crush', name: 'SILVERBACK CRUSH', kind: 'leap_crush',
    description: 'Locks onto a rival, leaps high into the air and crashes down on top of them for massive damage.',
    minRange: 1.2, maxRange: 9.5,  // opponent must be within this distance to activate
    lockTime: 0.4,                 // prepare/lock-on crouch
    airTime: 0.85, peakHeight: 4.2,
    recovery: 0.7,
    damage: 290, radius: 1.5,      // crush radius at landing (target + anyone caught)
    splashDamage: 70, splashRadius: 2.6,
    knockback: 9, launch: 3.5, downTime: 3.2,
    sound: 'assets/audio/Ajan.mp3',    // plays when the crush successfully lands
    hitEvent: 'AJAN_SPECIAL_HIT',
    camera: 'cinematic',
    crowd: 1.0,
  },
  iron_barrage: {
    id: 'iron_barrage', name: 'IRON BARRAGE', kind: 'barrage',
    description: 'A storm of alternating iron-weight strikes finished with a double overhead smash.',
    dash: 5.5, hits: [0.18, 0.34, 0.5, 0.66, 0.82], hitDamage: 34, finisherAt: 1.12, finisherDamage: 150,
    duration: 1.55, reach: 0.6, hitRadius: 0.55, knockback: 8, launch: 3.5, sound: 'metal', crowd: 0.9,
  },
  clover_blitz: {
    id: 'clover_blitz', name: 'CLOVER BLITZ', kind: 'blitz',
    description: 'Lucky vanishes into a blur, dashing around his target with a flurry of quick hits.',
    maxRange: 7, dashSpeed: 16, hits: 5, hitInterval: 0.13, hitDamage: 30, finisherDamage: 70,
    duration: 1.2, knockback: 5, launch: 2.5, sound: 'kick', crowd: 0.8,
  },
  masked_driver: {
    id: 'masked_driver', name: 'MASKED DRIVER', kind: 'grapple', move: 'powerbomb',
    description: 'Snatches the opponent and drives them into the canvas with a sit-out powerbomb.',
    grabRange: 1.4, damage: 250, crowd: 1.0,
  },
  rising_uppercut: {
    id: 'rising_uppercut', name: 'RISING UPPERCUT', kind: 'launcher',
    description: 'A leaping uppercut that launches the opponent sky-high.',
    startup: 0.3, duration: 0.9, reach: 0.7, hitRadius: 0.6, damage: 210, launch: 10, knockback: 3, selfLift: 3.5, sound: 'heavy', crowd: 0.9,
  },
  cave_in: {
    id: 'cave_in', name: 'CAVE-IN SPEAR', kind: 'spear',
    description: 'A shoulder-first spear tackle that folds the opponent in half.',
    startup: 0.25, dashTime: 0.55, speed: 10, hitRadius: 0.65, damage: 230, knockback: 4, sound: 'heavy', crowd: 1.0,
  },
  rot_spin: {
    id: 'rot_spin', name: 'ROT SPIN', kind: 'spin',
    description: 'A spinning heel kick that sweeps everyone around Rot off their feet.',
    startup: 0.2, active: 0.35, duration: 0.95, radius: 1.8, damage: 185, knockback: 8, launch: 3, sound: 'kick', crowd: 0.9,
  },
};
