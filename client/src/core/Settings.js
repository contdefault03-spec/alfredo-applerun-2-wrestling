// Settings – persisted in localStorage (safe if storage is unavailable).
const KEY = 'ringkings.settings.v1';
const DEFAULTS = {
  name: '', quality: 'auto', masterVolume: 0.8, sfxVolume: 0.9, crowdVolume: 0.7, voiceVolume: 0.9, musicVolume: 0.4,
  voice: 'browser',            // off | browser | ai
  aiCommentary: true, subtitles: true, cameraMode: 'auto', cameraShake: 1, invertY: false, mouseSens: 1, showControls: true,
  lastChar: 'masked', difficulty: 'normal',
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    try { Object.assign(this.data, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }
    this.listeners = new Set();
  }
  get() { return this.data; }
  set(patch) {
    Object.assign(this.data, patch);
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    for (const fn of this.listeners) fn(this.data, patch);
  }
  onChange(fn) { this.listeners.add(fn); }
}
