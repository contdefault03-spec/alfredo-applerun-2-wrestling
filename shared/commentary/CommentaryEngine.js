// CommentaryEngine – turns raw simulation events into a small stream of
// *meaningful* commentary moments (never per-frame), with priorities,
// cooldowns and a queue. Produces fallback lines itself; an optional AI
// provider (Gemini via the server) can replace the text.
import { CHARACTERS } from '../config/characters.js';
import { GAME_MODES } from '../config/gameModes.js';

export const SPEAKERS = [
  { id: 'pbp', name: 'Rex Morgan', role: 'play-by-play' },
  { id: 'color', name: 'Dee Carter', role: 'colour' },
];

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Fallback line bank. {a} = main wrestler, {b} = other wrestler, {move} = move name.
export const LINES = {
  MATCH_START: ['And we are underway here tonight!', 'The bell rings — {a} and {b} lock eyes!', 'Here we go! This building is electric!', 'Ding ding! Let’s get it on!'],
  BIG_HIT: ['What a shot from {a}!', '{a} just rocked {b}!', 'Oh! {b} felt that one all the way to the back!', 'Huge {move} from {a}!', 'Listen to that impact!'],
  WEAPON_HIT: ['{a} with the {weapon} — and the crowd loves it!', 'Right across the back with the {weapon}!', '{a} is making full use of that {weapon}!'],
  KNOCKDOWN: ['{b} is down!', '{a} puts {b} on the canvas!', 'Down goes {b}!'],
  SLAM: ['{a} with a devastating {move}!', 'A thunderous {move} by {a}!', 'The whole ring shook on that {move}!'],
  AJAN_SPECIAL_HIT: ['Ajan just crushed him! What an impact!', 'The Silverback came down from the heavens! {b} has been flattened!', 'OH MY! Ajan landed right on top of {b}!', 'That was like a building falling on {b}!'],
  SPECIAL: ['{a} hits the {move}!', 'There it is — the {move}!', '{a} just unleashed the {move} on {b}!'],
  NEAR_FALL: ['Two and — NO! {b} kicks out!', 'How did {b} kick out of that?!', 'So close! {b} is still alive!'],
  PIN_START: ['{a} goes for the cover!', 'Cover by {a}!', '{a} hooks the leg!'],
  PINFALL: ['One, two, three! It’s over!', 'Three count! {a} gets the pinfall!'],
  KO: ['{b} is OUT! They are not getting up!', 'Lights out for {b}!', 'The referee is checking on {b} — this could be it!'],
  ELIMINATION: ['{b} has been eliminated!', 'And {b} is gone! One fewer in this match!'],
  COMEBACK: ['Here comes {a}! The comeback is on!', '{a} refuses to stay down!', 'Don’t count {a} out — what a turnaround!'],
  WINNER: ['Your winner… {a}!', '{a} wins it! What a performance!', 'It’s all over! {a} stands tall!'],
  WINNER_TEAM: ['The team of {a} takes it!', '{a} and company pick up the victory!'],
  ENTER_RING: ['{a} slides back into the ring!', '{a} is back in the ring.'],
  EXIT_RING: ['{a} takes the fight to the outside!', 'We’re spilling to the floor!'],
  OVER_TOP: ['{b} goes over the top rope to the floor!', 'Over the top! {b} crashes to the outside!'],
  ITEM_PICKUP: ['{a} has found a {weapon}!', 'Uh-oh, {a} is armed with a {weapon}!', '{a} grabs a {weapon} from ringside!'],
  TABLE_BREAK: ['THROUGH THE TABLE!', 'That table has been obliterated!', 'Somebody get a new table — that one’s in pieces!'],
  CAGE: ['Rammed into the steel!', '{b} just bounced off the cell wall!', 'The steel is unforgiving!'],
  BARRICADE: ['Into the barricade!', '{b} went crashing into the guardrail!'],
  TURNBUCKLE: ['Into the turnbuckle!', '{b} is stuck in the corner!'],
  DIVE: ['{a} is flying!', '{a} off the top rope!', 'High-risk move by {a}!'],
  CLIMB: ['{a} is going up top!', '{a} climbing the turnbuckle — the crowd is on their feet!'],
  CAGE_CLIMB: ['{a} is climbing the cell!', 'Is {a} crazy? They’re scaling the steel!'],
  TAG: ['Tag made! {b} is in!', '{a} tags out to {b}!'],
  REVERSAL: ['Reversed by {a}!', 'What a counter from {a}!'],
  PARRY: ['{a} caught it and countered!', 'Perfectly timed block by {a}!'],
  TAUNT: ['{a} is playing to the crowd!', '{a} soaking it all in.'],
  TIME_UP: ['Time has expired! We go to the judges’ decision!'],
  FAN_THROW: ['The fans are throwing things into the ring!', 'Someone in the crowd just tossed in a {weapon}!'],
  IDLE: ['Both competitors feeling each other out.', 'What a crowd we have tonight!', 'You can feel the tension in this arena.'],
};

// priority: higher interrupts; cooldown per key (seconds)
const META = {
  MATCH_START: [9, 0], WINNER: [10, 0], WINNER_TEAM: [10, 0], AJAN_SPECIAL_HIT: [9, 0], SPECIAL: [8, 3], PINFALL: [9, 0], KO: [8, 2],
  ELIMINATION: [8, 2], NEAR_FALL: [8, 3], TABLE_BREAK: [7, 4], OVER_TOP: [7, 5], COMEBACK: [7, 12], SLAM: [6, 5], CAGE: [6, 6],
  DIVE: [6, 5], PIN_START: [5, 6], KNOCKDOWN: [4, 7], BIG_HIT: [4, 6], WEAPON_HIT: [5, 6], ITEM_PICKUP: [4, 10], BARRICADE: [5, 7],
  TURNBUCKLE: [3, 8], CLIMB: [4, 8], CAGE_CLIMB: [5, 10], TAG: [6, 4], REVERSAL: [5, 7], PARRY: [3, 10], TAUNT: [2, 15],
  ENTER_RING: [2, 12], EXIT_RING: [3, 12], TIME_UP: [9, 0], FAN_THROW: [3, 15], IDLE: [1, 25],
};

export class CommentaryEngine {
  /**
   * @param {object} opts
   *   nameOf(id) -> display name ; charOf(id) -> character id ; itemName(id) -> string
   *   minGap – minimum seconds between lines
   */
  constructor({ nameOf, charOf, itemName = () => 'weapon', mode = 'normal', minGap = 3.2 } = {}) {
    this.nameOf = nameOf; this.charOf = charOf; this.itemName = itemName; this.mode = mode;
    this.minGap = minGap;
    this.time = 0; this.lastLine = -99; this.lastKey = {}; this.queue = []; this.speaker = 0;
    this.lastEventTime = 0;
  }

  /** Feed sim events; returns commentary moments to voice now: [{key, text, ctx, speaker, priority}] */
  update(dt, events) {
    this.time += dt;
    for (const e of events) {
      const m = this.classify(e);
      if (m) this.enqueue(m);
    }
    if (this.time - this.lastEventTime > 22 && this.time - this.lastLine > 18) this.enqueue({ key: 'IDLE', ctx: {} });
    const out = [];
    // drop stale entries
    this.queue = this.queue.filter((q) => this.time - q.at < 4.5);
    if (this.queue.length && this.time - this.lastLine >= this.minGap) {
      this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at);
      const q = this.queue.shift();
      this.lastLine = this.time; this.lastKey[q.key] = this.time;
      q.speaker = SPEAKERS[this.speaker = q.priority >= 8 ? 0 : 1 - this.speaker];
      q.text = this.fallback(q.key, q.ctx);
      out.push(q);
    }
    return out;
  }

  enqueue(m) {
    const [priority, cd] = META[m.key] || [1, 10];
    if (this.time - (this.lastKey[m.key] ?? -99) < cd) return;
    if (m.key !== 'IDLE') this.lastEventTime = this.time;
    // a big moment clears lesser pending chatter
    if (priority >= 8) this.queue = this.queue.filter((q) => q.priority >= priority);
    if (this.queue.some((q) => q.key === m.key)) return;
    this.queue.push({ ...m, priority, at: this.time });
    if (priority >= 8 && this.time - this.lastLine > 1.2) this.lastLine = -99; // let it through quickly
  }

  ctxFor(a, b, extra = {}) {
    return { a: a != null ? this.nameOf(a) : '', b: b != null ? this.nameOf(b) : '', aChar: a != null ? this.charOf(a) : null, bChar: b != null ? this.charOf(b) : null, mode: GAME_MODES[this.mode]?.name, ...extra };
  }

  classify(e) {
    switch (e.type) {
      case 'match_start': return { key: 'MATCH_START', ctx: this.ctxFor(e.a ?? 1, e.b ?? 2) };
      case 'AJAN_SPECIAL_HIT': return { key: 'AJAN_SPECIAL_HIT', ctx: this.ctxFor(e.fighter, e.victims?.[0], { move: 'Silverback Crush' }) };
      case 'special_hit': return e.ability === 'ajan_crush' ? null : { key: 'SPECIAL', ctx: this.ctxFor(e.fighter, e.victims?.[0] ?? e.victim, { move: e.name }) };
      case 'slam': return e.special ? null : { key: 'SLAM', ctx: this.ctxFor(e.attacker, e.victim, { move: e.moveName }) };
      case 'hit':
        if (e.special) return null;
        if (e.weapon && e.damage >= 60) return { key: 'WEAPON_HIT', ctx: this.ctxFor(e.attacker, e.victim, { move: e.moveName, weapon: (e.moveName || 'weapon').replace(/ Toss$/, '') }) };
        if (e.reaction === 'knockdown' || e.reaction === 'launch') return { key: e.damage >= 90 ? 'BIG_HIT' : 'KNOCKDOWN', ctx: this.ctxFor(e.attacker, e.victim, { move: e.moveName }) };
        if (e.damage >= 95) return { key: 'BIG_HIT', ctx: this.ctxFor(e.attacker, e.victim, { move: e.moveName }) };
        return null;
      case 'kickout': return e.count >= 2 ? { key: 'NEAR_FALL', ctx: this.ctxFor(e.pinner, e.fighter) } : null;
      case 'pin_start': return { key: 'PIN_START', ctx: this.ctxFor(e.fighter, e.victim) };
      case 'pinfall': return { key: 'PINFALL', ctx: this.ctxFor(e.fighter, e.victim) };
      case 'ko': return { key: 'KO', ctx: this.ctxFor(e.by, e.fighter) };
      case 'elimination': return { key: 'ELIMINATION', ctx: this.ctxFor(e.by, e.fighter) };
      case 'comeback': return { key: 'COMEBACK', ctx: this.ctxFor(e.fighter, e.victim) };
      case 'match_end': {
        const w = e.winners || [];
        return { key: w.length > 1 ? 'WINNER_TEAM' : 'WINNER', ctx: this.ctxFor(w[0], null, { winners: w.map((id) => this.nameOf(id)), method: e.method }) };
      }
      case 'enter_ring': return { key: 'ENTER_RING', ctx: this.ctxFor(e.fighter) };
      case 'exit_ring': return { key: 'EXIT_RING', ctx: this.ctxFor(e.fighter) };
      case 'over_top_rope': return { key: 'OVER_TOP', ctx: this.ctxFor(null, e.fighter) };
      case 'item_pickup': return { key: 'ITEM_PICKUP', ctx: this.ctxFor(e.fighter, null, { weapon: e.name || 'weapon' }) };
      case 'table_break': return { key: 'TABLE_BREAK', ctx: {} };
      case 'cage_hit': return { key: 'CAGE', ctx: this.ctxFor(null, e.fighter) };
      case 'barricade_hit': return { key: 'BARRICADE', ctx: this.ctxFor(null, e.fighter) };
      case 'turnbuckle_hit': return { key: 'TURNBUCKLE', ctx: this.ctxFor(null, e.fighter) };
      case 'dive': return { key: 'DIVE', ctx: this.ctxFor(e.fighter, e.target) };
      case 'climb_turnbuckle': return { key: 'CLIMB', ctx: this.ctxFor(e.fighter) };
      case 'cage_climb': return { key: 'CAGE_CLIMB', ctx: this.ctxFor(e.fighter) };
      case 'tag': return { key: 'TAG', ctx: this.ctxFor(e.fighter, e.partner) };
      case 'reversal': return { key: 'REVERSAL', ctx: this.ctxFor(e.fighter, e.victim) };
      case 'parry': return { key: 'PARRY', ctx: this.ctxFor(e.fighter, e.attacker) };
      case 'taunt': return { key: 'TAUNT', ctx: this.ctxFor(e.fighter) };
      case 'time_up': return { key: 'TIME_UP', ctx: {} };
      case 'fan_throw': return { key: 'FAN_THROW', ctx: { weapon: e.itemType?.replace('_', ' ') || 'chair' } };
    }
    return null;
  }

  fallback(key, ctx) {
    const lines = LINES[key] || LINES.IDLE;
    let s = pick(lines);
    if (key === 'AJAN_SPECIAL_HIT' && ctx.bChar) s = s.replace(/crushed him/, 'crushed ' + (ctx.b || 'him'));
    return s.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? '');
  }
}

/** Build the prompt sent to the LLM for a moment. */
export function buildPrompt(moment) {
  const ctx = moment.ctx || {};
  const facts = Object.entries(ctx).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ');
  const who = moment.speaker?.role === 'colour' ? 'colour commentator (opinionated, witty)' : 'play-by-play commentator (energetic, vivid)';
  const charInfo = [ctx.aChar, ctx.bChar].filter(Boolean).map((c) => `${CHARACTERS[c]?.name}: ${CHARACTERS[c]?.tagline}`).join(' | ');
  return `You are the ${who} for a fictional pro-wrestling broadcast called RING KINGS.
Write ONE short spoken line (max 18 words) reacting live to this moment. No hashtags, no emojis, no quotes, no stage directions.
GAME EVENT: ${moment.key}
DETAILS: ${facts}
WRESTLERS: ${charInfo}
Example for AJAN_SPECIAL_HIT: Ajan just crushed him! What an impact!`;
}
