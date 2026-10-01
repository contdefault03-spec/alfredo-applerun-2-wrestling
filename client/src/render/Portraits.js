// Portraits – renders each auto-rigged GLB wrestler to an image once, so the
// character select / lobby / HUD show the real models.
import * as THREE from 'three';
import { CHARACTER_IDS, getCharacter } from '@shared/config/characters.js';
import { PoseSolver, newPose } from '../anim/PoseSolver.js';
import { applyOverrides, GUARD } from '../anim/Clips.js';

export function makePortraits(renderer, assets, W = 256, H = 320) {
  const out = {};
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10131f);
  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x201810, 1.4));
  const key = new THREE.DirectionalLight(0xfff1dd, 3); key.position.set(1.5, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd4af37, 2.5); rim.position.set(-2, 2, -2); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
  const px = new Uint8Array(W * H * 4);
  const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext('2d');
  const prevTarget = renderer.getRenderTarget();
  for (const id of CHARACTER_IDS) {
    const inst = assets.instance(id); if (!inst) continue;
    const c = getCharacter(id);
    const solver = new PoseSolver(inst);
    const pose = newPose(); applyOverrides(pose, GUARD); solver.apply(pose);
    const s = c.height / inst.joints.headTop.y;
    const g = new THREE.Group(); inst.mesh.scale.setScalar(s); g.add(inst.mesh); scene.add(g);
    g.rotation.y = 0.35;
    g.updateMatrixWorld(true);
    // frame head + upper body
    const hTop = c.height;
    const focusY = hTop * 0.78, span = Math.max(0.55, c.height * 0.55);
    cam.position.set(0.25 * span, focusY + 0.05, span / Math.tan(THREE.MathUtils.degToRad(15)) * 0.55);
    cam.lookAt(0, focusY - 0.05, 0);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    ctx.putImageData(img, 0, 0);
    const grad = ctx.createLinearGradient(0, H * 0.6, 0, H); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    out[id] = cvs.toDataURL('image/jpeg', 0.85);
    scene.remove(g);
  }
  renderer.setRenderTarget(prevTarget);
  rt.dispose();
  return out;
}
