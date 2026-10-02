// ─────────────────────────────────────────────────────────────────────────────
// ENTRANCE CONFIGURATION
// Per-wrestler entrance presentation: the titantron video, the entrance song,
// the ring-announcer introduction (nationality + billed weight + name) and the
// character-specific choreography flags the cinematic entrance director reads.
//
// Asset note: the video and song for every character live in
//   client/public/assets/entrances/<name>ent.mp4  +  <name>song.mp3
// and are referenced as 'assets/entrances/…' (same base-url scheme the
// AssetManager uses for characters). The files are used as-is – never altered.
//
// Keyed by CHARACTER id (see shared/config/characters.js). Note the id `rise`
// maps to the asset basename `rize`, so paths are written out explicitly.
// ─────────────────────────────────────────────────────────────────────────────
import { CHARACTERS } from './characters.js';

/** Default entrance presentation – every character inherits these. */
export const BASE_ENTRANCE = {
  country: 'PARTS UNKNOWN',   // billed hometown/nation the announcer calls out
  weight: 220,                // billed weight in POUNDS (what the announcer says)
  duration: 11,               // authoritative entrance length in seconds (~= song length)
  loopVideo: true,            // the clip loops for the whole entrance; stops cleanly at the end
  // choreography flags the cinematic director reads (all optional):
  entranceModel: null,        // alternate GLB worn on the way out (Max's coat/hat)
  coatThrow: false,           // strips coat/hat/glasses into the crowd, swaps model
  moonwalk: false,            // showmanship moonwalk section (Masked)
  stomps: false,              // heavy stomps + camera shake before reveal (Ajan)
  sprint: false,              // fast, agile run-in (Lucky)
  confident: false,           // slow, confident strut (Rize)
  victoryCigarette: false,    // lights a cigarette in the win celebration (Rize)
  flourish: 'pose',           // a distinct mid-entrance beat so no two look identical
};

export const ENTRANCES = {
  max: {
    country: 'ROMANIA', weight: 245,
    video: 'assets/entrances/maxent.mp4', song: 'assets/entrances/maxsong.mp3', duration: 29.0,
    // Comes out in the coat/hat/glasses model, throws them to the crowd, then
    // swaps to the in-ring model. Weights stay in his hands throughout.
    entranceModel: 'maxentr', coatThrow: true, keepHands: true, flourish: 'coat_throw',
  },
  masked: {
    country: 'ALBANIA', weight: 225,
    video: 'assets/entrances/maskedent.mp4', song: 'assets/entrances/maskedsong.mp3', duration: 15.5,
    moonwalk: true, flourish: 'moonwalk',
  },
  ajan: {
    country: 'ALBANIA', weight: 573,   // the Silverback – billed heaviest by far
    video: 'assets/entrances/ajanent.mp4', song: 'assets/entrances/ajansong.mp3', duration: 13.2,
    stomps: true, shake: true, flourish: 'stomp',
  },
  rise: {
    country: 'SPAIN', weight: 228,
    video: 'assets/entrances/rizeent.mp4', song: 'assets/entrances/rizesong.mp3', duration: 9.6,
    confident: true, victoryCigarette: true, flourish: 'strut',
  },
  cave: {
    country: 'DENMARK', weight: 240,
    video: 'assets/entrances/caveent.mp4', song: 'assets/entrances/cavesong.mp3', duration: 8.5,
    flourish: 'coat_spread',
  },
  rot: {
    country: 'COLOMBIA', weight: 205,
    video: 'assets/entrances/rotent.mp4', song: 'assets/entrances/rotsong.mp3', duration: 10.3,
    flourish: 'spin',
  },
  lucky: {
    country: 'LITHUANIA', weight: 112,  // tiny + fastest
    video: 'assets/entrances/luckyent.mp4', song: 'assets/entrances/luckysong.mp3', duration: 15.2,
    sprint: true, flourish: 'star_jump',
  },
};

/** Fully-resolved entrance config for a character (defaults + overrides). */
export function getEntrance(id) {
  const e = ENTRANCES[id] || ENTRANCES.masked;
  return { ...BASE_ENTRANCE, ...e };
}

/** Display name for a character id (falls back gracefully). */
function nameOf(id) { return (CHARACTERS[id]?.name || String(id || 'the challenger')).toUpperCase(); }

/**
 * Ring-announcer introduction read as the wrestler enters the ring, e.g.
 *   "WE HAVE HERE, FIGHTING TONIGHT... OUT OF ROMANIA... WEIGHING 245 POUNDS... MAX!"
 * Returns ONLY the spoken line – no instructions, no stage directions.
 * @param {string} id character id
 * @returns {string}
 */
export function entranceIntroLine(id) {
  const e = getEntrance(id);
  return `WE HAVE HERE, FIGHTING TONIGHT... OUT OF ${e.country}... WEIGHING ${e.weight} POUNDS... ${nameOf(id)}!`;
}

const WINNER_FORMS = [
  (n) => `AND THE WINNER IS... ${n}!`,
  (n) => `HERE IS YOUR WINNER... ${n}!`,
];

/**
 * Ring-announcer winner declaration. Concise and theatrical – ONLY the spoken
 * words. `names` is a list of winning wrestler display names.
 * @param {string[]} names
 * @param {string} [method] win method (unused in the spoken line, kept for callers)
 * @returns {string}
 */
export function winnerAnnounceLine(names, method) {
  const list = (names || []).map((n) => String(n || '').toUpperCase()).filter(Boolean);
  if (!list.length) return 'AND THE WINNER IS...';
  if (list.length === 1) {
    const form = WINNER_FORMS[Math.floor(Math.random() * WINNER_FORMS.length)];
    return form(list[0]);
  }
  const last = list.pop();
  return `AND YOUR WINNERS... ${list.join(', ')} AND ${last}!`;
}
