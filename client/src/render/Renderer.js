// Renderer – WebGL2 renderer + post-processing (MSAA, bloom, vignette/impact
// FX, ACES tone mapping) with quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: true, shadowType: THREE.PCFShadowMap, bloom: false, msaa: 0, crowdDensity: 0.45 },
  medium: { pixelRatio: 1, shadows: true, shadowType: THREE.PCFShadowMap, bloom: true, msaa: 2, crowdDensity: 0.75 },
  high: { pixelRatio: 1.25, shadows: true, shadowType: THREE.PCFShadowMap, bloom: true, msaa: 4, crowdDensity: 1 },
  ultra: { pixelRatio: 2, shadows: true, shadowType: THREE.PCFShadowMap, bloom: true, msaa: 4, crowdDensity: 1 },
};

const FxShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.9 }, uFlash: { value: 0 }, uAberration: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVignette, uFlash, uAberration, uTime, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      vec3 c;
      if (uAberration > 0.0) { c.r = texture2D(tDiffuse, vUv + d * uAberration).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d * uAberration).b; }
      else c = texture2D(tDiffuse, vUv).rgb;
      float v = smoothstep(0.85, 0.2, length(d) * uVignette);
      c *= mix(0.55, 1.0, v);
      c += uFlash;
      c += (h(vUv * 800.0) - 0.5) * uGrain * c;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060a);
    this.scene.fog = new THREE.FogExp2(0x07080f, 0.012);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.flash = 0; this.aberration = 0;
    this.setQuality(quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.fps = 60; this.frames = 0; this.fpsT = 0;
  }

  setQuality(q) {
    this.auto = q === 'auto' || !QUALITY[q];
    this.qualityName = QUALITY[q] ? q : 'high';
    this.q = QUALITY[this.qualityName];
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.type = this.q.shadowType;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.4, 0.95);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.fx = new ShaderPass(FxShader);
    this.composer.addPass(this.fx);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /** Adaptive quality ('auto'): step down when the frame rate stays low. */
  adapt(dt) {
    if (!this.auto) return;
    this.adaptT = (this.adaptT || 0) + dt; this.adaptN = (this.adaptN || 0) + 1;
    if (this.adaptT < 4) return;
    const fps = this.adaptN / this.adaptT; this.adaptT = 0; this.adaptN = 0;
    const order = ['ultra', 'high', 'medium', 'low'];
    const i = order.indexOf(this.qualityName);
    if (fps < 40 && i < order.length - 1) { this.setQuality(order[i + 1]); this.auto = true; this.onAutoChange?.(order[i + 1], fps); }
  }

  impactFlash(amount = 0.25) { this.flash = Math.max(this.flash, amount); this.aberration = Math.max(this.aberration, amount * 0.03); }

  render(dt, time) {
    this.flash = Math.max(0, this.flash - dt * 3);
    this.aberration = Math.max(0, this.aberration - dt * 0.12);
    const u = this.fx.uniforms;
    u.uFlash.value = this.flash * 0.35; u.uAberration.value = this.aberration; u.uTime.value = time % 100;
    this.composer.render(dt);
    this.adapt(dt);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
  }
}
