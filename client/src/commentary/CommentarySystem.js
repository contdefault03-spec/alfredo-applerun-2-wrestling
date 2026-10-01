// CommentarySystem (client) – displays + voices commentary lines.
// Pipeline: game event → CommentaryEngine (filter/cooldown/queue) →
//   text (fallback line, or Gemini via the server when available) →
//   voice (browser speechSynthesis, or AI TTS via the server) → playback.
// Everything degrades gracefully: no server / no key → fallback text + browser voice.
import { CommentaryEngine, SPEAKERS } from '@shared/commentary/CommentaryEngine.js';
import { apiUrl } from '../net/endpoints.js';

export class CommentarySystem {
  constructor({ ui, audio, settings, commentators = [] }) {
    this.ui = ui; this.audio = audio; this.settings = settings; this.commentators = commentators;
    this.engine = null;
    this.caps = { ai: false, tts: false };
    this.speaking = false;
    this.voiceQueue = [];
    this.inflight = 0;
    this.fetchCaps();
    // browsers load voices asynchronously
    if (window.speechSynthesis) { speechSynthesis.getVoices(); speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices()); }
  }

  async fetchCaps() {
    try {
      const r = await fetch(apiUrl('/api/config'), { signal: AbortSignal.timeout(3000) });
      if (r.ok) this.caps = await r.json();
    } catch { /* static hosting / offline – fallback only */ }
  }

  /** Local matches run their own engine. Online matches receive lines from the server. */
  startLocal(world) {
    if (!this.caps.ai) this.fetchCaps();
    this.engine = new CommentaryEngine({
      nameOf: (id) => world.byId(id)?.name ?? 'someone',
      charOf: (id) => world.byId(id)?.charId ?? null,
      mode: world.rules.id,
    });
  }
  stop() { this.engine = null; this.voiceQueue = []; if (window.speechSynthesis) speechSynthesis.cancel(); }

  update(dt, events) {
    if (!this.engine) return;
    const moments = this.engine.update(dt, events);
    for (const m of moments) this.present(m);
  }

  async present(m) {
    let text = m.text;
    const s = this.settings.get();
    if (s.aiCommentary && this.caps.ai && this.inflight < 2) {
      this.inflight++;
      try {
        const r = await fetch(apiUrl('/api/commentary'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: m.key, ctx: m.ctx, speaker: m.speaker?.id }),
          signal: AbortSignal.timeout(3500),
        });
        if (r.ok) { const j = await r.json(); if (j.text) text = j.text; }
      } catch { /* timeout → fallback text */ } finally { this.inflight--; }
    }
    this.show({ ...m, text });
  }

  /** Display + voice a line (also used for server-sent lines online). */
  show(line) {
    const speaker = line.speaker?.name ? line.speaker : SPEAKERS.find((sp) => sp.id === line.speaker) || SPEAKERS[0];
    this.ui.commentary(speaker.name, line.text, line.priority >= 8);
    const idx = SPEAKERS.indexOf(speaker);
    const npc = this.commentators[idx >= 0 ? idx : 0];
    if (npc) { npc.speak(1.2 + line.text.length / 25); if (line.priority >= 9) this.commentators.forEach((c) => c.hype()); }
    this.queueVoice({ text: line.text, speaker: Math.max(0, idx), priority: line.priority || 1 });
  }

  /** Ring announcer (speaker 2) – jumps the queue. */
  announce(text, { who = 'RING ANNOUNCER' } = {}) {
    this.ui.commentary(who, text, true);
    if (window.speechSynthesis && this.currentUtterance) speechSynthesis.cancel();
    this.voiceQueue = [];
    this.queueVoice({ text, speaker: 2, priority: 10 });
  }

  voiceMode() {
    const m = this.settings.get().voice;
    if (m === 'off') return 'off';
    if ((m === 'ai' || m === 'auto') && this.caps.tts) return 'ai';
    return 'browser';
  }

  queueVoice(item) {
    const mode = this.voiceMode();
    if (mode === 'off') return;
    item.at = performance.now();
    // start generating AI audio right away so it overlaps with whatever is playing
    if (mode === 'ai') item.audio = this.fetchAI(item);
    this.voiceQueue.push(item);
    if (this.voiceQueue.length > 3) this.voiceQueue.sort((a, b) => b.priority - a.priority).length = 3;
    this.pump();
  }

  async pump() {
    if (this.speaking || !this.voiceQueue.length) return;
    this.speaking = true;
    const item = this.voiceQueue.shift();
    let ok = false;
    if (performance.now() - item.at < 9000) {
      if (item.audio) { const buf = await item.audio; if (buf) ok = await this.audio.playEncoded(buf, item.speaker === 2 ? 1.2 : 1); }
      if (!ok) await this.speakBrowser(item);
    }
    this.speaking = false;
    this.pump();
  }

  async fetchAI(item) {
    try {
      const r = await fetch(apiUrl('/api/tts'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, speaker: item.speaker }), signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return null;
      return await r.arrayBuffer();
    } catch { return null; }
  }

  speakBrowser(item) {
    return new Promise((resolve) => {
      const ss = window.speechSynthesis;
      if (!ss) return resolve(false);
      const u = new SpeechSynthesisUtterance(item.text);
      const all = ss.getVoices();
      const voices = all.filter((v) => /^en/i.test(v.lang || ''));
      const pool = voices.length ? voices : all;
      if (pool.length) u.voice = pool[(item.speaker * 3) % pool.length];
      u.lang = u.voice?.lang || 'en-US';
      if (item.speaker === 2) { u.rate = 0.88; u.pitch = 0.65; } else { u.rate = 1.12; u.pitch = item.speaker ? 1.08 : 0.9; }
      const s = this.settings.get();
      u.volume = Math.max(0.2, Math.min(1, s.voiceVolume * s.masterVolume * 1.3));
      this.currentUtterance = u; // keep a reference – Chrome drops events of GC'd utterances
      let finished = false;
      const done = () => { if (finished) return; finished = true; this.currentUtterance = null; resolve(true); };
      u.onend = done; u.onerror = done;
      setTimeout(done, 3000 + item.text.length * 90);
      if (ss.paused) ss.resume();
      ss.speak(u);
    });
  }
}
