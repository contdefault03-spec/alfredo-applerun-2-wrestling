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

export const ZONE = { RING: 'ring', FLOOR: 'floor', APRON: 'apron' };
