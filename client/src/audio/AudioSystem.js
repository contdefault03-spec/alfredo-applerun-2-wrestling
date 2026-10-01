// AudioSystem – Web Audio. All impact/arena sounds are synthesised (no asset
// dependency), samples (Ajan.mp3, AI voice lines) are decoded and played
// through the same spatial pipeline. Buses: sfx / crowd / voice / music.
import { CHARACTERS } from '@shared/config/characters.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = new Map();
    this.log = [];                  // for automated tests (window.__audioLog)
    this.listenerPos = { x: 0, y: 5, z: 10 };
    this.crowdLevel = 0.3;
    this.ready = false;
    if (typeof window !== 'undefined') window.__audioLog = this.log;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain(); this.crowd = c.createGain(); this.voice = c.createGain(); this.music = c.createGain();
      for (const b of [this.sfx, this.crowd, this.voice, this.music]) b.connect(this.master);
      this.noise = this.makeNoise(3);
      this.brown = this.makeNoise(4, true);
      this.reverb = this.makeReverb();
      this.applyVolumes();
      this.startCrowd();
      this.ready = true;
      this.preload('assets/audio/Ajan.mp3');
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings.get();
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
    this.crowd.gain.value = s.crowdVolume;
    this.voice.gain.value = s.voiceVolume;
    this.music.gain.value = s.musicVolume * 0.5;
  }

  makeNoise(sec, brown = false) {
    const c = this.ctx, n = c.sampleRate * sec;
    const b = c.createBuffer(1, n, c.sampleRate); const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  makeReverb() {
    const c = this.ctx, len = c.sampleRate * 2.2;
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const conv = c.createConvolver(); conv.buffer = b;
    const g = c.createGain(); g.gain.value = 0.22;
    conv.connect(g).connect(this.master);
    return conv;
  }

  setListener(pos, forward) {
    this.listenerPos = pos;
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05); L.positionY.setTargetAtTime(pos.y, t, 0.05); L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.setTargetAtTime(forward.x, t, 0.05); L.forwardY.setTargetAtTime(forward.y, t, 0.05); L.forwardZ.setTargetAtTime(forward.z, t, 0.05);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else L.setPosition(pos.x, pos.y, pos.z);
  }

  /** Output node for a one-shot at a world position (spatial) or 2D. */
  out(pos, gain = 1, bus = this.sfx, wet = 0.25) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = gain;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 5; p.rolloffFactor = 0.55; p.maxDistance = 60;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(bus);
    } else g.connect(bus);
    if (wet > 0) { const w = c.createGain(); w.gain.value = wet; g.connect(w).connect(this.reverb); }
    return g;
  }

  // ── building blocks ──
  tone(dst, { type = 'sine', f0 = 100, f1 = null, dur = 0.2, gain = 1, attack = 0.002, t = 0 }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, now);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), now + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(dst); o.start(now); o.stop(now + dur + 0.05);
  }
  burst(dst, { dur = 0.08, gain = 1, type = 'highpass', freq = 1000, q = 0.7, f1 = null, t = 0, brown = false }) {
    const c = this.ctx, now = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = brown ? this.brown : this.noise;
    s.playbackRate.value = rnd(0.9, 1.1);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, now); f.Q.value = q;
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f).connect(g).connect(dst); s.start(now, Math.random() * 2); s.stop(now + dur + 0.05);
  }
  partials(dst, freqs, { dur = 0.8, gain = 0.3, t = 0 }) {
    freqs.forEach((f, i) => this.tone(dst, { f0: f * rnd(0.98, 1.02), dur: dur * (1 - i * 0.12), gain: gain / (1 + i * 0.6), t }));
  }

  // ── named sounds ──
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.ready) return;
    this.log.push({ name, t: performance.now() });
    if (this.log.length > 400) this.log.splice(0, 200);
    const v = opts.volume ?? 1;
    const o = this.out(pos, v, opts.bus || this.sfx, opts.wet ?? 0.25);
    switch (name) {
      case 'punch':
        this.burst(o, { dur: 0.06, gain: 0.7, freq: 900 }); this.tone(o, { f0: 130, f1: 50, dur: 0.1, gain: 0.9 }); break;
      case 'kick':
        this.burst(o, { dur: 0.09, gain: 0.7, type: 'lowpass', freq: 2200 }); this.tone(o, { f0: 95, f1: 38, dur: 0.14, gain: 1 }); break;
      case 'heavy':
        this.burst(o, { dur: 0.16, gain: 0.9, type: 'lowpass', freq: 1500 }); this.tone(o, { f0: 75, f1: 28, dur: 0.3, gain: 1.2 });
        this.tone(o, { type: 'triangle', f0: 160, f1: 60, dur: 0.12, gain: 0.5 }); break;
      case 'slam':
        this.tone(o, { f0: 62, f1: 30, dur: 0.5, gain: 1.4 }); this.burst(o, { dur: 0.3, gain: 0.8, type: 'bandpass', freq: 240, q: 1.2, brown: true });
        this.partials(o, [196, 293, 467, 612], { dur: 0.35, gain: 0.12, t: 0.01 }); this.burst(o, { dur: 0.05, gain: 0.5, freq: 3000 }); break;
      case 'bodyfall':
        this.tone(o, { f0: 70, f1: 34, dur: 0.3, gain: 0.9 }); this.burst(o, { dur: 0.18, gain: 0.5, type: 'bandpass', freq: 300, brown: true }); break;
      case 'metal':
        this.burst(o, { dur: 0.04, gain: 0.8, freq: 4000 });
        this.partials(o, [523, 1177, 1843, 2531, 3222, 4100].map((f) => f * rnd(0.9, 1.1)), { dur: 0.9, gain: 0.35 }); this.tone(o, { f0: 120, f1: 50, dur: 0.12, gain: 0.7 }); break;
      case 'bell_hit':
        this.partials(o, [880, 1760, 2640, 3520, 4400], { dur: 1.6, gain: 0.4 }); this.burst(o, { dur: 0.03, gain: 0.6, freq: 5000 }); break;
      case 'food':
        this.burst(o, { dur: 0.22, gain: 0.9, type: 'lowpass', freq: 2500, f1: 250, q: 3 }); this.tone(o, { f0: 320, f1: 70, dur: 0.14, gain: 0.7 });
        this.tone(o, { f0: 100, f1: 40, dur: 0.18, gain: 0.9 }); break;
      case 'wood':
        this.burst(o, { dur: 0.1, gain: 0.8, type: 'bandpass', freq: 900, q: 2 }); this.partials(o, [180, 410, 730], { dur: 0.2, gain: 0.3 }); break;
      case 'plastic':
        this.burst(o, { dur: 0.08, gain: 0.5, type: 'bandpass', freq: 1500, q: 3 }); this.tone(o, { f0: 400, f1: 200, dur: 0.08, gain: 0.3 }); break;
      case 'block':
        this.tone(o, { f0: 210, f1: 120, dur: 0.08, gain: 0.7 }); this.burst(o, { dur: 0.05, gain: 0.3, freq: 1500 }); break;
      case 'parry':
        this.partials(o, [1200, 1800, 2700], { dur: 0.35, gain: 0.3 }); this.burst(o, { dur: 0.05, gain: 0.5, freq: 2500 }); break;
      case 'whoosh':
        this.burst(o, { dur: 0.14, gain: 0.25, type: 'bandpass', freq: 400, f1: 2400, q: 1.5 }); break;
      case 'rope':
        this.tone(o, { type: 'sawtooth', f0: 92, f1: 70, dur: 0.35, gain: 0.35 }); this.tone(o, { type: 'triangle', f0: 184, f1: 150, dur: 0.25, gain: 0.2 });
        this.burst(o, { dur: 0.12, gain: 0.25, type: 'bandpass', freq: 600 }); break;
      case 'turnbuckle':
        this.tone(o, { f0: 80, f1: 40, dur: 0.25, gain: 1 }); this.partials(o, [310, 620, 930], { dur: 0.5, gain: 0.2 }); break;
      case 'barricade':
        this.tone(o, { f0: 70, f1: 35, dur: 0.35, gain: 1.1 }); this.partials(o, [260, 540, 820, 1400], { dur: 0.6, gain: 0.2 }); this.burst(o, { dur: 0.2, gain: 0.5, type: 'lowpass', freq: 1200 }); break;
      case 'cage':
        this.tone(o, { f0: 60, f1: 30, dur: 0.4, gain: 1.1 });
        this.partials(o, [310, 740, 1210, 1750, 2330], { dur: 1.4, gain: 0.3 });
        for (let i = 0; i < 8; i++) this.burst(o, { dur: 0.03, gain: 0.35, freq: 3000, t: i * rnd(0.03, 0.07) }); break;
      case 'table':
        this.burst(o, { dur: 0.12, gain: 1, freq: 1800 }); this.tone(o, { f0: 80, f1: 30, dur: 0.4, gain: 1.2 });
        this.partials(o, [170, 390, 610], { dur: 0.3, gain: 0.3 });
        for (let i = 0; i < 10; i++) this.burst(o, { dur: 0.04, gain: 0.3, type: 'bandpass', freq: rnd(600, 2000), t: 0.05 + i * rnd(0.02, 0.06) }); break;
      case 'ring_bell':
        [0, 0.28, 0.56].slice(0, opts.times || 1).forEach((t) => this.partials(o, [1046, 2093, 3140, 4186], { dur: 1.8, gain: 0.45, t }));
        break;
      case 'munch':
        for (let i = 0; i < 3; i++) { this.burst(o, { dur: 0.06, gain: 0.7, type: 'bandpass', freq: 1400 + Math.random() * 900, q: 1.5, t: i * 0.11 }); this.tone(o, { f0: 140, f1: 90, dur: 0.07, gain: 0.4, t: i * 0.11 }); }
        break;
      case 'jump': this.burst(o, { dur: 0.08, gain: 0.25, type: 'lowpass', freq: 800 }); break;
      case 'land': this.tone(o, { f0: 90, f1: 40, dur: 0.12, gain: opts.heavy ? 1.2 : 0.5 }); break;
      case 'impact':
        this.tone(o, { f0: 48, f1: 20, dur: 1.1, gain: 1.8 }); this.burst(o, { dur: 0.7, gain: 1.2, type: 'lowpass', freq: 900, brown: true });
        this.partials(o, [196, 293, 467], { dur: 0.5, gain: 0.2 }); break;
      case 'pin_slap': this.tone(o, { f0: 120, f1: 60, dur: 0.1, gain: 0.8 }); this.burst(o, { dur: 0.06, gain: 0.5, freq: 1200 }); break;
      case 'grunt': this.grunt(o, opts.pitch || 1, opts.pain); break;
      case 'ui': this.tone(o, { type: 'triangle', f0: 660, f1: 880, dur: 0.07, gain: 0.25 }); break;
      case 'ui_select': this.tone(o, { type: 'triangle', f0: 520, f1: 1040, dur: 0.14, gain: 0.3 }); this.tone(o, { f0: 1560, dur: 0.1, gain: 0.1, t: 0.05 }); break;
      case 'special_charge':
        this.tone(o, { type: 'sawtooth', f0: 60, f1: 240, dur: 0.6, gain: 0.25 }); this.burst(o, { dur: 0.6, gain: 0.3, type: 'bandpass', freq: 300, f1: 3000 }); break;
      default: this.burst(o, { dur: 0.05, gain: 0.3 });
    }
  }

  grunt(dst, pitch = 1, pain = false) {
    const c = this.ctx, now = c.currentTime;
    const dur = pain ? 0.28 : 0.18;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const f0 = 110 * pitch * rnd(0.9, 1.1);
    o.frequency.setValueAtTime(f0 * (pain ? 1.3 : 1), now); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, now + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.35, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    const vowels = pain ? [[750, 1200], [600, 1000]] : [[600, 1000], [500, 900]];
    const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)];
    const sum = c.createGain(); sum.gain.value = 1;
    for (const [f, q, a] of [[f1 * Math.sqrt(pitch), 6, 1], [f2 * Math.sqrt(pitch), 8, 0.6]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const ga = c.createGain(); ga.gain.value = a;
      o.connect(bp).connect(ga).connect(sum);
    }
    if (pitch < 0.7) { // gorilla growl: add rough low-frequency modulation
      const lfo = c.createOscillator(); lfo.frequency.value = 32; const lg = c.createGain(); lg.gain.value = f0 * 0.25;
      lfo.connect(lg).connect(o.frequency); lfo.start(now); lfo.stop(now + dur);
    }
    sum.connect(g).connect(dst);
    o.start(now); o.stop(now + dur + 0.05);
  }

  // ── samples ──
  async preload(url) {
    if (this.buffers.has(url) || !this.ctx) return this.buffers.get(url);
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab)).catch((e) => { console.warn('audio load failed', url, e); return null; });
    this.buffers.set(url, p);
    return p;
  }

  async playSample(url, pos = null, { volume = 1, bus = null } = {}) {
    if (!this.ctx) return false;
    const buf = await this.preload(url);
    if (!buf) return false;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.connect(this.out(pos, volume, bus || this.sfx, 0.15));
    src.start();
    this.log.push({ name: 'sample:' + url.split('/').pop(), t: performance.now(), duration: buf.duration });
    return true;
  }

  /** Raw encoded audio (e.g. TTS) → voice bus. */
  async playEncoded(arrayBuffer, volume = 1) {
    if (!this.ctx) return false;
    try {
      const buf = await this.ctx.decodeAudioData(arrayBuffer);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      src.connect(this.out(null, volume, this.voice, 0)); src.start();
      return new Promise((res) => { src.onended = () => res(true); });
    } catch (e) { console.warn('voice decode failed', e); return false; }
  }

  /**
   * Play an entrance song (streamed via a <video>/<audio> element so big MP3s
   * don't block). Routed through the music bus when Web Audio is up so master/
   * music volume and compression apply. Returns a handle with stop().
   */
  playEntranceSong(url) {
    let el;
    try {
      el = new Audio(url);
      el.crossOrigin = 'anonymous';
      el.loop = false;
      const s = this.settings.get();
      el.volume = Math.max(0, Math.min(1, (s.musicVolume ?? 0.6) * (s.masterVolume ?? 1)));
      if (this.ctx && this.music) {
        try {
          const src = this.ctx.createMediaElementSource(el);
          const g = this.ctx.createGain(); g.gain.value = 1.0;
          src.connect(g).connect(this.music);
          el.volume = 1; // bus handles level now
        } catch { /* element already wired / unsupported – fall back to el.volume */ }
      }
      el.play().catch(() => { /* autoplay deferred until a gesture */ });
    } catch { return null; }
    return { el, stop() { try { el.pause(); el.src = ''; } catch { /* ignore */ } } };
  }

  // ── crowd ambience ──
  startCrowd() {
    const c = this.ctx;
    const mk = (buf, type, freq, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f).connect(g).connect(this.crowd); s.start(0, Math.random() * 2);
      return { s, f, g };
    };
    // murmur: brown noise, mid band, slowly modulated
    this.murmur = mk(this.brown, 'bandpass', 420, 0.6);
    this.murmur2 = mk(this.noise, 'bandpass', 1100, 0.9);
    // cheer: formant-ish bright layers
    this.cheer = [mk(this.noise, 'bandpass', 800, 1.4), mk(this.noise, 'bandpass', 1500, 1.6), mk(this.noise, 'bandpass', 2700, 2)];
    // boo: low vowel
    this.booLayer = mk(this.brown, 'bandpass', 330, 3);
    this.crowdTarget = { cheer: 0, boo: 0 };
    this.crowdPulse = 0;
  }

  crowdPop(amount = 0.5) { this.crowdPulse = Math.min(1.5, this.crowdPulse + amount); }
  crowdBoo(amount = 0.5) { if (this.crowdTarget) this.crowdTarget.boo = Math.min(1, this.crowdTarget.boo + amount); }

  updateCrowd(dt, loudness) {
    if (!this.ctx || !this.murmur) return;
    const t = this.ctx.currentTime;
    this.crowdPulse = Math.max(0, this.crowdPulse - dt * 0.6);
    this.crowdTarget.boo = Math.max(0, this.crowdTarget.boo - dt * 0.4);
    const wob = 0.8 + 0.2 * Math.sin(t * 0.7) * Math.sin(t * 1.9);
    this.murmur.g.gain.setTargetAtTime(0.28 * wob, t, 0.3);
    this.murmur2.g.gain.setTargetAtTime(0.06 * wob + loudness * 0.05, t, 0.3);
    const cheer = Math.min(1.4, loudness * 0.35 + this.crowdPulse * 0.9);
    this.cheer.forEach((l, i) => l.g.gain.setTargetAtTime(cheer * [0.22, 0.14, 0.06][i], t, 0.12));
    this.booLayer.g.gain.setTargetAtTime(this.crowdTarget.boo * 0.35, t, 0.2);
    this.booLayer.f.frequency.setTargetAtTime(300 + Math.sin(t * 5) * 30, t, 0.05);
  }

  /** Simple generated arena theme for menus (kick/snare/bass). */
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const c = this.ctx; const bpm = 118, beat = 60 / bpm;
    let next = c.currentTime + 0.1, step = 0;
    const bass = [41.2, 41.2, 49, 41.2, 55, 49, 41.2, 36.7];
    this.musicTimer = setInterval(() => {
      while (next < c.currentTime + 0.3) {
        const o = this.music;
        if (step % 4 === 0) { this.tone(o, { f0: 120, f1: 40, dur: 0.18, gain: 0.8, t: next - c.currentTime }); }
        if (step % 8 === 4) this.burst(o, { dur: 0.14, gain: 0.35, type: 'bandpass', freq: 1800, t: next - c.currentTime });
        if (step % 2 === 1) this.burst(o, { dur: 0.03, gain: 0.08, freq: 7000, t: next - c.currentTime });
        if (step % 2 === 0) this.tone(o, { type: 'sawtooth', f0: bass[(step / 2) % 8] * 2, dur: beat * 0.9, gain: 0.12, t: next - c.currentTime });
        next += beat / 2; step++;
      }
    }, 100);
  }
  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }

  voicePitch(charId) { return CHARACTERS[charId]?.voicePitch ?? 1; }
}
