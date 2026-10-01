// AssetManager – loads + caches GLB characters (auto-rigged once per type,
// then cloned per fighter), textures and audio buffers, with progress events.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS } from '@shared/config/characters.js';
import { autoRig } from '../anim/AutoRig.js';

export class AssetManager {
  constructor() {
    this.loader = new GLTFLoader();
    this.templates = new Map();   // charId -> { mesh, joints, dims }
    this.pending = new Map();
    this.progress = {};           // charId -> 0..1
    this.listeners = new Set();
    this.base = import.meta.env.BASE_URL || '/';
  }

  onProgress(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn(this.totalProgress()); }
  totalProgress() {
    const ids = Object.keys(CHARACTERS);
    return ids.reduce((s, id) => s + (this.progress[id] || 0), 0) / ids.length;
  }

  url(p) { return this.base.replace(/\/$/, '') + '/' + p.replace(/^\//, ''); }

  /** Load + auto-rig a character (cached). */
  loadCharacter(id) {
    if (this.templates.has(id)) return Promise.resolve(this.templates.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    const cfg = CHARACTERS[id];
    const p = new Promise((resolve, reject) => {
      this.loader.load(this.url(cfg.model), (gltf) => {
        let src = null;
        gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
        gltf.scene.updateMatrixWorld(true);
        const mat = src.material;
        // Tripo exports look like wet plastic under arena lights – tame the gloss
        mat.envMapIntensity = 0.85;
        mat.metalness = Math.min(mat.metalness ?? 0, 0.15);
        mat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * 1.15 + 0.12, 0.42, 1.0);');
        };
        if (mat.map) mat.map.anisotropy = 8;
        const rig = autoRig(src, cfg.rig);
        const tpl = { ...rig, id };
        this.templates.set(id, tpl);
        this.progress[id] = 1; this._emit();
        resolve(tpl);
      }, (e) => { if (e.total) { this.progress[id] = Math.min(0.99, e.loaded / e.total); this._emit(); } }, (err) => { this.pending.delete(id); reject(err); });
    });
    this.pending.set(id, p);
    return p;
  }

  /** Load with retries (flaky mobile networks, dev-server reloads…). */
  async loadWithRetry(id, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try { return await this.loadCharacter(id); } catch (e) { if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
    }
  }

  loadAll() { return Promise.all(Object.keys(CHARACTERS).map((id) => this.loadWithRetry(id).catch((e) => console.error('load fail', id, e)))); }

  /** Make sure every character in `ids` is ready (used before a match starts). */
  ensure(ids) { return Promise.all([...new Set(ids)].map((id) => this.loadWithRetry(id))); }

  /** A fresh skinned instance with its own skeleton. */
  instance(id) {
    const tpl = this.templates.get(id);
    if (!tpl) return null;
    const mesh = skeletonClone(tpl.mesh);
    const bones = {};
    mesh.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    return { mesh, bones, joints: tpl.joints, dims: tpl.dims };
  }
}
