// Optional Gemini integration (server-side only – the API key never reaches
// the browser). Provides commentary text and (optionally) text-to-speech.
// Env:
//   GEMINI_API_KEY        enables AI commentary
//   GEMINI_MODEL          default gemini-flash-lite-latest (falls back automatically if unavailable)
//   GEMINI_TTS=0          disable AI voice (on by default when a key is set)
//   GEMINI_TTS_MODEL      default gemini-3.8-flash-lite-tts (falls back automatically)
//   GEMINI_RPM            global requests/minute budget for text (default 40)
import { buildPrompt } from '../shared/commentary/CommentaryEngine.js';

const API = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '') + '/models';

class RateLimiter {
  constructor(perMinute) { this.per = perMinute; this.hits = new Map(); }
  allow(key = 'global') {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < 60000);
    if (arr.length >= this.per) { this.hits.set(key, arr); return false; }
    arr.push(now); this.hits.set(key, arr);
    if (this.hits.size > 5000) this.hits.clear();
    return true;
  }
}

export class GeminiProvider {
  constructor(env = process.env, log = console) {
    this.key = env.GEMINI_API_KEY || '';
    // Google retires model names over time – keep a fallback chain and remember what works.
    this.models = [...new Set([env.GEMINI_MODEL, 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'].filter(Boolean))];
    this.ttsModels = [...new Set([env.GEMINI_TTS_MODEL, 'gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'].filter(Boolean))];
    this.model = this.models[0]; this.ttsModel = this.ttsModels[0];
    this.enabled = !!this.key;
    this.ttsEnabled = this.enabled && env.GEMINI_TTS !== '0';
    this.ttsCache = new Map();
    this.global = new RateLimiter(Number(env.GEMINI_RPM || 40));
    this.perClient = new RateLimiter(15);
    this.ttsLimiter = new RateLimiter(Number(env.GEMINI_TTS_RPM || 40));
    this.failures = 0; this.openUntil = 0;
    this.log = log;
    this.voices = ['Puck', 'Kore', 'Fenrir']; // play-by-play, colour, ring announcer
    if (this.enabled) log.info?.(`[gemini] AI commentary enabled (model ${this.model}${this.ttsEnabled ? ', TTS ' + this.ttsModel : ''})`);
  }

  breakerOpen() { return Date.now() < this.openUntil; }
  fail(err) {
    this.failures++;
    if (this.failures >= 5) { this.openUntil = Date.now() + 60000; this.failures = 0; this.log.warn?.('[gemini] too many failures – pausing AI for 60s:', err?.message || err); }
  }

  async call(model, body, timeoutMs) {
    const r = await fetch(`${API}/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`); e.status = r.status; throw e; }
    return r.json();
  }

  /** Try the current model; on 404/400 (retired/unknown model) move down the fallback chain. */
  async callWithFallback(kind, body, timeoutMs) {
    const list = kind === 'tts' ? this.ttsModels : this.models;
    let lastErr;
    for (const m of [kind === 'tts' ? this.ttsModel : this.model, ...list]) {
      try {
        const j = await this.call(m, body(m), timeoutMs);
        if (kind === 'tts') this.ttsModel = m; else this.model = m;
        return j;
      } catch (e) {
        lastErr = e;
        if (e.status !== 404 && e.status !== 400) throw e;
        this.log.warn?.(`[gemini] model ${m} unavailable (${e.status}), trying next`);
      }
    }
    throw lastErr;
  }

  /** @returns {Promise<string|null>} one commentary line, or null (use fallback) */
  async generate(moment, clientKey = 'anon') {
    if (!this.enabled || this.breakerOpen()) return null;
    if (!this.perClient.allow(clientKey) || !this.global.allow()) return null;
    const body = (m) => {
      const generationConfig = { temperature: 1.0, maxOutputTokens: 80 };
      if (/2\.5/.test(m)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      return { contents: [{ role: 'user', parts: [{ text: buildPrompt(moment) }] }], generationConfig };
    };
    try {
      const j = await this.callWithFallback('text', body, 4000);
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(' ')
        .replace(/[\r\n]+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[*#_`]/g, '').trim().slice(0, 180);
      this.failures = 0;
      return text || null;
    } catch (e) { this.fail(e); return null; }
  }

  /** @returns {Promise<Buffer|null>} WAV audio */
  async tts(text, speaker = 0, clientKey = 'anon') {
    if (!this.ttsEnabled || this.breakerOpen()) return null;
    speaker = Math.max(0, Math.min(2, speaker | 0));
    // Only ever voice the line itself – never the voice-direction/stage notes.
    // (A long style prefix used to leak into the audio: "Make it sound like a
    //  ring announcer... AND THE WINNER IS...". sanitizeSpoken() + a short
    //  directive kill that.)
    const spoken = sanitizeSpoken(text);
    if (!spoken) return null;
    const key = speaker + '|' + spoken;
    if (this.ttsCache.has(key)) return this.ttsCache.get(key); // every client in a room asks for the same line
    if (!this.ttsLimiter.allow(clientKey)) return null;
    const style = voiceStyleFor(speaker);
    const p = (async () => {
      // GUARANTEE: the spoken content is ONLY the line itself – never the style
      // directive. Timbre/delivery comes from the prebuilt voice, not from text
      // the model could read aloud. (A text style-prefix used to leak into audio.)
      void style;
      const j = await this.callWithFallback('tts', () => ({
        contents: [{ parts: [{ text: spoken.slice(0, 220) }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voices[speaker] } } } },
      }), 12000);
      const part = j.candidates?.[0]?.content?.parts?.find((x) => x.inlineData);
      if (!part) return null;
      const pcm = Buffer.from(part.inlineData.data, 'base64');
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return /wav/.test(part.inlineData.mimeType || '') ? pcm : wav(pcm, rate);
    })();
    this.ttsCache.set(key, p);
    if (this.ttsCache.size > 60) this.ttsCache.delete(this.ttsCache.keys().next().value);
    try { const buf = await p; if (!buf) this.ttsCache.delete(key); this.failures = 0; return buf; }
    catch (e) { this.ttsCache.delete(key); this.fail(e); return null; }
  }
}

// ── TTS text safety ─────────────────────────────────────────────────────────
// The text-to-speech model must speak ONLY the announcer/commentary line, never
// the voice-direction or any instruction that may have leaked into the text.

/** Short, clean voice directive per speaker (0 play-by-play, 1 colour, 2 ring announcer). */
export function voiceStyleFor(speaker) {
  if (speaker === 2) return 'Speak in a deep, booming, authoritative older male professional wrestling ring announcer voice with huge arena projection';
  if (speaker === 1) return 'Say this like a witty, opinionated wrestling colour commentator';
  return 'Say this like an excited live pro-wrestling play-by-play commentator';
}

/**
 * Strip any instruction / stage-direction / voice-direction so TTS only speaks
 * the real line. Defends against leaks from upstream prompt text as well.
 * @param {string} text
 * @returns {string} the words that should actually be spoken
 */
export function sanitizeSpoken(text) {
  let s = String(text ?? '');
  // remove stage directions: (…), […], *…*, and <…> tags
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\*[^*]*\*/g, ' ').replace(/<[^>]*>/g, ' ');
  // strip whole leading label lines like "Voice: deep and slow\n", "Style: …", "Tone: …"
  s = s.replace(/^\s*(?:voice|style|tone|instruction|direction|note|prompt|system)\s*:[^\n]*(?:\n+|$)/i, '');
  // strip a leading voice-direction clause up to the first ':' – e.g.
  // "Make it sound like a ring announcer:" / "Say this like …:" / "Read aloud …:"
  s = s.replace(
    /^\s*(?:please\s+)?(?:make (?:it|this) sound|say|read|announce|speak|voice|narrate|deliver|read aloud|say this|read this|in (?:a|an|the)|with (?:a|an|the)|like (?:a|an))\b[^:.!?]{0,120}:\s*/i,
    '',
  );
  // collapse whitespace / strip wrapping quotes
  s = s.replace(/\s+/g, ' ').replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
  // if sanitising removed everything, fall back to the trimmed original (never go silent on a real line)
  if (!s) s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s;
}

/** Wrap 16-bit mono PCM in a WAV header. */
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
