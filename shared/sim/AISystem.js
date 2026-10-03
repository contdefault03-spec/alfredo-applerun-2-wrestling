// AISystem – AI wrestlers. Each AI runs a small state machine and "presses
// buttons" through the same input struct players use, so every mechanic is
// shared. States: idle, search, chase, attack, defend, dodge, grapple,
// recover, getItem, flee, pin, climb, special, taunt (+ target switching).
import { AI_DIFFICULTY, personalityOf } from '../config/ai.js';
import { ATTACKS } from '../config/attacks.js';
import { ARENA } from '../config/arena.js';
import { BTN, S, ZONE, DOWN_STATES, FREE_STATES } from './constants.js';
import { dist2D, forwardOf, isAlive, hpFrac, wrapAngle, angleTo } from './Fighter.js';

const R = ARENA.ring;
const rand = Math.random;

export class AISystem {
  constructor(world) { this.world = world; }

  brain(f) {
    if (!f.aiState) {
      f.aiState = {
        mode: 'idle', t: 0, think: 0, target: null, retarget: 0, pending: [], strafe: rand() < 0.5 ? 1 : -1,
        strafeT: 0, mashT: 0, reactT: 0, lastSeenAttack: null, goal: null, cfg: AI_DIFFICULTY[f.difficulty] || AI_DIFFICULTY.normal,
        tagWant: 0, pers: personalityOf(f.charId), aggro: 1, regroupUntil: 0, itemUntil: 0,
      };
    }
    return f.aiState;
  }

  update(dt) {
    for (const f of this.world.fighters) if (f.isAI && !f.eliminated && !f.hidden) this.think(f, dt);
  }

  press(f, bits) { f.input.pressed |= bits; }
  hold(f, bits) { f.input.held |= bits; }

  moveToward(f, x, z, run = false) {
    const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
    if (d < 0.05) { f.input.mx = f.input.mz = 0; return d; }
    f.input.mx = dx / d; f.input.mz = dz / d;
    if (run) f.input.held |= BTN.RUN;
    return d;
  }

  chooseTarget(f, b) {
    const w = this.world;
    let best = null, bs = 1e9;
    for (const o of w.fighters) {
      if (!w.combat.enemies(f, o) || !isAlive(o) || o.hidden) continue;
      let s = dist2D(f, o);
      if (o.zone !== f.zone) s += 3;
      s -= (1 - hpFrac(o)) * 2.5;               // finish off the weak
      if (o.target === f.id) s -= 1.5;          // fight whoever is fighting me
      if (!o.isAI) s -= 0.8;                    // slight preference for players
      if (o.id === b.target) s -= 1.2;          // stickiness
      if (s < bs) { bs = s; best = o; }
    }
    const prev = b.target;
    b.target = best ? best.id : null;
    if (prev != null && b.target !== prev) this.world.emit('ai_retarget', { fighter: f.id, target: b.target });
    return best;
  }

  /** Path helper: go around the ring post / climb in / roll out as needed. */
  navigate(f, tx, tz, tzone, run) {
    const w = this.world, a = w.arena;
    if (f.zone === ZONE.RING && tzone === ZONE.FLOOR) {
      // leave the ring toward the target side
      const gap = a.ropeGap(f.x, f.z);
      if (gap < 0.8) { this.press(f, BTN.INTERACT); return 'exit'; }
      const lim = R.ropeLine - 0.4;
      const ex = Math.abs(tx) > Math.abs(tz) ? Math.sign(tx) * lim : Math.max(-lim + 0.8, Math.min(lim - 0.8, tx));
      const ez = Math.abs(tx) > Math.abs(tz) ? Math.max(-lim + 0.8, Math.min(lim - 0.8, tz)) : Math.sign(tz) * lim;
      this.moveToward(f, ex, ez, run); return 'toRopes';
    }
    if (f.zone === ZONE.FLOOR && tzone === ZONE.RING) {
      if (a.apronEdgeDist(f.x, f.z) < 0.8 + f.c.radius) { this.press(f, BTN.INTERACT); return 'climb'; }
      // nearest point on the apron edge (avoid corners)
      const lim = R.apronHalf - 0.8;
      let px, pz;
      if (Math.abs(f.x) > Math.abs(f.z)) { px = Math.sign(f.x) * (R.apronHalf + f.c.radius + 0.2); pz = Math.max(-lim, Math.min(lim, f.z)); }
      else { pz = Math.sign(f.z) * (R.apronHalf + f.c.radius + 0.2); px = Math.max(-lim, Math.min(lim, f.x)); }
      this.moveToward(f, px, pz, run); return 'toApron';
    }
    if (f.zone === ZONE.FLOOR) {
      // straight line blocked by the ring? shortest path via the corner waypoints
      if (this.segmentHitsRing(f.x, f.z, tx, tz, f.c.radius)) {
        const wp = this.cornerPath(f, tx, tz);
        if (wp) { this.moveToward(f, wp[0], wp[1], run); return 'around'; }
      }
    }
    this.moveToward(f, tx, tz, run);
    return 'direct';
  }

  cornerPath(f, tx, tz) {
    const c = R.apronHalf + f.c.radius + 0.6;
    const C = [[c, c], [-c, c], [-c, -c], [c, -c]];
    const r = f.c.radius * 0.8;
    const clear = (a, b) => !this.segmentHitsRing(a[0], a[1], b[0], b[1], r);
    const me = [f.x, f.z], T = [tx, tz];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    let best = null, bd = 1e9;
    for (let i = 0; i < 4; i++) {
      if (!clear(me, C[i])) continue;
      const d0 = dist(me, C[i]);
      const first = d0 < 0.45 ? null : C[i];
      if (clear(C[i], T)) { const d = d0 + dist(C[i], T); if (d < bd) { bd = d; best = first || T; } }
      for (const j of [(i + 1) % 4, (i + 3) % 4]) {
        if (!clear(C[j], T)) continue;
        const d = d0 + dist(C[i], C[j]) + dist(C[j], T);
        if (d < bd) { bd = d; best = first || C[j]; }
      }
    }
    return best;
  }

  segmentHitsRing(x0, z0, x1, z1, r) {
    const h = R.apronHalf + r;
    for (let i = 1; i < 10; i++) {
      const t = i / 10, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (Math.abs(x) < h && Math.abs(z) < h) return true;
    }
    return false;
  }

  think(f, dt) {
    const w = this.world;
    const b = this.brain(f), cfg = b.cfg;
    const inp = f.input;
    inp.held = 0; inp.mx = 0; inp.mz = 0;
    b.t += dt;
    if (w.match.phase !== 'live') { b.mode = 'idle'; return; }

    // ── RECOVER: mash out of holds, pins, knockdowns ──
    if ([S.HELD, S.PINNED, S.DOWN, S.CORNER_STUN, S.KNOCKDOWN].includes(f.state)) {
      b.mode = 'recover';
      b.mashT -= dt;
      if (f.state === S.HELD && f.stateTime < 0.3 && !b.revTried) { b.revTried = true; if (rand() < cfg.reversalChance) this.press(f, BTN.BLOCK); }
      if (b.mashT <= 0) { b.mashT = 1 / (cfg.mashRate * (0.7 + rand() * 0.6)); this.press(f, BTN.PUNCH); }
      return;
    }
    b.revTried = false;
    if (f.state === S.APRON) { b.mode = 'idle'; return; }

    // pending delayed actions (reaction time)
    for (let i = b.pending.length - 1; i >= 0; i--) {
      const p = b.pending[i]; p.t -= dt;
      if (p.t <= 0) { b.pending.splice(i, 1); p.fn(); }
    }

    b.think -= dt;
    if (b.retarget <= 0 || b.target == null || !isAlive(w.byId(b.target) || {}) ) { this.chooseTarget(f, b); b.retarget = 1.2 + rand(); }
    b.retarget -= dt;
    const tgt = b.target != null ? w.byId(b.target) : null;
    if (tgt) f.target = tgt.id;

    // ── states that need continuous control ──
    if (f.state === S.HOLD) { this.grapple(f, b, tgt, dt); return; }
    if (f.state === S.PERCH) { if (tgt && dist2D(f, tgt) < 7 && (tgt.state === S.DOWN || rand() < 0.03)) this.press(f, BTN.PUNCH); return; }
    if (f.state === S.CAGE_CLIMB) {
      const fw = forwardOf(f);
      if (f.y < 2.5 && rand() < 0.97) { inp.mx = fw.x; inp.mz = fw.z; } else this.press(f, rand() < 0.7 ? BTN.JUMP : BTN.INTERACT);
      return;
    }
    if (!FREE_STATES.has(f.state)) {
      // mid-attack: chain combos
      if (f.state === S.ATTACK && tgt && rand() < cfg.comboChance * dt * 8) {
        const m = ATTACKS[f.move];
        if (m?.next && f.moveHits.length) this.press(f, BTN.PUNCH);
      }
      return;
    }
    if (!tgt) { b.mode = 'search'; this.wander(f, b); return; }

    const d = dist2D(f, tgt);
    const sameZone = tgt.zone === f.zone;
    const reach = f.c.radius + tgt.c.radius + 0.6 * (f.c.height / 1.8);

    // ── DEFEND: react to incoming attacks (with reaction delay) ──
    const threat = w.fighters.find((o) => o !== f && w.combat.enemies(f, o) && (o.state === S.ATTACK || o.state === S.SPECIAL || o.state === S.GRAB) &&
      dist2D(o, f) < 2.6 + o.c.radius && Math.abs(wrapAngle(angleTo(o, f.x, f.z) - o.yaw)) < 0.9);
    if (threat && b.lastSeenAttack !== threat.id + ':' + threat.move + ':' + Math.floor(threat.stateTime * 0)) {
      b.lastSeenAttack = threat.id + ':' + threat.move + ':' + Math.floor(threat.stateTime * 0);
      const r = rand();
      const isGrab = threat.state === S.GRAB;
      if (r < cfg.dodgeChance || (isGrab && r < cfg.dodgeChance * 2)) {
        b.pending.push({ t: cfg.reaction, fn: () => { const side = forwardOf(threat); f.input.mx = side.z * b.strafe; f.input.mz = -side.x * b.strafe; this.press(f, BTN.DODGE); b.mode = 'dodge'; } });
      } else if (!isGrab && r < cfg.dodgeChance + cfg.blockChance) {
        b.mode = 'defend'; b.blockUntil = b.t + cfg.reaction + 0.55;
        if (rand() < cfg.parryChance) b.pending.push({ t: Math.max(0.02, cfg.reaction * 0.5), fn: () => this.hold(f, BTN.BLOCK) });
      }
    }
    if (b.mode === 'defend' && b.t < (b.blockUntil ?? 0)) {
      if (b.t > (b.blockUntil ?? 0) - 0.55 + cfg.reaction * 0.2) this.hold(f, BTN.BLOCK);
      if (tgt) { f.input.mx = (tgt.x - f.x) * 0.01; f.input.mz = (tgt.z - f.z) * 0.01; }
      return;
    }
    if (b.mode === 'defend') b.mode = 'chase';

    // ── situational aggression: health, the opponent's health and personality ──
    const myHp = hpFrac(f), oppHp = hpFrac(tgt);
    b.aggro = Math.max(0.15, Math.min(1.8, cfg.aggression * b.pers.aggr
      * (0.55 + myHp * 0.75)                 // hurt -> more careful
      * (oppHp < 0.3 ? 1.45 : 1.0)));        // smell blood -> go finish it

    // ── REGROUP: badly hurt and outgunned -> break off, keep away and heal up ──
    const retreatAt = Math.max(0.12, cfg.fleeHealth * b.pers.flee * 1.9);
    if (b.mode !== 'regroup' && myHp < retreatAt && oppHp > myHp + 0.12) {
      b.mode = 'regroup'; b.regroupUntil = b.t + 3.5 + rand() * 3.5;
    }
    if (b.mode === 'regroup') {
      const healed = myHp > Math.min(0.72, retreatAt + 0.3);
      if (b.t > b.regroupUntil || healed || oppHp < myHp - 0.1) { b.mode = 'chase'; }
      else {
        // put real distance between us; break line of sight by leaving the ring
        const ax = f.x - tgt.x, az = f.z - tgt.z, ad = Math.hypot(ax, az) || 1;
        this.moveToward(f, f.x + ax / ad * 5, f.z + az / ad * 5, true);
        if (d < 2.2 && rand() < cfg.dodgeChance) this.press(f, BTN.DODGE);
        if (d < 3) this.hold(f, BTN.BLOCK);
        if (f.zone === ZONE.RING && w.arena.ropeGap(f.x, f.z) < 0.7 && rand() < 0.25) this.press(f, BTN.INTERACT);
        return;
      }
    }

    if (b.think > 0 && b.mode === 'attack') { this.approach(f, tgt, d, reach, b); return; }
    b.think = cfg.thinkInterval * (0.7 + rand() * 0.6);

    // ── TAG out when tired ──
    if (w.rules.tag && f.legal && hpFrac(f) < 0.45) {
      const partner = w.fighters.find((o) => o.team === f.team && o !== f && o.state === S.APRON && hpFrac(o) > hpFrac(f) + 0.2);
      if (partner) {
        const [cx, cz] = ARENA.tagCorners[f.team];
        const px = cx * (R.postInset - 0.7), pz = cz * (R.postInset - 0.7);
        b.mode = 'tag';
        if (Math.hypot(f.x - px, f.z - pz) < 0.9) this.press(f, BTN.INTERACT); else this.moveToward(f, px, pz, true);
        return;
      }
    }

    // ── SPECIAL ──
    const st = w.abilities.status(f, tgt);
    if (st.ready && rand() < cfg.specialChance * 0.5) {
      const ab = w.abilities.ability(f);
      const good = ab.kind === 'leap_crush' ? (d >= (ab.minRange ?? 0) && d <= ab.maxRange)
        : ab.kind === 'blitz' ? d < ab.maxRange
        : ab.kind === 'spear' ? d < 6 && sameZone
        : ab.kind === 'spin' ? d < 2.2 : d < reach + 0.4 && sameZone;
      if (good && !DOWN_STATES.has(tgt.state)) { this.press(f, BTN.SPECIAL); b.mode = 'special'; return; }
    }

    // ── target is down: pin / ground attack / climb turnbuckle / taunt ──
    if ((tgt.state === S.DOWN || tgt.state === S.KNOCKDOWN) && sameZone) {
      const pinRule = !w.rules.pinsInRingOnly || f.zone === ZONE.RING;
      const want = pinRule && (hpFrac(tgt) < 0.55 || tgt.downTimer > 1) && rand() < cfg.pinChance;
      if (d < 1.2 + f.c.radius && want && w.match.pinCandidate(f)) { this.press(f, BTN.INTERACT); b.mode = 'pin'; return; }
      if (f.zone === ZONE.RING && tgt.downTimer > 1.4 && rand() < cfg.turnbuckleChance) {
        const c = w.arena.nearestCorner(f.x, f.z);
        b.mode = 'climb'; b.goal = { x: c.sx * (R.postInset - 0.9), z: c.sz * (R.postInset - 0.9), until: b.t + 2.5 };
      } else if (d < reach + 0.4 && rand() < cfg.groundAttackChance) { this.press(f, rand() < 0.3 ? BTN.KICK : BTN.PUNCH); b.mode = 'attack'; return; }
      else if (rand() < cfg.tauntChance) { this.press(f, BTN.TAUNT); return; }
    }
    if (b.mode === 'climb' && b.goal) {
      if (b.t > b.goal.until) { b.mode = 'chase'; b.goal = null; }
      else { const dd = this.moveToward(f, b.goal.x, b.goal.z, true); if (dd < 0.5) { this.press(f, BTN.INTERACT); b.mode = 'chase'; b.goal = null; } return; }
    }

    // ── ITEMS: contextual, with a cooldown so the AI doesn't spam grabbing/throwing ──
    if (f.item != null) {
      // up close, smash with what we're holding; only throw occasionally at mid-range
      if (d < reach + 0.5) { this.press(f, rand() < 0.4 ? BTN.KICK : BTN.PUNCH); return; }
      if (d > 3 && d < 8 && b.t > (b.itemUntil || 0) && rand() < 0.05) { this.press(f, BTN.THROW); b.itemUntil = b.t + 2.5; return; }
    } else if (b.mode === 'getItem' || (d > 3.5 && b.t > (b.itemUntil || 0) && rand() < cfg.itemChance * b.pers.item * 0.06)) {
      // only fetch an item from range (never mid-brawl), and not again for a few seconds
      const it = this.nearestItem(f, 7);
      if (it && (d > 2.5 || b.mode === 'getItem')) {
        b.mode = 'getItem';
        const izone = w.arena.isInsideRingSquare(it.x, it.z) && it.y > 1 ? ZONE.RING : ZONE.FLOOR;
        if (Math.hypot(it.x - f.x, it.z - f.z) < 1.1 + f.c.radius && izone === f.zone) { this.press(f, BTN.INTERACT); b.mode = 'chase'; b.itemUntil = b.t + 3.5; return; }
        this.navigate(f, it.x, it.z, izone, true);
        return;
      }
      b.itemUntil = b.t + 1.5; // nothing reachable – don't re-check every tick
      if (b.mode === 'getItem') b.mode = 'chase';
    }

    // ── CHASE / ATTACK ──
    b.mode = d < reach + 1.2 ? 'attack' : 'chase';
    if (!sameZone || d > reach + 0.3) {
      if (sameZone && d > 4 && d < 9 && f.zone === ZONE.RING && rand() < b.aggro * 0.08) {
        this.moveToward(f, tgt.x, tgt.z, true); // running attack setup
      } else this.navigate(f, tgt.x, tgt.z, tgt.zone, d > 3.5);
      // running strike when close at speed
      if (sameZone && f.runTime > 0.4 && d < reach + 1.4 && rand() < b.aggro) this.press(f, rand() < 0.5 ? BTN.KICK : BTN.PUNCH);
      return;
    }
    this.approach(f, tgt, d, reach, b);
    // hesitation / spacing: cautious or hurt AIs hold the mid-range instead of piling in
    if (rand() > b.aggro * 0.9) { if (d < reach + 1.6 && rand() < b.pers.space * 0.5) this.approach(f, tgt, d, reach + 1.2, b); return; }
    // choose an attack that can actually hit this target
    const small = tgt.c.height < f.c.height * 0.7;
    const r = rand();
    if (tgt.state === S.BLOCK && r < 0.6) { this.press(f, BTN.GRAB); return; }
    if (r < cfg.grabChance && tgt.state !== S.ATTACK) { this.press(f, BTN.GRAB); return; }
    if (small) { this.press(f, rand() < 0.75 ? BTN.KICK : BTN.PUNCH); return; } // kicks reach tiny opponents
    if (r < cfg.grabChance + 0.12) { this.press(f, BTN.PUNCH | BTN.KICK); return; }
    this.press(f, rand() < 0.62 ? BTN.PUNCH : BTN.KICK);
  }

  approach(f, tgt, d, reach, b) {
    // circle/strafe a little so AIs look alive instead of walking straight in
    b.strafeT -= 1 / 60;
    if (b.strafeT <= 0) { b.strafeT = 0.8 + rand() * 1.4; b.strafe = rand() < 0.5 ? -1 : 1; }
    const dx = tgt.x - f.x, dz = tgt.z - f.z, dd = Math.hypot(dx, dz) || 1;
    const nx = dx / dd, nz = dz / dd;
    const want = reach - 0.1;
    const radial = d > want ? 1 : d < want - 0.5 ? -0.6 : 0;
    const side = b.mode === 'attack' ? 0.35 * b.strafe : 0;
    f.input.mx = nx * radial - nz * side; f.input.mz = nz * radial + nx * side;
  }

  grapple(f, b, tgt, dt) {
    const w = this.world, cfg = b.cfg;
    if (f.stateTime < 0.25 + (1 - cfg.aggression) * 0.3) return;
    const v = w.byId(f.holding);
    if (!v) return;
    const r = rand();
    const st = w.abilities.status(f, v);
    if (st.ready && w.abilities.ability(f)?.kind === 'grapple' && rand() < cfg.specialChance) { this.press(f, BTN.SPECIAL); return; }
    if (f.gstrikes < 2 && r < 0.3) { this.press(f, BTN.PUNCH); return; }
    if (r < 0.7) {
      const fw = forwardOf(f);
      if (rand() < 0.35) { f.input.mx = -fw.x; f.input.mz = -fw.z; }
      this.press(f, BTN.KICK); return;
    }
    // throw: toward ropes, barricade or a table
    const table = w.items.items.find((it) => it.type === 'table' && !it.broken && it.holder == null && Math.hypot(it.x - f.x, it.z - f.z) < 5);
    if (table) { const dx = table.x - f.x, dz = table.z - f.z, d = Math.hypot(dx, dz) || 1; f.input.mx = dx / d; f.input.mz = dz / d; }
    else { const a = rand() * Math.PI * 2; f.input.mx = Math.sin(a); f.input.mz = Math.cos(a); }
    this.press(f, BTN.GRAB);
  }

  nearestItem(f, maxD) {
    let best = null, bd = maxD;
    for (const it of this.world.items.items) {
      if (it.holder != null || it.broken || it.type === 'table' && f.c.weight < 90) continue;
      if (it.thrownBy != null) continue;
      const d = Math.hypot(it.x - f.x, it.z - f.z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  wander(f, b) {
    if (!b.goal || b.t > b.goal.until) b.goal = { x: (rand() * 2 - 1) * 2, z: (rand() * 2 - 1) * 2, until: b.t + 2 };
    this.moveToward(f, b.goal.x, b.goal.z);
  }
}
