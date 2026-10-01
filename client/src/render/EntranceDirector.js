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
  constructor({ scene, camera, audio, arena, screens, commentary, ui, views }) {
    this.scene = scene; this.camera = camera; this.audio = audio; this.arena = arena;
    this.screens = screens; this.commentary = commentary; this.ui = ui; this.views = views;
    this.t = 0;
    this.active = false;
    this._mediaFor = null;      // fighter id whose media is playing
    this._announced = false;
    this._coatThrown = false;   // Max's coat/hat/glasses toss done this entrance
    this._props = [];           // flying entrance props (coat etc.)
    this._song = null;
    this.video = null;
    this.getSession = null;     // set by Game: () => current session
    this.getNet = null;         // set by Game: () => net client (online)
  }

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
    }
  }

  placeWalk(f, p, dt) {
    const spawnX = f._spawnX ?? (f._spawnX = f.x);
    const spawnZ = f._spawnZ ?? (f._spawnZ = f.z);
    const ringH = ARENA.ring.height;
    let x, y, z, walking = false;
    if (p < 0.12) {                 // reveal / pose on the stage
      x = 0; z = STAGE_Z; y = 0;
    } else if (p < 0.72) {          // walk down the ramp toward the ring
      const u = (p - 0.12) / 0.6; x = spawnX * 0.35 * u; z = STAGE_Z + (APPROACH_Z - STAGE_Z) * u; y = 0; walking = true;
    } else if (p < 0.9) {           // climb into the ring
      const u = (p - 0.72) / 0.18; x = spawnX * 0.35 + (spawnX - spawnX * 0.35) * u; z = APPROACH_Z + (spawnZ - APPROACH_Z) * u; y = ringH * u; walking = true;
    } else {                        // settle at the ring spawn, final pose
      x = spawnX; z = spawnZ; y = ringH;
    }
    f.x = x; f.y = y; f.z = z; f.yaw = Math.atan2(-x, -z);
    f.state = walking ? 'move' : 'idle';
    f.runTime = (f.runTime || 0) + (walking ? dt : 0);
    f.vx = 0; f.vz = 0;
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
      this._mediaFor = en.fighterId; this._announced = false; this._coatThrown = false;
    }
    this.drawTron(charId, en);

    // Max flings his coat/hat/glasses into the crowd mid-ramp
    if (charId && !this._coatThrown && en.p > 0.5 && getEntrance(charId).coatThrow && f) {
      this._coatThrown = true;
      this.throwCoat(f);
    }
    this.updateProps(dt);

    // ring announcer introduces the wrestler as they reach the ring
    if (!this._announced && en.p > 0.8 && charId) {
      this._announced = true;
      this.commentary.announce(entranceIntroLine(charId));
      this.audio.crowdPop?.(1.2);
    }

    // camera: frame the entrant, drifting the angle for variety + a hero shot at the ring
    if (f) {
      const ang = 0.55 + Math.sin(this.t * 0.35) * 0.45 + (en.p > 0.8 ? 0.7 : 0);
      this.camera.update(dt, { menu: { kind: 'showcase', subject: { x: f.x, y: f.y, z: f.z, height: f.c?.height || 1.9 }, angle: ang } });
    }

    // skip prompt + vote tally
    this.ui.prompt?.(`PRESS J TO SKIP   ·   SKIP VOTES ${en.votes}/${Math.max(1, en.need)}`);
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

  /** Called when the entrance phase ends (or the match tears down). */
  stop() {
    if (!this.active && !this._song && !this.video) return;
    this.active = false;
    this.screens.suspended = false;
    this._mediaFor = null; this._announced = false; this._coatThrown = false;
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
