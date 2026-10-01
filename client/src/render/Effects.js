// Effects – pooled GPU particles (sweat, sparks, dust, food splatter, debris)
// and expanding shockwave rings. One draw call per blend mode.
import * as THREE from 'three';
import { glowTexture } from './Textures.js';

const MAX = 2400;

class ParticlePool {
  constructor(scene, additive) {
    this.pos = new Float32Array(MAX * 3); this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3); this.size = new Float32Array(MAX); this.life = new Float32Array(MAX); this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX); this.alpha = new Float32Array(MAX);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: glowTexture() }, uScale: { value: 600 }, uAlpha: { value: additive ? 1 : 0.45 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uAlpha; varying vec3 vC; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA * uAlpha); if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 6;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 1) {
    const i = this.next; this.next = (this.next + 1) % MAX;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([r, g, b], i * 3);
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav;
  }
  update(dt) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= 9.8 * this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.01) { this.pos[k + 1] = 0.01; this.vel[k + 1] *= -0.3; this.vel[k] *= 0.6; this.vel[k + 2] *= 0.6; }
      this.alpha[i] = Math.min(1, this.life[i] / this.maxLife[i] * 1.5);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.add = new ParticlePool(scene, true);
    this.norm = new ParticlePool(scene, false);
    this.rings = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), ringMat.clone());
      m.visible = false; scene.add(m); this.rings.push({ mesh: m, t: 0, dur: 0.5, max: 3 });
    }
    this.flash = new THREE.PointLight(0xffe6c0, 0, 8, 2);
    scene.add(this.flash);
    this.flashT = 0;
  }

  burst(p, { n = 12, speed = 3, color = [1, 0.9, 0.7], size = 0.08, life = 0.4, additive = true, grav = 0.4, up = 1 } = {}) {
    const pool = additive ? this.add : this.norm;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.2) * up;
      const s = speed * (0.4 + Math.random() * 0.8);
      pool.spawn(p.x, p.y, p.z, Math.cos(a) * s, e * s + Math.random() * s * 0.5, Math.sin(a) * s,
        color[0] * (0.8 + Math.random() * 0.2), color[1] * (0.8 + Math.random() * 0.2), color[2] * (0.8 + Math.random() * 0.2),
        size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.8), grav);
    }
  }

  ring(p, max = 3, dur = 0.5, color = 0xffe0b0) {
    const r = this.rings.find((x) => !x.mesh.visible) || this.rings[0];
    r.mesh.visible = true; r.t = 0; r.dur = dur; r.max = max;
    r.mesh.position.set(p.x, p.y + 0.03, p.z);
    r.mesh.material.color.set(color);
  }

  lightFlash(p, intensity = 30) { this.flash.position.set(p.x, p.y + 0.5, p.z); this.flash.intensity = intensity; this.flashT = 0.12; }

  // ── semantic effects ──
  hit(p, { heavy = false, weapon = false, sound = 'punch' } = {}) {
    this.burst(p, { n: heavy ? 22 : 10, speed: heavy ? 4 : 2.5, color: [1, 0.95, 0.85], size: heavy ? 0.12 : 0.08, life: 0.25 });
    this.burst(p, { n: heavy ? 8 : 4, speed: 2.2, color: [0.75, 0.85, 1], size: 0.03, life: 0.45, additive: true, grav: 1.6 }); // sweat
    if (weapon || sound === 'metal' || sound === 'bell') this.burst(p, { n: 26, speed: 6, color: [1, 0.7, 0.25], size: 0.05, life: 0.35, grav: 1.2 });
    if (sound === 'food') this.burst(p, { n: 34, speed: 4, color: [0.95, 0.35, 0.08], size: 0.07, life: 0.9, additive: false, grav: 1.4 });
    if (sound === 'wood') this.burst(p, { n: 10, speed: 3, color: [0.8, 0.65, 0.4], size: 0.05, life: 0.6, additive: false, grav: 1.2 });
    if (heavy) this.lightFlash(p, 25);
  }
  slam(p, power = 1) {
    this.burst({ x: p.x, y: p.y + 0.05, z: p.z }, { n: Math.round(18 * power), speed: 2.5 * power, color: [0.55, 0.52, 0.5], size: 0.16, life: 0.5, additive: false, grav: 0.4, up: 0.2 });
    this.ring(p, 2.2 * power, 0.45);
  }
  crush(p) {
    this.burst({ x: p.x, y: p.y + 0.1, z: p.z }, { n: 60, speed: 7, color: [0.6, 0.56, 0.52], size: 0.25, life: 0.8, additive: false, grav: 0.4, up: 0.3 });
    this.burst({ x: p.x, y: p.y + 0.4, z: p.z }, { n: 60, speed: 6, color: [1, 0.8, 0.5], size: 0.12, life: 0.5 });
    this.burst({ x: p.x, y: p.y + 0.6, z: p.z }, { n: 50, speed: 5, color: [0.95, 0.35, 0.08], size: 0.08, life: 1.1, additive: false, grav: 1.3 });
    this.ring(p, 6, 0.7, 0xffc080); this.ring(p, 3.5, 0.5, 0xffffff);
    this.lightFlash(p, 80);
  }
  debris(p) {
    this.burst(p, { n: 40, speed: 5, color: [0.85, 0.8, 0.7], size: 0.12, life: 1.2, additive: false, grav: 1.5 });
    this.lightFlash(p, 20);
  }

  update(dt) {
    this.add.update(dt); this.norm.update(dt);
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.t += dt; const u = r.t / r.dur;
      if (u >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(0.2 + u * r.max);
      r.mesh.material.opacity = 0.7 * (1 - u);
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; else this.flash.intensity *= 0.8; }
  }
}

// ── Confetti: thousands of fluttering paper bits raining over the ring ──
export class Confetti {
  constructor(scene, n = 2200) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.ph = new Float32Array(n); this.life = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const pal = [[1, 0.84, 0.25], [0.95, 0.15, 0.25], [0.2, 0.5, 1], [1, 1, 1], [0.3, 0.9, 0.45], [1, 0.45, 0.85]];
    for (let i = 0; i < n; i++) { const c = pal[i % pal.length]; col.set(c, i * 3); this.ph[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPh', new THREE.BufferAttribute(this.ph, 1));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.u = { uTime: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float aPh; attribute float aLife; uniform float uTime; varying vec3 vC; varying float vA; varying float vFlip;
        void main(){ vC = color; vA = clamp(aLife, 0.0, 1.0); vFlip = abs(sin(uTime * 7.0 + aPh));
          vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (aLife > 0.0 ? 52.0 : 0.0) / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; varying float vFlip;
        void main(){ vec2 p = gl_PointCoord - 0.5; if (abs(p.x) > 0.5 * max(vFlip, 0.15) || abs(p.y) > 0.32) discard;
          gl_FragColor = vec4(vC * (0.6 + 0.4 * vFlip), vA); }`,
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = 7;
    scene.add(this.points);
    this.emitT = 0; this.next = 0;
  }
  start(seconds = 9) { this.emitT = seconds; }
  update(dt, time) {
    this.u.uTime.value = time;
    if (this.emitT > 0) {
      this.emitT -= dt;
      const k = Math.floor(dt * 260);
      for (let j = 0; j < k; j++) {
        const i = this.next; this.next = (this.next + 1) % this.n;
        this.pos.set([(Math.random() - 0.5) * 10, 10 + Math.random() * 2, (Math.random() - 0.5) * 10], i * 3);
        this.vel.set([(Math.random() - 0.5) * 0.6, -0.8 - Math.random() * 0.6, (Math.random() - 0.5) * 0.6], i * 3);
        this.life[i] = 8;
      }
    }
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const k = i * 3, ph = this.ph[i];
      this.pos[k] += (this.vel[k] + Math.sin(time * 2.1 + ph) * 0.5) * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += (this.vel[k + 2] + Math.cos(time * 1.7 + ph) * 0.5) * dt;
      if (this.pos[k + 1] < 0.02 + (Math.abs(this.pos[k]) < 3.7 && Math.abs(this.pos[k + 2]) < 3.7 ? 1.2 : 0)) { this.vel[k + 1] = 0; this.vel[k] = this.vel[k + 2] = 0; this.life[i] -= dt * 0.3; }
      else this.life[i] -= dt * 0.05;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aLife.needsUpdate = true;
  }
}
