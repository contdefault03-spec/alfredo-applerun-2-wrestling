// TouchControls – on-screen controls for mobile. Writes into Input.virtual, so the
// game, physics, servers and multiplayer are byte-for-byte the same as on PC;
// only the input surface changes. PC controls are untouched.
import { BTN } from '@shared/sim/constants.js';

const BUTTONS = [
  { id: 'punch',    label: 'J',  bit: BTN.PUNCH,    cls: 'tb-a' },
  { id: 'kick',     label: 'K',  bit: BTN.KICK,     cls: 'tb-b' },
  { id: 'grab',     label: 'E',  bit: BTN.GRAB,     cls: 'tb-c' },
  { id: 'interact', label: 'F',  bit: BTN.INTERACT, cls: 'tb-d' },
  { id: 'block',    label: 'BLK', bit: BTN.BLOCK,   cls: 'tb-e', hold: true },
  { id: 'special',  label: 'X',  bit: BTN.SPECIAL,  cls: 'tb-f' },
  { id: 'run',      label: 'RUN', bit: BTN.RUN,     cls: 'tb-g', hold: true },
  { id: 'jump',     label: '▲',  bit: BTN.JUMP,     cls: 'tb-h' },
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.root = null;
    this.stickId = null;
    this.lookId = null;
    this.visible = false;
  }

  /** Is this device plausibly a touch device? (used only to pre-select the chooser) */
  static likelyMobile() {
    return (navigator.maxTouchPoints || 0) > 0 && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  mount() {
    if (this.root) return;
    const el = document.createElement('div');
    el.id = 'touch';
    el.innerHTML = `
      <div class="t-stick" id="t-stick"><div class="t-knob" id="t-knob"></div></div>
      <div class="t-look" id="t-look"></div>
      <div class="t-pad">${BUTTONS.map((b) => `<button class="t-btn ${b.cls}" data-b="${b.id}">${b.label}</button>`).join('')}</div>
      <button class="t-btn t-pause" data-b="pause">II</button>`;
    document.body.appendChild(el);
    this.root = el;
    this.bindStick(el.querySelector('#t-stick'), el.querySelector('#t-knob'));
    this.bindLook(el.querySelector('#t-look'));
    for (const b of BUTTONS) {
      const node = el.querySelector(`[data-b="${b.id}"]`);
      this.bindButton(node, b);
    }
    el.querySelector('[data-b="pause"]').addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.emit('pause'); });
    this.show(false);
  }

  show(on) {
    this.visible = !!on;
    if (!this.root) { if (on) this.mount(); else return; }
    this.root.style.display = on ? 'block' : 'none';
    if (!on) { const v = this.input.virtual; v.fx = v.fz = 0; v.held = 0; }
  }

  bindStick(zone, knob) {
    const v = this.input.virtual;
    const set = (e) => {
      const r = zone.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      v.fx = dx; v.fz = -dy;                    // screen up = forward
      knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
    };
    zone.addEventListener('pointerdown', (e) => { e.preventDefault(); this.stickId = e.pointerId; zone.setPointerCapture(e.pointerId); set(e); });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) set(e); });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; v.fx = 0; v.fz = 0; knob.style.transform = 'translate(0,0)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindLook(zone) {
    const v = this.input.virtual;
    let lx = 0, ly = 0;
    zone.addEventListener('pointerdown', (e) => { e.preventDefault(); this.lookId = e.pointerId; lx = e.clientX; ly = e.clientY; zone.setPointerCapture(e.pointerId); });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      v.lookDX += (e.clientX - lx) * 1.6; v.lookDY += (e.clientY - ly) * 1.2;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  bindButton(node, b) {
    const v = this.input.virtual;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.classList.add('on');
      if (b.hold) v.held |= b.bit; else v.pressed |= b.bit;
    });
    const up = (e) => { e?.preventDefault?.(); node.classList.remove('on'); if (b.hold) v.held &= ~b.bit; };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('pointerleave', up);
  }
}
