// EntranceDirector – client-side cinematic for the authoritative entrance phase.
// The sim owns WHO is entering and HOW FAR along (index + time), server-
// authoritative and identical on every client. This module turns that state
// into the show: the entrant walks the ramp into the ring, their video plays on
// the titantron while their song plays, the camera cuts around them, the ring
// announcer introduces them at the ring, and J casts a skip vote.
//
// It never moves sim bodies – it only overrides render positions/visibility
// during the entrance (gameplay positions matter only once the match is live),
// so it stays in sync online without any extra networking.
import * as THREE from 'three';
import { ARENA } from '@shared/config/arena.js';
import { BTN } from '@shared/sim/constants.js';
import { getCharacter } from '@shared/config/characters.js';
import { getEntrance, entranceIntroLine } from '@shared/config/entrances.js';

const BASE = ((typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/').replace(/\/$/, '');
const assetUrl = (p) => BASE + '/' + String(p).replace(/^\//, '');
const STAGE_Z = ARENA.entrance.zEnd + 2;      // where the wrestler appears on the stage
const APPROACH_Z = ARENA.ring.apronHalf + 1.1; // ring-side, just before climbing in

export class EntranceDirector {
  constructor({ scene, camera, audio, arena, screens, commentary, ui, views, effects = null, assets = null }) {
    this.scene = scene; this.camera = camera; this.audio = audio; this.arena = arena;
    this.screens = screens; this.commentary = commentary; this.ui = ui; this.views = views;
    this.effects = effects; this.assets = assets; this._swapped = null;
    this.t = 0;
    this.active = false;
    this._mediaFor = null;      // fighter id whose media is playing
    this._announced = false;
    this._coatThrown = false;   // Max's coat/hat/glasses toss done this entrance
    this._firedEntry = false;   // ring-entry pyro done
    this._props = [];           // flying entrance props (coat etc.)
    this._song = null;
    this.video = null;
    this._shot = -1;
    this._look = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this.getSession = null;     // set by Game: () => current session
    this.getNet = null;         // set by Game: () => net client (online)
  }

  // Cinematic shot list – cam(E, SZ, u) where u is 0..1 progress WITHIN the shot,
  // so the camera dollies/cranes/trucks instead of sitting still. Hard cuts
  // between shots give the broadcast feel. All angles stay inside the arena.
  static SHOTS = [
    { end: 0.11, cam: (E, SZ, u) => ({ pos: [5 - u * 2.5, 3.4 - u * 1.2, SZ + 6 - u * 3], look: [0, 2.1, SZ - 1] }) },               // push in on the tunnel
    { end: 0.22, cam: (E, s, u) => ({ pos: [E.x + Math.sin(u * 1.2 + 0.4) * 3, E.y + 0.7, E.z + Math.cos(u * 1.2 + 0.4) * 3], look: [E.x, E.y + 1.45, E.z] }) }, // low hero orbit
    { end: 0.33, cam: (E, s, u) => ({ pos: [E.x - 1.7 + u * 1.0, E.y + 1.72, E.z - 1.5], look: [E.x, E.y + 1.55, E.z] }) },           // close-up, slow dolly across the face
    { end: 0.46, cam: (E, s, u) => ({ pos: [E.x + 4.6, E.y + 1.9, E.z + (u - 0.5) * 4], look: [E.x, E.y + 1.3, E.z] }) },             // trucking side shot of the walk
    { end: 0.57, cam: (E, s, u) => ({ pos: [0, 6 + u * 9, -5 - u * 13], look: [0, 1.4, 3] }) },                                       // crane up to the whole stadium
    { end: 0.67, cam: (E, SZ, u) => ({ pos: [-2 + u * 4, 6.8, SZ - 3.5], look: [0, 7.4, SZ + 5.4] }) },                               // pan across the titantron
    { end: 0.82, cam: (E, s, u) => ({ pos: [E.x - Math.sin(E.yaw) * (5.5 - u * 1.5), E.y + 2.7 - u * 1.0, E.z - Math.cos(E.yaw) * (5.5 - u * 1.5)], look: [E.x, E.y + 1.2, E.z] }) }, // push in from behind toward the ring
    { end: 1.01, cam: (E, s, u) => ({ pos: [Math.sin(0.5 + u * 1.1) * 6, 3.2, Math.cos(0.5 + u * 1.1) * -6], look: [0, ARENA.ring.height + 1.2, 0] }) }, // orbit the ring hero shot
  ];

  /** Normalised entrance state from either session view, or null when not entering. */
  resolve(view) {
    const m = view?.match;
    if (!m || m.phase !== 'entrances') return null;
    let index, t, dur, votes, need, fighterId;
    if (typeof m.entranceState === 'function') {          // local: live MatchSystem
      if (m.entranceIndex < 0) return { pending: true };
      index = m.entranceIndex; t = m.entranceTime; dur = m.entranceDur;
      votes = m.skipVotes.size; need = m.humanParticipants().length; fighterId = m.currentEntrant;
    } else if (m.entrance) {                               // online: decoded snapshot
      const e = m.entrance; index = e.index; t = e.t; dur = e.dur; votes = e.votes; need = e.need; fighterId = e.fighter;
    } else return { pending: true };
    // order is deterministic = fighter array order (matches the sim's entranceOrder)
    const order = view.fighters.filter((f) => !f.hidden && !f.eliminated).map((f) => f.id);
    return { index, t, dur, votes, need, fighterId, order, p: dur > 0 ? Math.min(1, t / dur) : 0 };
  }

  /** Override render transforms before the fighter views update. Mutates `view` fighters. */
  applyPositions(view, en, dt) {
    if (en.pending) { for (const f of view.fighters) f._entranceHidden = true; return; }
    for (const f of view.fighters) {
      const pos = en.order.indexOf(f.id);
      if (pos < 0) continue;
      if (pos > en.index) { f._entranceHidden = true; continue; } // not out yet
      f._entranceHidden = false;
      if (pos < en.index) continue;                                // already in the ring
      this.placeWalk(f, en.p, dt);                                 // the current entrant
      this.sideFire(f, en.p, dt);                                  // flames up the sides of the aisle
    }
  }

  placeWalk(f, p, dt) {
    const spawnX = f._spawnX ?? (f._spawnX = f.x);
    const spawnZ = f._spawnZ ?? (f._spawnZ = f.z);
    const ringH = ARENA.ring.height;
    const reveal = f.charId === 'ajan' ? 0.22 : 0.12; // Ajan lingers at the tunnel to stomp
    let x, y, z, walking = false;
    if (p < reveal) {               // reveal / pose (or stomp) on the stage
      x = 0; z = STAGE_Z; y = 0;
    } else if (p < 0.78) {          // walk down the ramp toward the ring
      const raw = (p - reveal) / (0.78 - reveal);
      // human pacing: a slight speed ripple (occasional slow/fast) instead of a constant march
      const uu = Math.max(0, Math.min(1, raw + Math.sin(raw * Math.PI * 2.5) * 0.035));
      // a gentle side-to-side zig-zag that settles as they near the ring; per-character amount
      const swayAmt = f.charId === 'lucky' ? 0.14 : f.charId === 'max' ? 0.5 : f.charId === 'ajan' ? 0.25 : 0.4;
      const sway = Math.sin(raw * Math.PI * 3 + (f._spawnX || 0)) * swayAmt * (1 - raw);
      x = spawnX * 0.35 * uu + sway; z = STAGE_Z + (APPROACH_Z - STAGE_Z) * uu; y = 0; walking = true;
      f._lookCrowd = Math.sin(raw * Math.PI * 4) * 0.3; // slight head/body turn toward the crowd
    } else if (p < 0.9) {           // climb UP onto the apron, then step in (not a diagonal float)
      const u = (p - 0.78) / 0.12;
      y = ringH * Math.min(1, u * 2);                     // rise onto the ring in the first half = a climb
      x = spawnX * 0.35 + (spawnX - spawnX * 0.35) * u;
      z = APPROACH_Z + (spawnZ - APPROACH_Z) * u;
      walking = true;
    } else {                        // settle at the ring spawn, final pose
      x = spawnX; z = spawnZ; y = ringH;
    }
    f.relaxed = true;              // casual/cool entrance posture (no combat guard on the way out)
    f.x = x; f.y = y; f.z = z; f.yaw = Math.atan2(-x, -z) + (walking ? (f._lookCrowd || 0) : 0);
    if (walking) {
      // fake forward velocity so the Animator actually plays the walk cycle
      const spd = (f.c?.walkSpeed || 2.6);
      f.state = 'move'; f.vx = Math.sin(f.yaw) * spd; f.vz = Math.cos(f.yaw) * spd;
      f.runTime = (f.runTime || 0) + dt;
    } else {
      // on the stage and in the ring: play to the crowd (taunt = signs/gestures)
      f.state = 'taunt'; f.vx = 0; f.vz = 0;
    }
  }

  /** Drive media, camera, announcer and skip UI for the frame. */
  update(dt, view, en, byId, { pressed = 0 } = {}) {
    this.t += dt; this.active = true;
    this.screens.suspended = true; // we own the titantron during entrances
    if (en.pending) return;
    if (pressed & BTN.PUNCH) this.voteSkip(view);

    const f = byId.get(en.fighterId);
    const charId = f?.charId;
    if (en.fighterId != null && en.fighterId !== this._mediaFor) {
      this.startMedia(charId);
      this._mediaFor = en.fighterId; this._announced = false; this._coatThrown = false; this._firedEntry = false; this._shot = -1; this._lastStomp = 0;
      this.clearHandProp();
      const cfg0 = charId ? getEntrance(charId) : null;
      if (cfg0?.eatFood) this.spawnHandProp('food');
      else if (cfg0?.cigarette) this.spawnHandProp('cig');
      // Max walks out in his coat/hat/glasses model
      const em = charId ? getEntrance(charId).entranceModel : null;
      if (em && this.assets && this.views.get(en.fighterId)) {
        if (this.views.get(en.fighterId).swapModel(this.assets, em)) this._swapped = en.fighterId;
      }
    }
    this.drawTron(charId, en);
    if (f) this.updateHandProp(f, charId, en.p);

    // Ajan stomps at the tunnel before he walks out – shake, dust, booms
    if (charId === 'ajan' && getEntrance('ajan').stomps && en.p < 0.22) {
      if (this.t - (this._lastStomp || 0) > 0.55) {
        this._lastStomp = this.t; this._shake = 1.0;
        this.audio.play?.('impact', { x: 0, y: 0, z: STAGE_Z }, { volume: 1.3 });
        this.audio.crowdPop?.(0.6);
        if (this.effects) this.effects.burst({ x: (Math.random() - 0.5) * 2.5, y: 0.1, z: STAGE_Z }, { n: 18, speed: 3.5, color: [0.42, 0.34, 0.24], size: 0.16, life: 0.8, additive: false, grav: 1.6, up: 1.8 });
      }
    }

    // Max flings his coat/hat/glasses into the crowd mid-ramp
    if (charId && !this._coatThrown && en.p > 0.5 && getEntrance(charId).coatThrow && f) {
      this._coatThrown = true;
      this.throwCoat(f);
      // the coat comes off → become the normal in-ring model
      if (this._swapped === en.fighterId && this.assets) {
        this.views.get(en.fighterId)?.swapModel(this.assets, charId);
        this._swapped = null;
      }
    }
    this.updateProps(dt);

    // ring announcer introduces the wrestler as they reach the ring + pyro
    if (!this._announced && en.p > 0.82 && charId) {
      this._announced = true;
      this.commentary.announce(entranceIntroLine(charId));
      this.audio.crowdPop?.(1.3);
    }
    if (!this._firedEntry && en.p > 0.86) { this._firedEntry = true; this.pyro(); }

    // multi-angle cinematic camera with hard cuts
    this.cinematicCamera(dt, en, f);

    // skip prompt + vote tally
    this.ui.prompt?.([{ key: 'J', text: `SKIP ENTRANCE   (votes ${en.votes}/${Math.max(1, en.need)})`, hot: true }]);
  }

  cinematicCamera(dt, en, f) {
    const SZ = STAGE_Z;
    const E = f ? { x: f.x, y: f.y, z: f.z, yaw: f.yaw } : { x: 0, y: 0, z: SZ, yaw: 0 };
    const shots = EntranceDirector.SHOTS;
    let idx = shots.findIndex((s) => en.p < s.end);
    if (idx < 0) idx = shots.length - 1;
    const prevEnd = idx > 0 ? shots[idx - 1].end : 0;
    const u = Math.max(0, Math.min(1, (en.p - prevEnd) / Math.max(0.001, shots[idx].end - prevEnd)));
    const tgt = shots[idx].cam(E, SZ, u);
    const cam = this.camera?.cam;
    if (!cam) return;
    const tp = this._camTarget.set(tgt.pos[0], tgt.pos[1], tgt.pos[2]);
    const tl = new THREE.Vector3(tgt.look[0], tgt.look[1], tgt.look[2]);
    if (idx !== this._shot) {            // hard cut
      this._shot = idx;
      cam.position.copy(tp); this._look.copy(tl);
    } else {                             // smooth dolly within a shot
      cam.position.lerp(tp, Math.min(1, dt * 3));
      this._look.lerp(tl, Math.min(1, dt * 6));
    }
    // camera shake (Ajan stomps, big pops)
    this._shake = Math.max(0, (this._shake || 0) - dt * 2);
    if (this._shake > 0.001) {
      const s = this._shake * this._shake * 0.4;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this._look);
    if (this.camera.pos) this.camera.pos.copy(cam.position);
    if (this.camera.focus) this.camera.focus.copy(this._look);
  }

  /** A handheld entrance prop: Ajan's food or Rize's cigarette. */
  spawnHandProp(kind) {
    let mesh;
    if (kind === 'food') {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0x9a5a2a, roughness: 0.8 }));
    } else {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 6), new THREE.MeshStandardMaterial({ color: 0xf4f0e4 }));
      stick.rotation.z = Math.PI / 2; g.add(stick);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff5a1e }));
      ember.position.x = 0.07; g.add(ember); mesh = g;
    }
    mesh.frustumCulled = false; this.scene.add(mesh);
    this._handProp = { kind, mesh, eaten: false };
  }
  clearHandProp() {
    if (!this._handProp) return;
    try { this.scene.remove(this._handProp.mesh); } catch { /* ignore */ }
    this._handProp = null;
  }
  updateHandProp(f, charId, p) {
    const hp = this._handProp; if (!hp) return;
    const h = (f.c?.height || 1.8);
    const fw = { x: Math.sin(f.yaw), z: Math.cos(f.yaw) };
    if (hp.kind === 'food') {
      // eat it mid-walk: food leaves the hand (munch burst), reappears once in the ring
      if (!hp.eaten && p > 0.45 && p < 0.86) {
        hp.eaten = true; hp.mesh.visible = false;
        this.effects?.burst({ x: f.x, y: f.y + h * 0.85, z: f.z }, { n: 16, speed: 1.6, color: [0.95, 0.5, 0.15], size: 0.06, life: 0.8, grav: 1.4 });
        this.audio?.play?.('grunt', { x: f.x, y: f.y + 1.4, z: f.z }, { pitch: 0.8 });
      }
      if (hp.eaten && p >= 0.9) hp.mesh.visible = true; // back in the ring, food's back in hand
      // hold it up near the mouth/hand
      hp.mesh.position.set(f.x + fw.x * 0.28, f.y + h * 0.72, f.z + fw.z * 0.28);
    } else {
      // cigarette at the mouth, occasional smoke puff
      hp.mesh.position.set(f.x + fw.x * 0.22, f.y + h * 0.86, f.z + fw.z * 0.22);
      hp.mesh.rotation.y = f.yaw;
      if (Math.random() < 0.06) this.effects?.burst({ x: f.x + fw.x * 0.3, y: f.y + h * 0.9, z: f.z + fw.z * 0.3 }, { n: 3, speed: 0.4, color: [0.7, 0.7, 0.72], size: 0.07, life: 1.3, additive: false, grav: -0.4, up: 1.2 });
    }
  }

  /**
   * Flames jetting up the SIDES of the walkway as the wrestler walks out –
   * a line of fire either side of the aisle, erupting around where they are.
   */
  sideFire(f, p, dt) {
    if (!this.effects) return;
    if (p < 0.08 || p > 0.92) return;              // only while they're on the stage/aisle
    this._sideFireT = (this._sideFireT || 0) + dt;
    if (this._sideFireT < 0.05) return;            // pulse ~20x/sec for a continuous blaze
    this._sideFireT = 0;
    const halfX = ARENA.entrance.halfX + 0.35;     // just outside the aisle edges
    const wz = f.z;                                // flames bracket the walker
    const zs = [wz + 2.0, wz + 0.9, wz, wz - 0.9, wz - 2.0];  // a longer line of fire down the aisle
    const flick = 0.8 + Math.random() * 0.6;       // flicker the intensity
    for (const s of [-1, 1]) {
      for (const z of zs) {
        if (z < ARENA.ring.apronHalf - 0.5) continue; // don't spew fire inside the ring
        const base = { x: s * halfX, y: 0.1, z };
        // tall roaring body – deep orange, rising fast (realistic jet of flame)
        this.effects.burst(base, { n: 16, speed: 1.6, color: [1, 0.42 + Math.random() * 0.3, 0.05], size: 0.22 * flick, life: 0.7, additive: true, grav: -4.2, up: 9 * flick });
        // bright yellow-white core at the base
        this.effects.burst({ x: base.x, y: 0.1, z }, { n: 8, speed: 1.1, color: [1, 0.9, 0.5], size: 0.14, life: 0.4, additive: true, grav: -3.0, up: 6 });
        // dark smoke curling up above the flame
        this.effects.burst({ x: base.x, y: 0.6, z }, { n: 5, speed: 0.7, color: [0.18, 0.16, 0.15], size: 0.3, life: 1.2, additive: false, grav: -0.5, up: 2.6 });
        // orange embers drifting
        if (Math.random() < 0.5) this.effects.burst({ x: base.x, y: 0.4, z }, { n: 3, speed: 2.2, color: [1, 0.6, 0.2], size: 0.05, life: 1.1, additive: true, grav: -1.2, up: 4 });
      }
    }
    if (Math.random() < 0.18) this.audio.play?.('whoosh', { x: 0, y: 0.5, z: wz }, { volume: 0.6 });
  }

  /** Fire jets (pyro) at the ring + stage – replaces confetti for entrances. */
  pyro() {
    if (!this.effects) { this.audio.crowdPop?.(0.8); return; }
    const R = ARENA.ring;
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(([sx, sz], i) => setTimeout(() => {
      const p = new THREE.Vector3(sx * R.postInset, R.height + R.postHeight, sz * R.postInset);
      for (let k = 0; k < 5; k++) {
        this.effects.burst(p, { n: 26, speed: 3 + k, color: [1, 0.55 + Math.random() * 0.3, 0.1], size: 0.14, life: 0.8, grav: -2.2, up: 7 });
      }
      this.audio.play?.('whoosh', p, { volume: 1.2 });
    }, i * 90));
    this.audio.crowdPop?.(1.1);
  }

  /** Max tears off his coat, hat and glasses and hurls them to the crowd. */
  throwCoat(f) {
    const mk = (geo, color, vx, vy, vz) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.1 }));
      m.position.set(f.x, (f.y || 0) + 1.4, f.z);
      m.castShadow = false;
      this.scene.add(m);
      this._props.push({ mesh: m, vx, vy, vz, spin: (Math.random() - 0.5) * 12, life: 2.2 });
    };
    // toward the crowd (back toward the entrance / stands) with upward arc + spread
    mk(new THREE.BoxGeometry(0.55, 0.7, 0.12), 0x15161c, (Math.random() - 0.5) * 2, 6.2, 4.6);   // coat
    mk(new THREE.CylinderGeometry(0.17, 0.2, 0.14, 12), 0x0a0a0d, 1.6, 6.8, 3.4);                  // hat
    mk(new THREE.BoxGeometry(0.3, 0.06, 0.06), 0x050507, -1.8, 6.0, 3.0);                          // glasses
    this.audio.crowdPop?.(1.4);       // the crowd (the "screams") erupts
    this.camera.punch?.(5);
  }

  updateProps(dt) {
    if (!this._props.length) return;
    for (const p of this._props) {
      p.life -= dt;
      p.vy -= 16 * dt; // gravity
      p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.6 * dt;
    }
    this._props = this._props.filter((p) => {
      if (p.life > 0 && p.mesh.position.y > -2) return true;
      this.scene.remove(p.mesh); p.mesh.geometry.dispose?.(); p.mesh.material.dispose?.();
      return false;
    });
  }

  voteSkip(view) {
    const now = performance.now();
    if (now - (this._lastVote || 0) < 250) return; // debounce one key-repeat
    this._lastVote = now;
    const session = this.getSession?.();
    if (!session) return;
    if (session.online) this.getNet?.()?.send({ t: 'skipEntrance' });
    else session.world?.match?.voteSkipEntrance(view.localId);
  }

  startMedia(charId) {
    if (!charId) return;
    const cfg = getEntrance(charId);
    // song (plays once; the video loops under it until it ends)
    try { this._song?.stop?.(); } catch { /* ignore */ }
    this._song = this.audio.playEntranceSong?.(assetUrl(cfg.song)) || null;
    // video on the titantron
    try {
      if (!this.video) {
        const v = document.createElement('video');
        v.muted = true; v.loop = !!cfg.loopVideo; v.playsInline = true; v.crossOrigin = 'anonymous';
        v.style.display = 'none'; document.body.appendChild(v);
        this.video = v;
      }
      this.video.loop = !!cfg.loopVideo;
      this.video.src = assetUrl(cfg.video);
      this.video.currentTime = 0;
      this.video.play().catch(() => { /* autoplay may defer; drawTron copes */ });
    } catch { /* no DOM video (headless) – titantron falls back to text */ }
  }

  drawTron(charId, en) {
    const tron = this.arena?.tron; if (!tron) return;
    const { ctx: x, canvas: c, texture } = tron;
    const W = c.width, H = c.height;
    try {
      const v = this.video;
      if (v && v.readyState >= 2 && v.videoWidth) {
        // cover-fit the clip
        const vr = v.videoWidth / v.videoHeight, cr = W / H;
        let dw = W, dh = H, dx = 0, dy = 0;
        if (vr > cr) { dh = H; dw = H * vr; dx = (W - dw) / 2; } else { dw = W; dh = W / vr; dy = (H - dh) / 2; }
        x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
        x.drawImage(v, dx, dy, dw, dh);
      } else {
        const g = x.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#120018'); g.addColorStop(1, '#03040a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      }
      // nameplate
      const cfg = charId ? getEntrance(charId) : null;
      if (cfg) {
        x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(0, H - 150, W, 150);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = 'bold 96px Impact, Arial Black, sans-serif'; x.fillStyle = '#ffd24a';
        x.fillText(getCharacter(charId).name, W / 2, H - 95);
        x.font = 'bold 40px Arial, sans-serif'; x.fillStyle = '#fff';
        x.fillText(`${cfg.country} · ${cfg.weight} LBS`, W / 2, H - 38);
      }
      texture.needsUpdate = true;
    } catch { /* drawImage can throw before the first decoded frame */ }
  }

  /**
   * Winner celebration media: the champ's song + video on the titantron, both
   * LOOPING for as long as the celebration runs (stopped by stopWinner()).
   */
  startWinner(charId) {
    if (!charId) return;
    this._winner = charId;
    this.screens.suspended = true;        // we own the titantron again
    const cfg = getEntrance(charId);
    try { this._song?.stop?.(); } catch { /* ignore */ }
    this._song = this.audio.playEntranceSong?.(assetUrl(cfg.song), { loop: true }) || null;
    try {
      if (!this.video) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
        v.style.display = 'none'; document.body.appendChild(v);
        this.video = v;
      }
      this.video.loop = true;             // always loop for the celebration
      this.video.src = assetUrl(cfg.video);
      this.video.currentTime = 0;
      this.video.play().catch(() => { /* headless: drawTron falls back to text */ });
    } catch { /* no DOM video */ }
  }

  /** Draw the looping winner clip + a WINNER nameplate on the titantron. */
  drawWinner() {
    if (!this._winner) return;
    const tron = this.arena?.tron; if (!tron) return;
    this.drawTron(this._winner, null);
    const { ctx: x, canvas: c, texture } = tron;
    const W = c.width;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 16, W, 96);
    x.font = 'bold 76px Impact, Arial Black, sans-serif'; x.fillStyle = '#ffd24a';
    x.fillText('★ WINNER ★', W / 2, 64);
    texture.needsUpdate = true;
  }

  stopWinner() {
    if (!this._winner) return;
    this._winner = null;
    this.screens.suspended = false;
    try { this._song?.stop?.(); } catch { /* ignore */ }
    this._song = null;
    try { this.video?.pause?.(); if (this.video) this.video.src = ''; } catch { /* ignore */ }
  }

  /** Called when the entrance phase ends (or the match tears down). */
  stop() {
    if (!this.active && !this._song && !this.video && !this._winner) return;
    this.active = false; this._winner = null;
    this.screens.suspended = false;
    this.clearHandProp();
    this._mediaFor = null; this._announced = false; this._coatThrown = false; this._firedEntry = false; this._shot = -1;
    if (this._swapped != null && this.assets) { const v = this.views.get(this._swapped); if (v) v.swapModel(this.assets, v.charId); this._swapped = null; }
    for (const p of this._props) { try { this.scene.remove(p.mesh); p.mesh.geometry.dispose?.(); p.mesh.material.dispose?.(); } catch { /* ignore */ } }
    this._props = [];
    try { this._song?.stop?.(); } catch { /* ignore */ }
    this._song = null;
    try { this.video?.pause?.(); if (this.video) this.video.src = ''; } catch { /* ignore */ }
    for (const v of this.views.values()) { if (v.root) v.root.visible = true; }
  }

  dispose() {
    this.stop();
    try { this.video?.remove?.(); } catch { /* ignore */ }
    this.video = null;
  }
}
