// Input – keyboard + mouse + gamepad → the shared input struct
// { mx, mz (world-space, camera-relative), held, pressed } using BTN bits.
import { BTN } from '@shared/sim/constants.js';

export const KEYMAP = {
  KeyJ: BTN.PUNCH, KeyK: BTN.KICK, KeyL: BTN.GRAB, KeyE: BTN.GRAB, KeyI: BTN.BLOCK, KeyQ: BTN.BLOCK,
  KeyC: BTN.DODGE, Space: BTN.JUMP, ShiftLeft: BTN.RUN, ShiftRight: BTN.RUN, KeyF: BTN.INTERACT, KeyG: BTN.THROW,
  KeyX: BTN.SPECIAL, KeyT: BTN.TAUNT, KeyU: BTN.PUNCH | BTN.KICK,
};
export const CONTROLS_HELP = [
  ['WASD', 'Move'], ['Shift', 'Run'], ['Space', 'Jump'], ['J / L-Click', 'Punch (combo)'], ['K / R-Click', 'Kick'], ['U', 'Heavy attack'],
  ['E / L', 'Grab → then J strike · K slam · E throw'], ['Q / I (hold)', 'Block · tap = parry / reversal'], ['C', 'Dodge'],
  ['F', 'Interact: pin · pick up · climb · roll out · tag'], ['G', 'Throw item'], ['X', 'Special ability'], ['T', 'Taunt'],
  ['V', 'Camera mode'], ['Mouse / ←→', 'Rotate camera (click to lock mouse)'], ['Esc', 'Pause'],
];
// standard gamepad mapping
const PAD = { 0: BTN.JUMP, 1: BTN.GRAB, 2: BTN.PUNCH, 3: BTN.KICK, 4: BTN.DODGE, 5: BTN.BLOCK, 6: BTN.SPECIAL, 7: BTN.RUN, 8: BTN.TAUNT, 10: BTN.THROW, 12: BTN.INTERACT, 13: BTN.THROW, 11: BTN.INTERACT };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.held = 0; this.pressed = 0;
    this.mouseDX = 0; this.mouseDY = 0;
    this.enabled = false;
    this.padPrev = 0;
    this.listeners = {};
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.held = 0; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && e.button === 0 && !this.noLock) { canvas.requestPointerLock?.()?.catch?.(() => {}); }
      const b = e.button === 0 ? BTN.PUNCH : e.button === 2 ? BTN.KICK : 0;
      if (b) { this.pressed |= b; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
    });
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt) { for (const fn of this.listeners[evt] || []) fn(); }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (down && e.code === 'Escape') this.emit('pause');
    if (down && e.code === 'KeyV') this.emit('camera');
    if (down && e.code === 'KeyH') this.emit('help');
    if (down && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.emit('confirm');
    if (!this.enabled) return;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (down) { if (!this.keys.has(e.code)) { const b = KEYMAP[e.code]; if (b) this.pressed |= b; } this.keys.add(e.code); }
    else this.keys.delete(e.code);
  }

  /** Sample raw state. cameraYaw: yaw of the camera's forward on the ground plane. */
  sample(cameraYaw) {
    let held = 0, fx = 0, fz = 0; // fx = right, fz = forward (screen space)
    for (const k of this.keys) { const b = KEYMAP[k]; if (b) held |= b; }
    if (this.keys.has('KeyW')) fz += 1; if (this.keys.has('KeyS')) fz -= 1;
    if (this.keys.has('KeyD')) fx += 1; if (this.keys.has('KeyA')) fx -= 1;
    let camTurn = 0;
    if (this.keys.has('ArrowLeft')) camTurn -= 1; if (this.keys.has('ArrowRight')) camTurn += 1;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let padBits = 0, rx = 0, ry = 0;
    for (const p of pads) {
      if (!p) continue;
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
      fx += dz(p.axes[0]); fz -= dz(p.axes[1]);
      rx += dz(p.axes[2] || 0); ry += dz(p.axes[3] || 0);
      p.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) padBits |= PAD[i]; });
      if (p.buttons[9]?.pressed && !(this.padPrev & 1 << 30)) this.emit('pause');
      if (p.buttons[9]?.pressed) padBits |= 1 << 30;
      break;
    }
    const padPressed = padBits & ~this.padPrev; this.padPrev = padBits;
    held |= padBits & 0x7ff;
    const pressed = this.pressed | (padPressed & 0x7ff);
    this.pressed = 0;
    // camera-relative → world
    const m = Math.min(1, Math.hypot(fx, fz));
    let mx = 0, mz = 0;
    if (m > 0.05) {
      const n = Math.hypot(fx, fz);
      const sx = fx / n * m, sz = fz / n * m;
      const s = Math.sin(cameraYaw), c = Math.cos(cameraYaw);
      // camera forward = (s, c); right = (-c, s)… (three.js: +x left of forward when yaw measured like fighters)
      mx = s * sz - c * sx; mz = c * sz + s * sx;
    }
    const look = { dx: this.mouseDX + rx * 14 + camTurn * 10, dy: this.mouseDY + ry * 10 };
    this.mouseDX = this.mouseDY = 0;
    if (!this.enabled) return { mx: 0, mz: 0, held: 0, pressed: 0, look };
    return { mx, mz, held, pressed, look };
  }
}
