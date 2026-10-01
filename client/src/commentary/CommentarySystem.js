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
  }

  async fetchCaps() {
    try {
      const r = await fetch(apiUrl('/api/config'), { signal: AbortSignal.timeout(3000) });
      if (r.ok) this.caps = await r.json();
    } catch { /* static hosting / offline – fallback only */ }
  }

  /** Local matches run their own engine. Online matches receive lines from the server. */
  startLocal(world) {
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
    const mode = this.settings.get().voice;
    if (mode === 'off') return;
    this.voiceQueue.push({ text: line.text, speaker: idx, priority: line.priority || 1 });
    if (this.voiceQueue.length > 2) this.voiceQueue.sort((a, b) => b.priority - a.priority).length = 2;
    this.pump();
  }

  async pump() {
    if (this.speaking || !this.voiceQueue.length) return;
    this.speaking = true;
    const item = this.voiceQueue.shift();
    const mode = this.settings.get().voice;
    let ok = false;
    if (mode === 'ai' && this.caps.tts) ok = await this.speakAI(item);
    if (!ok) await this.speakBrowser(item);
    this.speaking = false;
    this.pump();
  }

  async speakAI(item) {
    try {
      const r = await fetch(apiUrl('/api/tts'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.text, speaker: item.speaker }), signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) return false;
      const buf = await r.arrayBuffer();
      return await this.audio.playEncoded(buf, 1);
    } catch { return false; }
  }

  speakBrowser(item) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) return resolve(false);
      const u = new SpeechSynthesisUtterance(item.text);
      const voices = speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en'));
      if (voices.length) u.voice = voices[item.speaker % voices.length];
      u.rate = 1.12; u.pitch = item.speaker ? 1.05 : 0.9;
      u.volume = Math.min(1, this.settings.get().voiceVolume * this.settings.get().masterVolume * 1.2);
      const done = () => resolve(true);
      u.onend = done; u.onerror = done;
      setTimeout(done, 7000);
      speechSynthesis.speak(u);
    });
  }
}
