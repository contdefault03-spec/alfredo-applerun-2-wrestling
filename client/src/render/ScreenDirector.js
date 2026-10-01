// ScreenDirector – draws the titantron / LED pillars / ribbon boards:
// match graphics, live health bars, big moments ("FIGHT!", winner names).
import { getCharacter } from '@shared/config/characters.js';
import { TEAM_COLORS } from '../ui/UIManager.js';

export class ScreenDirector {
  constructor(arena) {
    this.arena = arena; this.t = 0; this.acc = 0;
    this.flashText = null; this.flashT = 0;
    this.names = null;
  }
  matchIntro(view) { this.names = view.fighters.map((f) => ({ id: f.id, name: getCharacter(f.charId).name, team: f.team })); this.flash(this.names.map((n) => n.name).join(' VS ')); }
  flash(text) { this.flashText = text; this.flashT = 3.5; }

  update(dt, time, view) {
    this.t += dt; this.acc += dt; this.flashT -= dt;
    if (this.acc < 1 / 8) return; // redraw at ~8 Hz
    this.acc = 0;
    const tron = this.arena.tron; if (!tron) return;
    const { ctx: x, canvas: c } = tron;
    const W = c.width, H = c.height;
    const g = x.createLinearGradient(0, 0, W, H);
    const hue = (time * 12) % 360;
    g.addColorStop(0, `hsl(${hue},70%,10%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},70%,5%)`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // animated light streaks
    for (let i = 0; i < 12; i++) {
      x.fillStyle = `hsla(${(hue + i * 25) % 360},90%,60%,0.08)`;
      const px = ((time * 120 + i * 180) % (W + 400)) - 200;
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px + 60, 0); x.lineTo(px - 140, H); x.lineTo(px - 200, H); x.fill();
    }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (this.flashT > 0 && this.flashText) {
      const s = 1 + Math.max(0, this.flashT - 3) * 0.6;
      x.save(); x.translate(W / 2, H / 2); x.scale(s, s);
      x.font = 'bold 150px Impact, Arial Black, sans-serif'; x.fillStyle = '#ffd24a'; x.shadowColor = '#ff6a00'; x.shadowBlur = 40;
      this.fitText(x, this.flashText, W * 0.9, 150);
      x.restore();
    } else if (view && view.fighters && this.names) {
      x.font = 'bold 64px Impact, Arial Black, sans-serif'; x.fillStyle = '#fff';
      x.fillText((view.rules?.name || '').toUpperCase(), W / 2, 70);
      const fs = view.fighters.filter((f) => !f.hidden);
      const n = fs.length, bw = Math.min(520, (W - 80) / n - 20);
      fs.forEach((f, i) => {
        const cx = 40 + (i + 0.5) * ((W - 80) / n);
        x.fillStyle = TEAM_COLORS[f.team % 6]; x.fillRect(cx - bw / 2, 170, bw, 8);
        x.font = 'bold 70px Impact, Arial Black, sans-serif'; x.fillStyle = '#fff';
        this.fitText(x, getCharacter(f.charId).name, bw, 70, cx, 250);
        x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(cx - bw / 2, 320, bw, 40);
        const hp = Math.max(0, f.hp / f.maxHp);
        x.fillStyle = hp < 0.25 ? '#ff4040' : '#40ff90'; x.fillRect(cx - bw / 2, 320, bw * hp, 40);
        x.font = 'bold 34px Arial, sans-serif'; x.fillStyle = '#ffd24a';
        x.fillText(f.eliminated ? 'ELIMINATED' : f.state === 'ko' ? 'K.O.' : `${Math.round(hp * 100)}%`, cx, 400);
      });
      const t = Math.max(0, view.match?.timeLeft ?? 0);
      x.font = 'bold 90px Impact, Arial Black, sans-serif'; x.fillStyle = '#fff';
      x.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, W / 2, 560);
    } else {
      x.font = 'bold 150px Impact, Arial Black, sans-serif'; x.fillStyle = '#d4af37'; x.shadowColor = '#ff9d00'; x.shadowBlur = 30;
      x.fillText('ALFREDO', W / 2, H / 2 - 130); x.fillText('APPLERUN 2', W / 2, H / 2 + 20); x.shadowBlur = 0;
      x.font = 'bold 70px Impact, Arial Black, sans-serif'; x.fillStyle = '#fff'; x.fillText('WRESTLING', W / 2, H / 2 + 150);
    }
    tron.texture.needsUpdate = true;
    // pillars
    for (const [k, pc] of (this.arena.pillars || []).entries()) {
      const y = pc.ctx, w = pc.canvas.width, h = pc.canvas.height;
      y.fillStyle = `hsl(${(hue + k * 90) % 360},80%,12%)`; y.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) {
        const yy = (i * 80 + time * 200 * (k ? 1 : -1)) % (h + 80);
        y.fillStyle = `hsla(${(hue + i * 20) % 360},90%,55%,0.5)`;
        y.fillRect(0, (yy + h + 80) % (h + 80) - 40, w, 16);
      }
      y.save(); y.translate(w / 2, h / 2); y.rotate(-Math.PI / 2);
      y.font = 'bold 130px Impact, Arial Black, sans-serif'; y.fillStyle = '#fff'; y.textAlign = 'center'; y.textBaseline = 'middle';
      y.fillText(k ? 'APPLERUN 2' : 'ALFREDO', 0, 0); y.restore();
      pc.texture.needsUpdate = true;
    }
    // ribbons scroll
    for (const s of this.arena.screens) if (s.ribbon) s.texture.offset.x = (time * 0.05) % 1;
  }

  fitText(x, text, maxW, size, cx = 0, cy = 0) {
    let s = size;
    x.font = `bold ${s}px Impact, Arial Black, sans-serif`;
    while (x.measureText(text).width > maxW && s > 20) { s -= 6; x.font = `bold ${s}px Impact, Arial Black, sans-serif`; }
    x.fillText(text, cx, cy);
  }
}
