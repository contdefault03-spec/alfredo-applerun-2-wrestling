// Procedural canvas textures for the arena (no external image assets needed).
import * as THREE from 'three';

export const BRAND = 'RING KINGS';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = null, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noise(ctx, w, h, amt, alpha = 0.05) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
}

/** Ring canvas (mat) with centre logo and worn texture. */
export function ringCanvasTexture() {
  const S = 2048; const c = canvas(S, S); const x = c.getContext('2d');
  x.fillStyle = '#b9b6ae'; x.fillRect(0, 0, S, S);
  // fabric weave
  x.globalAlpha = 0.05;
  for (let i = 0; i < S; i += 4) { x.fillStyle = i % 8 ? '#000' : '#fff'; x.fillRect(i, 0, 2, S); x.fillRect(0, i, S, 2); }
  x.globalAlpha = 1;
  // border stripe
  x.strokeStyle = '#1b2a4a'; x.lineWidth = 40; x.strokeRect(20, 20, S - 40, S - 40);
  x.strokeStyle = '#c8102e'; x.lineWidth = 10; x.strokeRect(60, 60, S - 120, S - 120);
  // centre logo
  x.save(); x.translate(S / 2, S / 2);
  x.fillStyle = 'rgba(20,32,70,0.9)';
  x.beginPath(); x.arc(0, 0, 360, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#d4af37'; x.lineWidth = 18; x.beginPath(); x.arc(0, 0, 340, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#d4af37'; x.font = 'bold 150px Impact, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('RING', 0, -70); x.fillText('KINGS', 0, 90);
  // crown
  x.beginPath(); x.moveTo(-120, -230); x.lineTo(-80, -170); x.lineTo(-40, -250); x.lineTo(0, -170); x.lineTo(40, -250); x.lineTo(80, -170); x.lineTo(120, -230); x.lineTo(110, -150); x.lineTo(-110, -150); x.closePath(); x.fill();
  x.restore();
  // scuffs
  for (let i = 0; i < 260; i++) {
    x.fillStyle = `rgba(60,50,40,${Math.random() * 0.05})`;
    x.beginPath(); x.ellipse(Math.random() * S, Math.random() * S, Math.random() * 90 + 10, Math.random() * 30 + 5, Math.random() * 3, 0, Math.PI * 2); x.fill();
  }
  noise(x, S, S, 10);
  return tex(c);
}

/** Apron skirt with repeated brand name. */
export function apronTexture() {
  const c = canvas(2048, 256); const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#0d1224'); g.addColorStop(1, '#05070d');
  x.fillStyle = g; x.fillRect(0, 0, 2048, 256);
  x.fillStyle = '#c8102e'; x.fillRect(0, 0, 2048, 14);
  x.font = 'bold 110px Impact, Arial Black, sans-serif'; x.textBaseline = 'middle';
  for (let i = 0; i < 2; i++) {
    x.fillStyle = '#e8e8f0'; x.fillText(BRAND, 90 + i * 1024, 128);
    x.fillStyle = '#d4af37'; x.fillText('★', 820 + i * 1024, 128);
  }
  noise(x, 2048, 256, 8);
  return tex(c, { repeat: [1, 1] });
}

/** Barricade padding print. */
export function barricadeTexture() {
  const c = canvas(1024, 128); const x = c.getContext('2d');
  x.fillStyle = '#111318'; x.fillRect(0, 0, 1024, 128);
  x.font = 'bold 62px Impact, Arial Black, sans-serif'; x.fillStyle = '#6f7a99'; x.textBaseline = 'middle';
  x.fillText(BRAND, 30, 66); x.fillStyle = '#c8102e'; x.fillText('LIVE', 420, 66); x.fillStyle = '#6f7a99'; x.fillText(BRAND, 600, 66);
  noise(x, 1024, 128, 12);
  return tex(c, { repeat: [4, 1] });
}

/** Chain-link fence with alpha (Hell-in-a-Cell walls). */
export function chainLinkTexture() {
  const S = 256; const c = canvas(S, S); const x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  x.strokeStyle = '#b8bec4'; x.lineWidth = 9; x.lineCap = 'round';
  const n = 4, step = S / n;
  for (let i = -n; i <= n * 2; i++) {
    x.beginPath(); x.moveTo(i * step, 0); x.lineTo(i * step + S, S); x.stroke();
    x.beginPath(); x.moveTo(i * step, S); x.lineTo(i * step + S, 0); x.stroke();
  }
  const t = tex(c, { repeat: [16, 12] });
  return t;
}

/** Concrete arena floor. */
export function floorTexture() {
  const S = 1024; const c = canvas(S, S); const x = c.getContext('2d');
  x.fillStyle = '#1c1d21'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${Math.random() * 0.025})`;
    x.fillRect(Math.random() * S, Math.random() * S, Math.random() * 40, Math.random() * 40);
  }
  noise(x, S, S, 22);
  return tex(c, { repeat: [6, 6] });
}

/** Ringside protective mats. */
export function matTexture() {
  const S = 512; const c = canvas(S, S); const x = c.getContext('2d');
  x.fillStyle = '#16213d'; x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(0,0,0,0.6)'; x.lineWidth = 6; x.strokeRect(0, 0, S, S);
  noise(x, S, S, 14);
  return tex(c, { repeat: [8, 8] });
}

/** Scrolling LED ribbon board – returns { texture, draw(text, t) }. */
export function ledBoard(w = 2048, h = 128) {
  const c = canvas(w, h); const x = c.getContext('2d');
  const t = tex(c); t.wrapS = THREE.RepeatWrapping;
  const draw = (lines, hue = 350) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, `hsl(${hue},80%,12%)`); g.addColorStop(0.5, `hsl(${(hue + 40) % 360},80%,18%)`); g.addColorStop(1, `hsl(${hue},80%,12%)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.font = `bold ${Math.floor(h * 0.62)}px Impact, Arial Black, sans-serif`; x.textBaseline = 'middle';
    let px = 30;
    for (let i = 0; i < 6; i++) {
      const s = lines[i % lines.length];
      x.fillStyle = i % 2 ? '#ffd24a' : '#ffffff';
      x.fillText(s, px, h / 2 + 3); px += x.measureText(s).width + 90;
      if (px > w) break;
    }
    // LED pixel grid
    x.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < w; i += 4) x.fillRect(i, 0, 1, h);
    for (let j = 0; j < h; j += 4) x.fillRect(0, j, w, 1);
    t.needsUpdate = true;
  };
  return { texture: t, draw, canvas: c };
}

/** Big screen canvas (titantron / side screens). */
export function screenCanvas(w = 1024, h = 576) {
  const c = canvas(w, h); const t = tex(c, { aniso: 1 });
  t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; // updated often – skip mip generation
  return { canvas: c, ctx: c.getContext('2d'), texture: t };
}

/** Soft radial sprite for light glows / cones. */
export function glowTexture() {
  const S = 128; const c = canvas(S, S); const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return tex(c, { srgb: false });
}

/** Vertical gradient for volumetric light cones. */
export function coneTexture() {
  const c = canvas(64, 256); const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  const h = x.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  return tex(c, { srgb: false });
}

/** Desk skirt / small logos. */
export function deskTexture() {
  const c = canvas(1024, 256); const x = c.getContext('2d');
  x.fillStyle = '#0b0e18'; x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#d4af37'; x.font = 'bold 96px Impact, Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(BRAND, 512, 110);
  x.fillStyle = '#8a93b2'; x.font = 'bold 36px Arial, sans-serif'; x.fillText('COMMENTARY', 512, 190);
  return tex(c);
}
