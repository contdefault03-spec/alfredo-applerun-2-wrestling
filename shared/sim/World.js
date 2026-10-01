// World – the authoritative game simulation. Runs on the server for online
// matches and inside the browser for single-player (same code, same rules).
import { GAME_MODES } from '../config/gameModes.js';
import { Arena } from './Arena.js';
import { createFighter, isAlive } from './Fighter.js';
import { FighterController } from './FighterController.js';
import { CombatSystem } from './CombatSystem.js';
import { GrappleSystem } from './GrappleSystem.js';
import { ItemSystem } from './ItemSystem.js';
import { AbilitySystem } from './AbilitySystem.js';
import { MatchSystem } from './MatchSystem.js';
import { RingDestruction } from './RingDestruction.js';
import { AISystem } from './AISystem.js';
import { S, DT, HEAL_DELAY, HEAL_RATE } from './constants.js';

export class World {
  /**
   * @param {object} cfg
   *   mode: game mode id
   *   fighters: [{ charId, team, name, isAI, difficulty, ownerId }]
   */
  constructor(cfg) {
    const mode = GAME_MODES[cfg.mode] || GAME_MODES.normal;
    this.rules = { ...mode, friendlyFire: false, entrances: !!cfg.entrances, ...(cfg.rules || {}) };
    this.time = 0; this.tick = 0;
    this.events = [];
    this.arena = new Arena({ cage: !!this.rules.cage });
    this.combat = new CombatSystem(this);
    this.grapple = new GrappleSystem(this);
    this.items = new ItemSystem(this);
    this.abilities = new AbilitySystem(this);
    this.controller = new FighterController(this);
    this.ai = new AISystem(this);
    this.fighters = (cfg.fighters || []).map((fc, i) => createFighter({ id: i + 1, ...fc }));
    this.match = new MatchSystem(this);
    this.ring = new RingDestruction(this);
    this.match.setupFighters();
    if (this.rules.items) this.items.spawnSet(this.rules.items);
    this._byId = new Map(this.fighters.map((f) => [f.id, f]));
  }

  byId(id) { return this._byId.get(id) || null; }

  emit(type, data = {}) { this.events.push({ t: this.time, ...data, type }); }

  /** Drain queued events (consumer: renderer, audio, commentary, network). */
  takeEvents() { const e = this.events; this.events = []; return e; }

  step(dt = DT) {
    this.time += dt; this.tick++;
    this.ai.update(dt);
    for (const f of this.fighters) if (!f.hidden && !f.underRing) this.controller.update(f, dt);
    this.separate();
    this.combat.update();
    this.items.update(dt);
    this.match.update(dt);
    this.ring.update(dt);
    this.regen(dt);
  }

  /** Out-of-combat health regeneration (live phase only). */
  regen(dt) {
    if (this.match.phase !== 'live') return;
    for (const f of this.fighters) {
      if (f.hidden || f.eliminated || f.state === S.KO) continue;
      if (f.hp >= f.maxHp) continue;
      if (this.time - f.lastHitTime < HEAL_DELAY) continue;
      f.hp = Math.min(f.maxHp, f.hp + f.maxHp * HEAL_RATE * dt);
    }
  }

  /** Push overlapping standing bodies apart (mass-weighted). */
  separate() {
    const F = this.fighters;
    for (let i = 0; i < F.length; i++) {
      const a = F[i]; if (!this.solid(a)) continue;
      for (let j = i + 1; j < F.length; j++) {
        const b = F[j]; if (!this.solid(b) || a.zone !== b.zone) continue;
        if (Math.abs(a.y - b.y) > 1.2) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        const min = (a.c.radius + b.c.radius) * 0.92;
        if (d >= min || d < 1e-5) continue;
        const push = min - d, nx = dx / d, nz = dz / d;
        const wa = b.c.weight / (a.c.weight + b.c.weight), wb = 1 - wa;
        a.x -= nx * push * wa; a.z -= nz * push * wa;
        b.x += nx * push * wb; b.z += nz * push * wb;
      }
    }
  }

  solid(f) {
    return !f.hidden && !f.eliminated && ![S.HELD, S.GRAPPLE_VICTIM, S.GRAPPLE_MOVE, S.HOLD, S.DOWN, S.KNOCKDOWN, S.PINNED, S.PIN, S.KO, S.CLIMB,
      S.PERCH, S.DIVE, S.APRON, S.CAGE_CLIMB, S.SPECIAL, S.THROWING].includes(f.state) && f.onGround;
  }

  aliveCount() { return this.fighters.filter(isAlive).length; }
}
