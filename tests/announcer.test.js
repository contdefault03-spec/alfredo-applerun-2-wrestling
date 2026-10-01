// Ring-announcer + entrance tests:
//  - the TTS layer speaks ONLY the line, never the voice-direction/instructions
//  - every wrestler has a complete entrance mapping
//  - announcer intro + winner lines are clean, spoken-only text
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSpoken, voiceStyleFor } from '../server/gemini.js';
import { CHARACTER_IDS, CHARACTERS } from '../shared/config/characters.js';
import { getEntrance, entranceIntroLine, winnerAnnounceLine } from '../shared/config/entrances.js';

// instruction/direction fragments that must NEVER survive into spoken audio
const LEAK_PATTERNS = [
  /make it sound/i, /say this like/i, /read aloud/i, /\bvoice\s*:/i, /\bstyle\s*:/i,
  /ring announcer voice/i, /drawing out the names/i, /professional wrestling ring announcer/i,
  /larger-than-life/i, /\binstruction\b/i,
];
const assertNoLeak = (s, msg) => {
  for (const p of LEAK_PATTERNS) assert.ok(!p.test(s), `${msg}: leaked direction ${p} in "${s}"`);
};

test('sanitizeSpoken strips a leaked ring-announcer directive', () => {
  const leaked = 'Make it sound like a ring announcer: AND THE WINNER IS... RIZE!';
  assert.equal(sanitizeSpoken(leaked), 'AND THE WINNER IS... RIZE!');
});

test('sanitizeSpoken strips "Say this like …:" and quotes', () => {
  assert.equal(
    sanitizeSpoken('Say this like an excited commentator: "What a shot from Max!"'),
    'What a shot from Max!',
  );
});

test('sanitizeSpoken strips stage directions and label lines', () => {
  assert.equal(sanitizeSpoken('(booming) Here is your winner... MAX!'), 'Here is your winner... MAX!');
  assert.equal(sanitizeSpoken('Voice: deep and slow\nAND THE WINNER IS... CAVE!'), 'AND THE WINNER IS... CAVE!');
  assert.equal(sanitizeSpoken('[dramatic pause] *loud* DING DING!'), 'DING DING!');
});

test('sanitizeSpoken leaves a clean line untouched and never goes empty', () => {
  assert.equal(sanitizeSpoken('AND THE WINNER IS... RIZE!'), 'AND THE WINNER IS... RIZE!');
  // a line that is *only* a direction must not vanish to silence
  assert.ok(sanitizeSpoken('Say it loud').length > 0);
});

test('ring-announcer voice style is deep/mature/male and carries no leftover text', () => {
  const s = voiceStyleFor(2);
  assert.match(s, /deep/i);
  assert.match(s, /\bmale\b/i);
  assert.match(s, /announcer/i);
  // the three speakers are distinct
  assert.notEqual(voiceStyleFor(0), voiceStyleFor(1));
  assert.notEqual(voiceStyleFor(1), voiceStyleFor(2));
});

test('every wrestler has a complete entrance mapping', () => {
  for (const id of CHARACTER_IDS) {
    const e = getEntrance(id);
    assert.match(e.video, /^assets\/entrances\/.+ent\.mp4$/, `${id} video path`);
    assert.match(e.song, /^assets\/entrances\/.+song\.mp3$/, `${id} song path`);
    assert.ok(typeof e.country === 'string' && e.country.length, `${id} country`);
    assert.ok(Number.isFinite(e.weight) && e.weight > 0, `${id} weight`);
  }
});

test('Max enters in the coat model and swaps back', () => {
  const e = getEntrance('max');
  assert.equal(e.entranceModel, 'maxentr');
  assert.equal(e.coatThrow, true);
});

test('character-specific entrance flags are distinct', () => {
  assert.equal(getEntrance('masked').moonwalk, true);
  assert.equal(getEntrance('ajan').stomps, true);
  assert.equal(getEntrance('lucky').sprint, true);
  assert.equal(getEntrance('rise').victoryCigarette, true);
});

test('entrance intro line names country, weight and wrestler – spoken only', () => {
  const line = entranceIntroLine('max');
  assert.match(line, /ROMANIA/);
  assert.match(line, /245 POUNDS/);
  assert.match(line, /MAX/);
  assertNoLeak(line, 'max intro');
  // every character produces a clean, non-empty intro
  for (const id of CHARACTER_IDS) {
    const l = entranceIntroLine(id);
    assert.ok(l.includes(CHARACTERS[id].name), `${id} intro names the wrestler`);
    assertNoLeak(l, `${id} intro`);
  }
});

test('winner announce line – single and team', () => {
  const single = winnerAnnounceLine(['Rize'], 'pinfall');
  assert.match(single, /RIZE!/);
  assert.match(single, /WINNER/);
  assertNoLeak(single, 'winner single');

  const team = winnerAnnounceLine(['Max', 'Masked'], 'pinfall');
  assert.match(team, /MAX/);
  assert.match(team, /MASKED/);
  assert.match(team, /AND/);

  // empty list degrades gracefully, never throws
  assert.ok(winnerAnnounceLine([]).length > 0);
});
