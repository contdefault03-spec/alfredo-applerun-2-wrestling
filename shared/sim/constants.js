// Input buttons (bit flags) – identical for keyboard, gamepad, network and AI.
export const BTN = {
  PUNCH: 1, KICK: 2, GRAB: 4, BLOCK: 8, DODGE: 16, JUMP: 32, RUN: 64,
  INTERACT: 128, THROW: 256, SPECIAL: 512, TAUNT: 1024,
};

// Fighter states. The client animator maps each to a clip.
export const S = {
  IDLE: 'idle', MOVE: 'move', JUMP: 'jump', DODGE: 'dodge',
  ATTACK: 'attack', BLOCK: 'block',
  GRAB: 'grab',              // grab attempt (lunge)
  HOLD: 'hold',              // holding an opponent in a grapple
  HELD: 'held',              // being held
  GRAPPLE_MOVE: 'gmove',     // executing slam/suplex/…
  GRAPPLE_VICTIM: 'gvictim', // being slammed (position driven by the grabber)
  THROWING: 'throwing', WHIPPED: 'whipped',
  HITSTUN: 'hitstun', AIRBORNE: 'airborne', KNOCKDOWN: 'knockdown', DOWN: 'down', GETUP: 'getup',
  CORNER_STUN: 'corner', REBOUND: 'rebound',
  CLIMB: 'climb',            // climbing into ring / onto turnbuckle / out
  PERCH: 'perch',            // standing on a turnbuckle
  CAGE_CLIMB: 'cageclimb',
  DIVE: 'dive',
  SPECIAL: 'special',
  PIN: 'pin', PINNED: 'pinned',
  TAUNT: 'taunt', APRON: 'apron', // tag partner waiting on the apron
  KO: 'ko', CELEBRATE: 'celebrate', PARRIED: 'parried',
};

// States in which a fighter accepts new commands.
export const FREE_STATES = new Set([S.IDLE, S.MOVE, S.BLOCK]);
export const DOWN_STATES = new Set([S.DOWN, S.PINNED, S.KO]);
export const INVULN_STATES = new Set([S.CLIMB, S.APRON, S.GETUP, S.GRAPPLE_MOVE, S.CELEBRATE]);

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 20;

// Out-of-combat health regeneration: after taking no damage for HEAL_DELAY
// seconds, a hurt wrestler slowly recovers HEAL_RATE of their max HP per second
// (until they are hit again). Live phase only.
export const HEAL_DELAY = 10;     // seconds since the last damage taken
export const HEAL_RATE = 0.025;   // fraction of max HP regained per second (~slow)

// Localized ring destruction: the canvas is a RING_GRID×RING_GRID grid of
// sections. Heavy impacts in the same section crack it (2 hits) then break a
// hole (RING_BREAK_HITS). Only very heavy wrestlers (Ajan) register impacts.
export const RING_GRID = 3;
export const RING_BREAK_HITS = 3;      // impacts in one section to break it
export const HEAVY_SLAM_WEIGHT = 180;  // kg; only slams from this heavy count
export const FALL_DEPTH = 1.7;         // how far below the canvas a hole drops to
export const FALL_RECOVER = 2.4;       // seconds down in the hole before climbing out
export const FALL_DAMAGE = 70;         // damage from crashing through the ring

// Referee interference: if a wrestler keeps attacking a grounded opponent
// instead of pinning, the ref steps in to stop it. He can then be grabbed.
export const REF_WARN_HITS = 3;        // hits on a downed foe before the ref intervenes
export const REF_HEAT_WINDOW = 3.5;    // seconds; ground-attack heat decays after this
export const REF_WARN_TIME = 2.8;      // how long the ref keeps warning
export const REF_DOWN_TIME = 5;        // seconds the ref is down after being grabbed
export const REF_GRAB_RANGE = 2.0;     // how close a wrestler must be to grab the ref

export const ZONE = { RING: 'ring', FLOOR: 'floor', APRON: 'apron' };
