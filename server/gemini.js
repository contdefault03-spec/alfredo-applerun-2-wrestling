// Optional Gemini integration (server-side only – the API key never reaches
// the browser). Provides commentary text and (optionally) text-to-speech.
// Env:
//   GEMINI_API_KEY        enables AI commentary
//   GEMINI_MODEL          default gemini-2.5-flash
//   GEMINI_TTS=1          also enable AI voice (costs more; off by default)
//   GEMINI_TTS_MODEL      default gemini-2.5-flash-preview-tts
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
    this.model = env.GEMINI_MODEL || 'gemini-2.5-flash';
    this.ttsModel = env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
    this.enabled = !!this.key;
    this.ttsEnabled = this.enabled && env.GEMINI_TTS === '1';
    this.global = new RateLimiter(Number(env.GEMINI_RPM || 40));
    this.perClient = new RateLimiter(15);
    this.ttsLimiter = new RateLimiter(Number(env.GEMINI_TTS_RPM || 12));
    this.failures = 0; this.openUntil = 0;
    this.log = log;
    this.voices = ['Puck', 'Kore'];
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
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  /** @returns {Promise<string|null>} one commentary line, or null (use fallback) */
  async generate(moment, clientKey = 'anon') {
    if (!this.enabled || this.breakerOpen()) return null;
    if (!this.perClient.allow(clientKey) || !this.global.allow()) return null;
    const generationConfig = { temperature: 1.0, maxOutputTokens: 80 };
    if (/2\.5/.test(this.model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    try {
      const j = await this.call(this.model, { contents: [{ role: 'user', parts: [{ text: buildPrompt(moment) }] }], generationConfig }, 3500);
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(' ')
        .replace(/[\r\n]+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '').replace(/[*#_`]/g, '').trim().slice(0, 180);
      this.failures = 0;
      return text || null;
    } catch (e) { this.fail(e); return null; }
  }

  /** @returns {Promise<Buffer|null>} WAV audio */
  async tts(text, speaker = 0, clientKey = 'anon') {
    if (!this.ttsEnabled || this.breakerOpen() || !this.ttsLimiter.allow(clientKey)) return null;
    try {
      const j = await this.call(this.ttsModel, {
        contents: [{ parts: [{ text: `Say it like an excited live pro-wrestling commentator: ${String(text).slice(0, 200)}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voices[speaker % 2] } } } },
      }, 8000);
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part) return null;
      const pcm = Buffer.from(part.inlineData.data, 'base64');
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
      return /wav/.test(part.inlineData.mimeType || '') ? pcm : wav(pcm, rate);
    } catch (e) { this.fail(e); return null; }
  }
}

/** Wrap 16-bit mono PCM in a WAV header. */
function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
