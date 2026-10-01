// MatchSystem – game-mode rules: phases, pinfalls (with referee count),
// knockouts/eliminations, tag teams, timer and win conditions. Also drives
// the referee NPC (simulated so every client sees the same count).
import { ARENA } from '../config/arena.js';
import { S, ZONE, DOWN_STATES } from './constants.js';
import { setState, dist2D, isAlive, hpFrac, angleTo, turnToward } from './Fighter.js';

const R = ARENA.ring;
const INTRO_TIME = 3.2, FINISH_TIME = 7.5, COUNT_INTERVAL = 0.85;

export class MatchSystem {
  constructor(world) {
    this.world = world;
    this.phase = 'intro';
    this.phaseTime = 0;
    this.timeLeft = world.rules.timeLimit;
    this.pin = null;
    this.winnerTeam = null; this.winners = []; this.method = null;
    this.elimOrder = [];
    this.referee = { x: 0, y: R.height, z: -1.5, yaw: 0, zone: ZONE.RING, state: 'watch', count: 0, t: 0, focus: null };
  }

  // ── setup ──
  setupFighters() {
    const w = this.world, rules = w.rules;
    const fighters = w.fighters;
    if (rules.tag) {
      const teams = [0, 1].map((t) => fighters.filter((f) => f.team === t));
      teams.forEach((members, t) => {
        const [cx, cz] = ARENA.tagCorners[t];
        members.forEach((f, i) => {
          if (i === 0) { f.x = cx * 2.2; f.z = cz * 2.2; f.zone = ZONE.RING; f.y = R.height; f.legal = true; }
          else { this.placeOnApron(f, cx, cz, i); f.legal = false; }
          f.yaw = Math.atan2(-f.x, -f.z);
        });
      });
    } else {
      fighters.forEach((f, i) => {
        const [x, z] = ARENA.spawnsRing[i % ARENA.spawnsRing.length];
        f.x = x; f.z = z; f.zone = ZONE.RING; f.y = R.height; f.yaw = Math.atan2(-x, -z); f.legal = true;
      });
    }
  }

  placeOnApron(f, cx, cz, i = 1) {
    const d = R.ropeLine + 0.35;
    // stand on the apron just beside the team's corner post
    if (i % 2) { f.x = cx * d; f.z = cz * (R.postInset - 0.75); } else { f.x = cx * (R.postInset - 0.75); f.z = cz * d; }
    f.y = R.height; f.zone = ZONE.APRON; setState(f, S.APRON); f.legal = false;
    f.yaw = Math.atan2(-f.x, -f.z);
  }

  frozen(f) {
    if (this.phase === 'intro') return true;
    if (this.phase === 'finished' || this.phase === 'over') return f.state !== S.CELEBRATE && f.state !== S.AIRBORNE && f.state !== S.KNOCKDOWN;
    return false;
  }

  // ── per-tick ──
  update(dt) {
    const w = this.world;
    this.phaseTime += dt;
    if (this.phase === 'intro') {
      if (this.phaseTime >= INTRO_TIME) { this.phase = 'live'; this.phaseTime = 0; w.emit('bell', {}); w.emit('match_start', { mode: w.rules.id }); }
    } else if (this.phase === 'live') {
      this.timeLeft -= dt;
      this.updatePin(dt);
      this.cleanupEliminated();
      if (this.timeLeft <= 0) this.timeUp();
      else this.checkWin();
    } else if (this.phase === 'finished') {
      if (this.phaseTime > 1.2) for (const f of w.fighters) {
        if (this.winners.includes(f.id) && (f.state === S.IDLE || f.state === S.MOVE)) setState(f, S.CELEBRATE);
      }
      if (this.phaseTime > FINISH_TIME) { this.phase = 'over'; this.phaseTime = 0; w.emit('match_over', { winnerTeam: this.winnerTeam }); }
    }
    this.updateReferee(dt);
  }

  // ── pins ──
  pinCandidate(f) {
    if (this.phase !== 'live' || this.pin) return null;
    const w = this.world;
    if (w.rules.pinsInRingOnly && f.zone !== ZONE.RING) return null;
    let best = null, bd = 1.3 + f.c.radius;
    for (const v of w.fighters) {
      if (!w.combat.enemies(f, v) || v.zone !== f.zone || !isAlive(v)) continue;
      if (v.state !== S.DOWN && !(v.state === S.KNOCKDOWN && v.stateTime > 0.3)) continue;
      const d = dist2D(f, v);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  startPin(f, v) {
    const w = this.world;
    setState(f, S.PIN); setState(v, S.PINNED);
    // pinner lies across the victim's chest
    const side = Math.atan2(f.x - v.x, f.z - v.z);
    f.x = v.x + Math.sin(side) * 0.35; f.z = v.z + Math.cos(side) * 0.35;
    f.yaw = v.yaw + Math.PI / 2; f.vx = f.vz = v.vx = v.vz = 0;
    v.mash = 0;
    const need = Math.ceil(2 + 13 * Math.pow(1 - hpFrac(v), 1.35));
    this.pin = { pinner: f.id, victim: v.id, count: 0, t: 0, counting: false, need };
    w.emit('pin_start', { fighter: f.id, victim: v.id });
  }

  endPin(kickout) {
    const w = this.world, p = this.pin; if (!p) return;
    this.pin = null;
    const f = w.byId(p.pinner), v = w.byId(p.victim);
    if (f && f.state === S.PIN) { setState(f, kickout ? S.HITSTUN : S.IDLE, kickout ? 0.5 : 0); if (kickout) f.sub = 1; }
    if (v && v.state === S.PINNED) { setState(v, S.DOWN); v.downTimer = kickout ? 0.25 : 0.6; }
    this.referee.state = 'watch'; this.referee.count = 0;
    if (kickout) w.emit('kickout', { fighter: p.victim, pinner: p.pinner, count: p.count });
    else w.emit('pin_broken', { victim: p.victim });
  }

  onFighterHit(v) {
    const p = this.pin;
    if (p && (p.pinner === v.id || p.victim === v.id)) this.endPin(false);
  }

  updatePin(dt) {
    const p = this.pin; if (!p) return;
    const w = this.world;
    const f = w.byId(p.pinner), v = w.byId(p.victim);
    if (!f || !v || f.state !== S.PIN || v.state !== S.PINNED) { this.endPin(false); return; }
    p.t += dt;
    const ref = this.referee;
    if (!p.counting) {
      if (dist2D(ref, v) < 1.4 || p.t > 1.1) { p.counting = true; p.next = COUNT_INTERVAL * 0.6; ref.state = 'count'; ref.count = 0; }
      return;
    }
    if (v.mash >= p.need) { this.endPin(true); return; }
    p.next -= dt;
    if (p.next <= 0) {
      p.count++; ref.count = p.count; ref.t = 0; p.next = COUNT_INTERVAL;
      w.emit('pin_count', { count: p.count, pinner: f.id, victim: v.id });
      if (p.count >= 3) {
        this.pin = null;
        setState(f, S.IDLE);
        w.emit('pinfall', { fighter: f.id, victim: v.id });
        this.resolveLoss(v, f, 'pinfall');
      }
    }
  }

  // ── tag teams ──
  tryTag(f) {
    const w = this.world;
    if (!w.rules.tag || !f.legal || f.zone !== ZONE.RING || this.phase !== 'live') return false;
    const [cx, cz] = ARENA.tagCorners[f.team] || [0, 0];
    const post = { x: cx * R.postInset, z: cz * R.postInset };
    if (Math.hypot(f.x - post.x, f.z - post.z) > 1.6) return false;
    const partner = w.fighters.find((o) => o.team === f.team && o !== f && o.state === S.APRON && isAlive(o));
    if (!partner) return false;
    // swap roles
    f.legal = false; partner.legal = true;
    w.controller.startClimb(partner, 'enter');
    setState(f, S.CLIMB, 0.7); f.sub = 5;
    const d = R.ropeLine + 0.35;
    f.path = { x0: f.x, y0: f.y, z0: f.z, x1: partner.x, y1: R.height, z1: partner.z, zone: ZONE.APRON, kind: 'to_apron' };
    if (Math.abs(partner.x) < 0.1 && Math.abs(partner.z) < 0.1) { f.path.x1 = cx * d; f.path.z1 = cz * (R.postInset - 0.75); }
    w.emit('tag', { fighter: f.id, partner: partner.id });
    return true;
  }

  // ── KO / elimination / wins ──
  onKO(v, by) {
    if (this.phase !== 'live') return;
    this.resolveLoss(v, by, 'ko');
  }

  resolveLoss(v, by, method) {
    const w = this.world;
    const teamOf = (f) => f.team;
    // pinfall in a team match or singles ends it immediately
    const ffa = w.rules.eliminations;
    if (!ffa && (method === 'pinfall' || w.rules.tag)) {
      this.finish(by ? teamOf(by) : this.otherTeam(v.team), method, { loser: v.id, by: by?.id ?? null });
      return;
    }
    // eliminate and see who's left
    v.eliminated = true; v.elimAt = w.time;
    if (v.state !== S.KO && method === 'pinfall') { setState(v, S.KO); }
    this.elimOrder.push(v.id);
    w.emit('elimination', { fighter: v.id, by: by?.id ?? null, method });
    this.checkWin(method, by);
  }

  otherTeam(t) {
    const o = this.world.fighters.find((f) => f.team !== t && !f.eliminated);
    return o ? o.team : null;
  }

  cleanupEliminated() {
    const w = this.world;
    for (const f of w.fighters) {
      if (f.eliminated && !f.hidden && w.time - f.elimAt > 3.5 && w.fighters.filter((o) => !o.eliminated).length > 1) {
        // helped out of the ring by officials
        f.hidden = true; f.x = 0; f.z = ARENA.entrance.zEnd + 5; f.y = 0; f.zone = ZONE.FLOOR;
        w.grapple.breakFor(f);
        if (f.item != null) w.items.drop(f);
      }
    }
  }

  checkWin(method = 'ko', by = null) {
    if (this.phase !== 'live') return;
    const w = this.world;
    const aliveTeams = new Set(w.fighters.filter((f) => !f.eliminated && f.state !== S.KO).map((f) => f.team));
    if (aliveTeams.size <= 1) {
      const team = aliveTeams.size ? [...aliveTeams][0] : (by ? by.team : null);
      this.finish(team, method, { by: by?.id ?? null });
    }
  }

  timeUp() {
    const w = this.world;
    const score = new Map();
    for (const f of w.fighters) if (!f.eliminated) score.set(f.team, (score.get(f.team) || 0) + hpFrac(f));
    let best = null, bs = -1;
    for (const [t, s] of score) if (s > bs) { bs = s; best = t; }
    w.emit('time_up', {});
    this.finish(best, 'decision', {});
  }

  finish(team, method, detail) {
    const w = this.world;
    if (this.phase !== 'live') return;
    this.phase = 'finished'; this.phaseTime = 0;
    this.winnerTeam = team; this.method = method;
    this.winners = w.fighters.filter((f) => f.team === team && !f.eliminated).map((f) => f.id);
    if (!this.winners.length) this.winners = w.fighters.filter((f) => f.team === team).map((f) => f.id);
    if (this.pin) this.endPin(false);
    w.emit('bell', { ending: true });
    w.emit('match_end', { winnerTeam: team, winners: this.winners, method, ...detail });
  }

  // ── referee ──
  updateReferee(dt) {
    const w = this.world, ref = this.referee;
    ref.t += dt;
    let tx = ref.x, tz = ref.z, speed = 2.4, face = null;
    if (this.pin) {
      const v = w.byId(this.pin.victim);
      if (v) {
        const side = { x: v.x + Math.cos(v.yaw) * 0.9, z: v.z - Math.sin(v.yaw) * 0.9 };
        tx = side.x; tz = side.z; speed = 6.5; face = v;
        ref.targetZone = v.zone;
        if (!this.pin.counting) ref.state = 'slide';
      }
    } else if (this.phase === 'finished' || this.phase === 'over') {
      const winner = w.byId(this.winners[0]);
      if (winner && winner.zone === ZONE.RING) { tx = winner.x + 0.8; tz = winner.z + 0.2; face = winner; ref.targetZone = ZONE.RING; }
      ref.state = this.phaseTime > 1.2 ? 'raise' : 'signal';
    } else {
      // follow the action from a sensible distance, inside the ring
      const act = w.fighters.filter((f) => isAlive(f) && !f.hidden && f.state !== S.APRON);
      if (act.length) {
        let mx = 0, mz = 0; for (const f of act) { mx += f.x; mz += f.z; } mx /= act.length; mz /= act.length;
        const dx = ref.x - mx, dz = ref.z - mz, d = Math.hypot(dx, dz) || 1;
        tx = mx + dx / d * 2.4; tz = mz + dz / d * 2.4;
        face = { x: mx, z: mz };
      }
      ref.targetZone = ZONE.RING;
      if (ref.state !== 'signal' || ref.t > 1.5) ref.state = 'watch';
    }
    if (ref.targetZone === ZONE.RING) {
      const lim = R.ropeLine - 0.45;
      tx = Math.max(-lim, Math.min(lim, tx)); tz = Math.max(-lim, Math.min(lim, tz));
    } else if (w.arena.isInsideRingSquare(tx, tz, 0.3)) {
      const out = R.apronHalf + 0.5;
      if (Math.abs(tx) > Math.abs(tz)) tx = Math.sign(tx) * out; else tz = Math.sign(tz) * out;
    }
    // keep out of fighters' way
    for (const f of w.fighters) {
      if (f.hidden) continue;
      const d = Math.hypot(tx - f.x, tz - f.z);
      if (d < 1.1 && !this.pin) { tx += (tx - f.x) / (d || 1) * 0.6; tz += (tz - f.z) / (d || 1) * 0.6; }
    }
    const dx = tx - ref.x, dz = tz - ref.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (d > 0.05) { ref.x += dx / d * step; ref.z += dz / d * step; }
    ref.moving = d > 0.15;
    // height follows zone surface
    const inSq = w.arena.isInsideRingSquare(ref.x, ref.z);
    ref.zone = inSq ? ZONE.RING : ZONE.FLOOR;
    const gy = inSq ? R.height : 0;
    ref.y += (gy - ref.y) * Math.min(1, dt * 6);
    if (face) ref.yaw = Math.atan2(face.x - ref.x, face.z - ref.z);
    else if (d > 0.1) ref.yaw = Math.atan2(dx, dz);
  }
}
