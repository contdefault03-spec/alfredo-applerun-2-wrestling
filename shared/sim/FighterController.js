// FighterController – turns input into actions and advances each fighter's
// state machine, then integrates movement/physics against the arena.
import { ATTACKS, DEFAULT_MOVESET } from '../config/attacks.js';
import { ARENA } from '../config/arena.js';
import { BTN, S, ZONE, FREE_STATES, DOWN_STATES, RAFTER_Y, RAFTER_SPEED, RAFTER_REACH, HIGH_DROP_DUR } from './constants.js';
import { setState, forwardOf, turnToward, angleTo, dist2D, isAlive, wrapAngle, hpFrac } from './Fighter.js';
import { CELEBRATION_TIME } from './MatchSystem.js';

const R = ARENA.ring;
const GRAV = ARENA.gravity;

export function moveId(f, slot) {
  return f.c.moveset[slot] || DEFAULT_MOVESET[slot];
}

/**
 * Pure locomotion step used by the server AND by client-side prediction.
 * Handles IDLE/MOVE/BLOCK walking, running, facing and stamina.
 */
export function stepLocomotion(f, input, dt, arena, targetPos = null) {
  const c = f.c;
  let mx = input.mx || 0, mz = input.mz || 0;
  const len = Math.hypot(mx, mz);
  const mag = Math.min(1, len);
  if (len > 1e-3) { mx /= len; mz /= len; }
  const blocking = f.state === S.BLOCK;
  const wantRun = (input.held & BTN.RUN) && mag > 0.2 && !blocking && f.stamina > 1;
  const lowStam = f.stamina < 15 ? 0.8 : 1;
  const speed = blocking ? c.walkSpeed * 0.35 : wantRun ? c.runSpeed * lowStam : c.walkSpeed * lowStam;
  const tvx = mx * speed * mag, tvz = mz * speed * mag;
  const acc = c.acceleration * (f.onGround ? 1 : 0.25);
  const k = Math.min(1, acc * dt / Math.max(0.5, speed));
  f.vx += (tvx - f.vx) * Math.min(1, k * 2.2);
  f.vz += (tvz - f.vz) * Math.min(1, k * 2.2);
  if (wantRun) { f.runTime += dt; f.stamina -= 9 * dt; f.staminaDelay = 0.5; } else f.runTime = 0;
  // facing: strafe toward the focus target while walking/blocking, face movement when running
  if (targetPos && !wantRun && Math.hypot(targetPos.x - f.x, targetPos.z - f.z) < 7) {
    turnToward(f, angleTo(f, targetPos.x, targetPos.z), c.turnSpeed * dt);
  } else if (mag > 0.2) {
    turnToward(f, Math.atan2(mx, mz), c.turnSpeed * dt * (wantRun ? 1.3 : 1));
  }
  if (f.state === S.IDLE || f.state === S.MOVE) {
    const moving = Math.hypot(f.vx, f.vz) > 0.25;
    if (moving && f.state !== S.MOVE) { f.state = S.MOVE; f.stateTime = 0; }
    if (!moving && f.state !== S.IDLE) { f.state = S.IDLE; f.stateTime = 0; }
  }
  f.moveSpeed = Math.hypot(f.vx, f.vz);
  return wantRun;
}

/** Integrate velocity, gravity and arena collision for one fighter. */
export function integrate(f, dt, arena) {
  f.x += f.vx * dt; f.z += f.vz * dt;
  const ground = arena.groundFor(f.zone);
  if (!f.onGround || f.vy > 0 || f.y > ground + 1e-3) {
    f.vy += GRAV * dt;
    f.y += f.vy * dt;
    if (f.y <= ground) { f.y = ground; f.landVel = f.vy; f.vy = 0; f.onGround = true; }
    else f.onGround = false;
  }
  if (f.onGround) {
    // ground friction for non-locomotion states
    const loco = f.state === S.IDLE || f.state === S.MOVE || f.state === S.BLOCK;
    if (!loco) {
      const fr = f.state === S.DODGE || f.state === S.WHIPPED || f.state === S.REBOUND || f.state === S.ATTACK || f.state === S.SPECIAL ? 0 : 7;
      const s = Math.max(0, 1 - fr * dt);
      f.vx *= s; f.vz *= s;
    }
  }
  return arena.collide(f, f.c.radius, f.zone, dt, true);
}

export class FighterController {
  constructor(world) { this.world = world; }

  targetOf(f) {
    const t = f.target != null ? this.world.byId(f.target) : null;
    return t && isAlive(t) && !t.hidden ? t : null;
  }

  /** Pick the focus opponent: nearest enemy, biased to what's in front. */
  updateTarget(f) {
    const w = this.world;
    let best = null, bestScore = 1e9;
    const fw = forwardOf(f);
    for (const o of w.fighters) {
      if (!w.combat.enemies(f, o) || !isAlive(o)) continue;
      const dx = o.x - f.x, dz = o.z - f.z, d = Math.hypot(dx, dz) || 1e-3;
      const front = (dx * fw.x + dz * fw.z) / d;
      const score = d * (1.25 - front * 0.35) + (o.zone !== f.zone ? 3 : 0) + (o.id === f.target ? -0.8 : 0);
      if (score < bestScore) { bestScore = score; best = o; }
    }
    f.target = best ? best.id : null;
  }

  update(f, dt) {
    const w = this.world;
    const inp = f.input;
    const pressed = inp.pressed;
    // timers
    if (f.specialCd > 0) f.specialCd -= dt;
    if (f.dodgeCd > 0) f.dodgeCd -= dt;
    if (f.invuln > 0) f.invuln -= dt;
    if (f.armor > 0) f.armor -= dt;
    if (f.comboTimer > 0) f.comboTimer -= dt; else f.combo = 0;
    if (f.staminaDelay > 0) f.staminaDelay -= dt;
    else if (f.state !== S.BLOCK && !(f.state === S.MOVE && f.runTime > 0)) f.stamina = Math.min(f.c.maxStamina, f.stamina + f.c.staminaRegen * dt);
    if (f.hitstop > 0) { f.hitstop -= dt; return; }
    f.stateTime += dt;
    if ((w.tick + f.id) % 15 === 0 || f.target == null) this.updateTarget(f);
    const tgt = this.targetOf(f);

    if (w.match.frozen(f)) { f.vx *= 0.8; f.vz *= 0.8; integrate(f, dt, w.arena); return; }

    // input buffer: a press during recovery/hitstun is kept for 0.25 s
    if (pressed) { f.buf = (f.buf || 0) | pressed; f.bufT = 0.25; } else if (f.bufT > 0) { f.bufT -= dt; if (f.bufT <= 0) f.buf = 0; }
    // mash counters (escape holds / get up faster / kick out)
    const mashBits = BTN.PUNCH | BTN.KICK | BTN.GRAB | BTN.JUMP | BTN.INTERACT;
    if (pressed & mashBits) f.mash++;

    switch (f.state) {
      case S.IDLE: case S.MOVE: case S.BLOCK:
        this.free(f, dt, tgt); break;
      case S.JUMP: this.airborneControl(f, dt);
        if (pressed & (BTN.PUNCH | BTN.KICK) && f.stateTime > 0.05) this.startAttack(f, moveId(f, 'aerial'));
        if (f.onGround && f.stateTime > 0.1) { setState(f, S.IDLE); w.emit('land', { fighter: f.id, heavy: f.c.weight > 150 }); }
        break;
      case S.DODGE: {
        const t = f.stateTime / f.c.dodgeDuration;
        const sp = f.c.dodgeSpeed * (1 - t * 0.7);
        f.vx = f.lockDir.x * sp; f.vz = f.lockDir.z * sp;
        if (t >= 1) { setState(f, S.IDLE); f.vx *= 0.3; f.vz *= 0.3; }
        break;
      }
      case S.ATTACK: this.attackUpdate(f, dt, tgt); break;
      case S.GRAB: w.grapple.grabUpdate(f, dt); break;
      case S.HOLD: w.grapple.holdUpdate(f, dt); break;
      case S.HELD: w.grapple.heldUpdate(f, dt); break;
      case S.GRAPPLE_MOVE: w.grapple.moveUpdate(f, dt); break;
      case S.GRAPPLE_VICTIM: break; // driven by the grabber
      case S.THROWING: w.grapple.throwUpdate(f, dt); break;
      case S.WHIPPED:
        f.vx = f.lockDir.x * f.lockDir.speed; f.vz = f.lockDir.z * f.lockDir.speed;
        f.yaw = Math.atan2(f.lockDir.x, f.lockDir.z);
        if (f.stateTime > 2.4) { setState(f, S.HITSTUN, 0.4); f.sub = 1; }
        break;
      case S.REBOUND:
        if (f.stateTime > f.stateDur) {
          if (f.sub === 1) { setState(f, S.WHIPPED, 0); f.lockDir.speed *= 1.02; }
          else { setState(f, S.MOVE); f.runTime = 0.5; f.vx = f.lockDir.x * f.c.runSpeed * 1.1; f.vz = f.lockDir.z * f.c.runSpeed * 1.1; }
        }
        break;
      case S.HITSTUN: case S.PARRIED:
        if (f.stateTime >= f.stateDur) setState(f, S.IDLE);
        break;
      case S.CORNER_STUN:
        if (f.stateTime >= f.stateDur || (f.mash > 6)) { setState(f, S.IDLE); f.mash = 0; }
        break;
      case S.AIRBORNE:
        if (f.onGround && f.stateTime > 0.05) {
          const impact = -(f.landVel ?? 0);
          w.emit('land', { fighter: f.id, bodyfall: true, heavy: impact > 5 || f.c.weight > 150, pos: { x: f.x, y: f.y, z: f.z } });
          w.items.checkTableBreak(f, impact);
          if (impact > 8 && f.zone === ZONE.FLOOR && f.fellFromRing) { this.world.combat.applyEnvDamage(f, 45, 'floor_crash'); }
          f.fellFromRing = false;
          setState(f, S.KNOCKDOWN, 0.55);
          f.mash = 0;
        }
        break;
      case S.KNOCKDOWN:
        if (f.stateTime >= f.stateDur) {
          if (f.koPending) { setState(f, S.KO); f.koPending = false; }
          else { setState(f, S.DOWN); f.mash = 0; }
        }
        break;
      case S.DOWN:
        // mashing only helps a little now – they really have to struggle up
        f.downTimer -= dt * (1 + Math.min(0.7, f.mash * 0.05));
        if (f.downTimer <= 0) { setState(f, S.GETUP, 0.75 / f.c.recoverySpeed); f.invuln = 0.35; }
        break;
      case S.GETUP:
        if (f.stateTime >= f.stateDur) setState(f, S.IDLE);
        break;
      case S.CLIMB: this.climbUpdate(f, dt); break;
      case S.PERCH:
        f.vx = f.vz = 0; f.vy = 0;
        if (tgt) turnToward(f, angleTo(f, tgt.x, tgt.z), 6 * dt);
        if (pressed & (BTN.PUNCH | BTN.KICK | BTN.JUMP)) this.startDive(f, tgt);
        else if (pressed & BTN.INTERACT) this.startClimb(f, 'down_corner'); // the overhead drop is now reached via the stands zipline, not the turnbuckle
        break;
      case S.RAFTER_CLIMB: this.rafterClimbUpdate(f, dt); break;
      case S.RAFTER: this.rafterUpdate(f, dt); break;
      case S.RAFTER_DROP: this.rafterDropUpdate(f, dt); break;
      case S.CAGE_CLIMB: this.cageClimbUpdate(f, dt, tgt); break;
      case S.DIVE: this.diveUpdate(f, dt); break;
      case S.SPECIAL: w.abilities.update(f, dt); break;
      case S.PIN: case S.PINNED: break; // MatchSystem
      case S.TAUNT:
        f.meter = Math.min(100, f.meter + 14 * dt);
        if (f.stateTime >= f.stateDur) setState(f, S.IDLE);
        break;
      case S.APRON: f.vx = f.vz = 0; break;
      case S.KO: f.vx *= 0.9; f.vz *= 0.9; break;
      case S.CELEBRATE:
        f.vx = f.vz = 0;
        if (f.stateDur > 0 && f.stateTime >= f.stateDur) { if (f.sub === 1 && f.charId === 'ajan') f.ateFood = true; setState(f, S.IDLE); }
        break;
    }
    f.input.pressed = 0;
    this.physics(f, dt);
  }

  /** Signature victory celebration (E after winning). Ajan eats the food in his hand. */
  startCelebrate(f) {
    const t = CELEBRATION_TIME[f.charId] ?? CELEBRATION_TIME.default;
    setState(f, S.CELEBRATE, f.charId === 'ajan' && f.ateFood ? CELEBRATION_TIME.default : t);
    f.sub = 1;
    this.world.emit('celebrate', { fighter: f.id, eat: f.charId === 'ajan' && !f.ateFood });
  }

  // ── free (actionable) state ──
  free(f, dt, tgt) {
    const w = this.world, inp = f.input, h = inp.held;
    let p = inp.pressed | (f.bufT > 0 ? f.buf : 0);
    f.buf = 0; f.bufT = 0;
    if (w.match.phase === 'finished' || w.match.phase === 'over') {
      // victory lap: no more fighting – E celebrates, T taunts, F still climbs turnbuckles
      if (p & BTN.GRAB) { this.startCelebrate(f); return; }
      p &= BTN.JUMP | BTN.TAUNT | BTN.INTERACT;
      inp.pressed = p;
    }
    // block
    if (h & BTN.BLOCK) { if (f.state !== S.BLOCK) setState(f, S.BLOCK); }
    else if (f.state === S.BLOCK) setState(f, S.IDLE);

    const running = f.state === S.MOVE && f.runTime > 0.25 && f.moveSpeed > f.c.runSpeed * 0.6;
    const hasItem = f.item != null;

    if (p & BTN.SPECIAL) { if (w.abilities.tryActivate(f, tgt)) return; }
    if (p & BTN.INTERACT) { if (this.interact(f, tgt)) return; }
    if (p & BTN.THROW && hasItem) { w.items.throwItem(f, tgt); return; }
    if (p & BTN.DODGE && f.dodgeCd <= 0 && f.stamina >= 12) { this.startDodge(f); return; }
    if (p & BTN.JUMP && f.onGround && f.state !== S.BLOCK) {
      setState(f, S.JUMP); f.vy = f.c.jumpStrength; f.onGround = false; f.stamina -= 6;
      w.emit('jump', { fighter: f.id }); return;
    }
    if (p & BTN.TAUNT && f.state !== S.BLOCK) { setState(f, S.TAUNT, 1.6); w.emit('taunt', { fighter: f.id }); return; }
    if (p & BTN.GRAB) {
      if (hasItem) w.items.drop(f);
      w.grapple.startGrab(f, tgt); return;
    }
    if (p & (BTN.PUNCH | BTN.KICK)) {
      const both = (p & BTN.PUNCH) && (p & BTN.KICK);
      const tdown = tgt && (DOWN_STATES.has(tgt.state) || tgt.state === S.KNOCKDOWN) && dist2D(f, tgt) < f.c.radius + 1.6;
      let id;
      if (hasItem) id = (p & BTN.KICK) && w.items.canSmash(f) ? 'item_smash' : 'item_swing';
      else if (tdown) id = (p & BTN.KICK) ? moveId(f, 'groundHeavy') : moveId(f, 'ground');
      else if (running) id = (p & BTN.KICK) ? moveId(f, 'runningKick') : moveId(f, 'running');
      else if (both) id = moveId(f, 'heavy');
      else if (p & BTN.PUNCH) {
        const chain = [moveId(f, 'punch')];
        let nx = ATTACKS[chain[0]]?.next; while (nx && chain.length < 4) { chain.push(nx); nx = ATTACKS[nx]?.next; }
        id = chain[Math.min(f.combo, chain.length - 1)];
      } else id = f.combo > 0 && f.lastKickCombo ? (ATTACKS[moveId(f, 'kick')].next || moveId(f, 'kick')) : moveId(f, 'kick');
      if (p & BTN.KICK && !both && !tdown && !running && !hasItem) f.lastKickCombo = true; else f.lastKickCombo = false;
      if (id && ATTACKS[id]) { this.startAttack(f, id, tgt); return; }
    }
    stepLocomotion(f, inp, dt, w.arena, tgt && dist2D(f, tgt) < 6 ? tgt : null);
  }

  startAttack(f, id, tgt = this.targetOf(f)) {
    const m = ATTACKS[id];
    if (!m) return false;
    if (f.stamina < m.stamina * 0.5 && m.stamina > 0) return false;
    const w = this.world;
    const dur = (m.startup + m.recovery) / f.c.attackSpeed + m.active;
    setState(f, S.ATTACK, dur, id);
    f.stamina -= m.stamina;
    f.staminaDelay = 0.4;
    // combo bookkeeping
    const chainNext = m.next;
    f.combo = chainNext ? f.combo + 1 : 0;
    f.comboTimer = dur + 0.35;
    if (m.armor) f.armor = dur * 0.8;
    // aim assist: snap toward the target if roughly in front
    if (tgt && dist2D(f, tgt) < 4) {
      const want = angleTo(f, tgt.x, tgt.z);
      if (Math.abs(wrapAngle(want - f.yaw)) < 1.4) turnToward(f, want, 0.8);
    }
    w.emit('attack', { fighter: f.id, move: id });
    return true;
  }

  attackUpdate(f, dt, tgt) {
    const m = ATTACKS[f.move];
    if (!m) { setState(f, S.IDLE); return; }
    const sp = f.c.attackSpeed;
    const t0 = m.startup / sp, t1 = t0 + m.active;
    // lunge during startup+active
    const fw = forwardOf(f);
    if (f.stateTime < t1) {
      const l = m.lunge * (m.type === 'running' ? 1 : f.c.walkSpeed / 2.6);
      if (m.type === 'aerial') { /* keep momentum */ }
      else { f.vx = fw.x * l; f.vz = fw.z * l; }
      if (f.stateTime < t0 && tgt && dist2D(f, tgt) < 3.5) turnToward(f, angleTo(f, tgt.x, tgt.z), 5 * dt);
    }
    // aerial attacks end on landing
    if (m.type === 'aerial' && f.onGround && f.stateTime > 0.1) { setState(f, S.IDLE); return; }
    // combo buffering: pressing punch during recovery chains
    const cancelAt = t1 + (f.stateDur - t1) * (1 - m.cancel);
    if (f.stateTime >= cancelAt && (f.input.pressed & (BTN.PUNCH | BTN.KICK)) && f.combo > 0 && m.next) {
      const nextId = f.input.pressed & BTN.PUNCH ? m.next : (ATTACKS[moveId(f, 'kick')].next || moveId(f, 'kick'));
      if (this.startAttack(f, nextId, tgt)) return;
    }
    if (f.stateTime >= f.stateDur) setState(f, S.IDLE);
  }

  airborneControl(f, dt) {
    const inp = f.input;
    const m = Math.hypot(inp.mx, inp.mz);
    if (m > 0.1) { f.vx += inp.mx / m * 6 * dt; f.vz += inp.mz / m * 6 * dt; }
  }

  startDodge(f) {
    const inp = f.input;
    let dx = inp.mx, dz = inp.mz;
    const m = Math.hypot(dx, dz);
    if (m < 0.2) { const fw = forwardOf(f); dx = -fw.x; dz = -fw.z; } else { dx /= m; dz /= m; }
    setState(f, S.DODGE, f.c.dodgeDuration);
    f.lockDir = { x: dx, z: dz };
    // sub: 0 = backstep, 1 = roll
    const fw = forwardOf(f);
    f.sub = (dx * fw.x + dz * fw.z) < -0.5 ? 0 : 1;
    f.dodgeCd = f.c.dodgeCooldown;
    f.stamina -= 12;
    this.world.emit('dodge', { fighter: f.id });
  }

  // ── context-sensitive INTERACT ──
  interact(f, tgt) {
    const w = this.world, a = w.arena;
    if (f.item != null) { w.items.drop(f); return true; }
    // pin a downed opponent
    const pinTarget = w.match.pinCandidate(f);
    if (pinTarget) { w.match.startPin(f, pinTarget); return true; }
    // pick up an item
    if (w.items.tryPickup(f)) return true;
    // tag partner
    if (w.match.tryTag(f)) return true;
    if (f.zone === ZONE.RING) {
      const corner = a.nearestCorner(f.x, f.z);
      if (corner.dist < R.cornerZone + 0.2) { this.startClimb(f, 'corner', corner); return true; }
      if (a.ropeGap(f.x, f.z) < 0.9) { this.startClimb(f, 'out'); return true; }
    } else if (f.zone === ZONE.FLOOR) {
      if (w.rules.cage && a.cageWallDist(f.x, f.z) < 0.9 + f.c.radius) { this.startCageClimb(f); return true; }
      if (!f.outside && a.apronEdgeDist(f.x, f.z) < 0.9 + f.c.radius) { this.startClimb(f, 'in'); return true; }
      // zipline platform in the back stands: vault out, reach the back, ride it up over the ring
      if (!w.rules.cage && f.outside && Math.abs(f.x) < 3.2 && f.z < -(ARENA.barricade.halfZ - 0.1)) { this.startRafterClimb(f); return true; }
      if (!w.rules.cage && this.nearBarricade(f)) { this.startVault(f); return true; }
    }
    return false;
  }

  startClimb(f, kind, corner) {
    const a = this.world.arena;
    let x1 = f.x, y1 = f.y, z1 = f.z, zone = f.zone, dur = 1.0;
    if (kind === 'in') { const t = a.climbInTarget(f.x, f.z); x1 = t.x; z1 = t.z; y1 = R.height; zone = ZONE.RING; dur = 1.05 / Math.sqrt(f.c.recoverySpeed); }
    else if (kind === 'out') { const t = a.rollOutTarget(f.x, f.z, f.c.radius); x1 = t.x; z1 = t.z; y1 = 0; zone = ZONE.FLOOR; dur = 0.9; }
    else if (kind === 'corner') {
      const inset = R.postInset - 0.35;
      x1 = corner.sx * inset; z1 = corner.sz * inset; y1 = R.height + 0.95; zone = ZONE.RING; dur = 0.85;
      f.yaw = Math.atan2(-corner.sx, -corner.sz);
    } else if (kind === 'down_corner') { x1 = f.x * 0.85; z1 = f.z * 0.85; y1 = R.height; zone = ZONE.RING; dur = 0.5; }
    else if (kind === 'enter') { const t = a.climbInTarget(f.x, f.z); x1 = t.x * 0.9; z1 = t.z * 0.9; y1 = R.height; zone = ZONE.RING; dur = 0.8; }
    else if (kind === 'to_apron') { x1 = f.x; z1 = f.z; y1 = R.height; zone = ZONE.APRON; dur = 0.8; }
    setState(f, S.CLIMB, dur);
    f.sub = { in: 0, out: 1, corner: 2, down_corner: 3, enter: 4, to_apron: 5 }[kind];
    f.path = { x0: f.x, y0: f.y, z0: f.z, x1, y1, z1, zone, kind };
    f.vx = f.vy = f.vz = 0;
    if (kind === 'in' || kind === 'out' || kind === 'enter') f.yaw = Math.atan2(x1 - f.x, z1 - f.z);
    this.world.emit(kind === 'out' ? 'exit_ring' : kind === 'corner' ? 'climb_turnbuckle' : kind === 'in' || kind === 'enter' ? 'enter_ring' : 'climb', { fighter: f.id });
  }

  climbUpdate(f, dt) {
    const p = f.path; const t = Math.min(1, f.stateTime / f.stateDur);
    const e = t * t * (3 - 2 * t);
    f.x = p.x0 + (p.x1 - p.x0) * e; f.z = p.z0 + (p.z1 - p.z0) * e;
    const lift = (p.kind === 'out' || p.kind === 'vault') ? Math.sin(t * Math.PI) * (p.kind === 'vault' ? 0.9 : 0.3) : 0;
    f.y = p.y0 + (p.y1 - p.y0) * Math.min(1, e * 1.3) + lift;
    f.vx = f.vy = f.vz = 0;
    if (t >= 1) {
      f.zone = p.zone; f.y = p.y1; f.onGround = true;
      if (p.kind === 'vault') f.outside = p.goingOut;
      if (p.kind === 'corner') setState(f, S.PERCH);
      else if (p.kind === 'to_apron') setState(f, S.APRON);
      else setState(f, S.IDLE);
      f.path = null;
    }
  }

  startCageClimb(f) {
    const a = this.world.arena;
    const C = ARENA.cage.half - f.c.radius - 0.05;
    if (Math.abs(f.x) > Math.abs(f.z)) { f.x = Math.sign(f.x) * C; f.yaw = Math.atan2(Math.sign(f.x), 0); }
    else { f.z = Math.sign(f.z) * C; f.yaw = Math.atan2(0, Math.sign(f.z)); }
    setState(f, S.CAGE_CLIMB);
    f.vx = f.vz = f.vy = 0;
    this.world.emit('cage_climb', { fighter: f.id });
  }

  cageClimbUpdate(f, dt, tgt) {
    const inp = f.input;
    const fw = forwardOf(f);
    const up = inp.mx * fw.x + inp.mz * fw.z; // push toward the wall = climb
    f.y = Math.max(0, Math.min(ARENA.cage.climbMax, f.y + up * 1.3 * dt));
    f.vx = f.vz = f.vy = 0; f.onGround = true;
    if (inp.pressed & (BTN.PUNCH | BTN.KICK | BTN.JUMP) && f.y > 1.2) { f.yaw += Math.PI; this.startDive(f, tgt); return; }
    if (inp.pressed & BTN.INTERACT || (f.y <= 0.02 && up < -0.3)) {
      setState(f, S.JUMP); f.vy = 0; f.onGround = false;
      f.x -= fw.x * 0.3; f.z -= fw.z * 0.3;
    }
  }

  // ── barricade vault ──────────────────────────────────────────────────────
  nearBarricade(f) {
    const B = ARENA.barricade, reach = 1.0 + f.c.radius;
    const dx = B.halfX - Math.abs(f.x), dz = B.halfZ - Math.abs(f.z);
    if (!f.outside) {
      // near one barricade rail from the inside, but not at the entrance gap
      const inGap = f.z > B.halfZ - reach && Math.abs(f.x) < B.gapHalf;
      const nearX = dx < reach && dx > -0.3 && Math.abs(f.z) < B.halfZ;
      const nearZ = dz < reach && dz > -0.3 && Math.abs(f.x) < B.halfX;
      return !inGap && (nearX || nearZ);
    }
    // near one rail from the moat side
    const nearX = Math.abs(dx) < reach && Math.abs(f.z) < B.halfZ + reach;
    const nearZ = Math.abs(dz) < reach && Math.abs(f.x) < B.halfX + reach;
    return nearX || nearZ;
  }

  startVault(f) {
    const B = ARENA.barricade;
    const goingOut = !f.outside;
    const dx = B.halfX - Math.abs(f.x), dz = B.halfZ - Math.abs(f.z);
    let x1 = f.x, z1 = f.z;
    if (Math.abs(dx) <= Math.abs(dz)) { const s = Math.sign(f.x) || 1; x1 = s * (B.halfX + (goingOut ? 1.3 : -1.3)); }
    else { const s = Math.sign(f.z) || 1; z1 = s * (B.halfZ + (goingOut ? 1.3 : -1.3)); }
    setState(f, S.CLIMB, 0.7);
    f.sub = 6;
    f.path = { x0: f.x, y0: 0, z0: f.z, x1, y1: 0, z1, zone: ZONE.FLOOR, kind: 'vault', goingOut };
    f.vx = f.vy = f.vz = 0;
    f.yaw = Math.atan2(x1 - f.x, z1 - f.z);
    this.world.emit('barricade_vault', { fighter: f.id, out: goingOut });
  }

  // ── rafters + high drop ─────────────────────────────────────────────────
  startRafterClimb(f) {
    const inset = R.postInset - 0.2;
    const sx = Math.sign(f.x) || 1, sz = Math.sign(f.z) || 1;
    setState(f, S.RAFTER_CLIMB, 1.1 / Math.sqrt(f.c.recoverySpeed));
    f.path = { x0: f.x, y0: f.y, z0: f.z, x1: sx * inset, y1: RAFTER_Y, z1: sz * inset };
    f.vx = f.vy = f.vz = 0; f.onGround = false;
    this.world.emit('rafter_climb', { fighter: f.id });
  }

  rafterClimbUpdate(f, dt) {
    const p = f.path, t = Math.min(1, f.stateTime / f.stateDur), e = t * t * (3 - 2 * t);
    f.x = p.x0 + (p.x1 - p.x0) * e; f.z = p.z0 + (p.z1 - p.z0) * e; f.y = p.y0 + (p.y1 - p.y0) * e;
    f.vx = f.vy = f.vz = 0; f.onGround = false;
    if (t >= 1) { setState(f, S.RAFTER); f.y = RAFTER_Y; f.path = null; this.world.emit('rafter_top', { fighter: f.id }); }
  }

  rafterUpdate(f, dt) {
    const inp = f.input;
    // walk out along the rafters, clamped to above the ring
    f.x = Math.max(-RAFTER_REACH, Math.min(RAFTER_REACH, f.x + inp.mx * RAFTER_SPEED * dt));
    f.z = Math.max(-RAFTER_REACH, Math.min(RAFTER_REACH, f.z + inp.mz * RAFTER_SPEED * dt));
    f.y = RAFTER_Y; f.vx = f.vy = f.vz = 0; f.onGround = false;
    if (Math.hypot(inp.mx, inp.mz) > 0.1) f.yaw = Math.atan2(inp.mx, inp.mz);
    if (inp.pressed & (BTN.PUNCH | BTN.KICK | BTN.INTERACT | BTN.JUMP)) this.startHighDrop(f);
  }

  startHighDrop(f) {
    setState(f, S.RAFTER_DROP, HIGH_DROP_DUR);
    f.path = { x0: f.x, y0: f.y, z0: f.z, x1: f.x, z1: f.z, y1: R.height };
    f.vx = f.vy = f.vz = 0; f.onGround = false;
    this.world.emit('high_drop_start', { fighter: f.id, x: f.x, z: f.z });
  }

  rafterDropUpdate(f, dt) {
    const p = f.path, t = Math.min(1, f.stateTime / f.stateDur), e = t * t; // accelerate downward
    f.y = p.y0 + (p.y1 - p.y0) * e; f.onGround = false; f.vx = f.vy = f.vz = 0;
    if (t >= 1) { f.y = R.height; f.onGround = true; this.world.match.applyHighDrop(f); }
  }

  startDive(f, tgt) {
    const fw = forwardOf(f);
    let tx = f.x + fw.x * 3.5, tz = f.z + fw.z * 3.5;
    if (tgt && dist2D(f, tgt) < 8) { tx = tgt.x; tz = tgt.z; }
    const zone = this.world.arena.isInsideRingSquare(tx, tz, -0.3) && f.zone === ZONE.RING ? ZONE.RING : (tgt ? tgt.zone : f.zone);
    setState(f, S.DIVE, 0, 'dive');
    f.yaw = Math.atan2(tx - f.x, tz - f.z);
    const flight = 0.75;
    f.path = { x0: f.x, y0: f.y, z0: f.z, x1: tx, z1: tz, zone, dur: flight, peak: 1.3 };
    this.world.emit('dive', { fighter: f.id, target: tgt?.id });
  }

  diveUpdate(f, dt) {
    const p = f.path; const w = this.world;
    if (f.sub === 0) {
      const t = Math.min(1, f.stateTime / p.dur);
      const g = w.arena.groundFor(p.zone);
      f.x = p.x0 + (p.x1 - p.x0) * t; f.z = p.z0 + (p.z1 - p.z0) * t;
      f.y = p.y0 + (g - p.y0) * t + 4 * p.peak * t * (1 - t);
      f.vx = f.vy = f.vz = 0;
      if (t >= 1) {
        f.zone = p.zone; f.y = g; f.onGround = true; f.sub = 1; f.stateTime = 0;
        // impact: body splash
        const m = ATTACKS.dive; let hitAny = false;
        for (const v of w.fighters) {
          if (!w.combat.enemies(f, v) || v.zone !== f.zone) continue;
          if (Math.hypot(v.x - f.x, v.z - f.z) > m.hitRadius + v.c.radius) continue;
          hitAny = w.combat.applyHit(f, v, { damage: m.damage, knockback: m.knockback, launch: 1, reaction: 'knockdown', hitstop: m.hitstop,
            sound: 'slam', move: 'dive', moveName: m.name, crowd: 1, dirX: Math.sin(f.yaw), dirZ: Math.cos(f.yaw) }) || hitAny;
        }
        w.items.checkTableBreak(f, 10);
        w.emit('land', { fighter: f.id, bodyfall: true, heavy: true, pos: { x: f.x, y: f.y, z: f.z } });
        if (!hitAny) { this.world.combat.applyEnvDamage(f, 50, 'dive_miss'); setState(f, S.DOWN); f.downTimer = 1.2; }
        f.stateDur = hitAny ? 0.7 : 0;
      }
    } else if (f.state === S.DIVE && f.stateTime > f.stateDur) setState(f, S.GETUP, 0.6);
  }

  // ── physics & environment reactions ──
  physics(f, dt) {
    const w = this.world;
    const scripted = f.state === S.CLIMB || f.state === S.HELD || f.state === S.GRAPPLE_VICTIM || f.state === S.PERCH ||
      f.state === S.CAGE_CLIMB || f.state === S.DIVE || f.state === S.APRON || (f.state === S.SPECIAL && f.path) ||
      f.state === S.RAFTER_CLIMB || f.state === S.RAFTER || f.state === S.RAFTER_DROP;
    if (scripted || f.hidden) return;
    const pre = { vx: f.vx, vz: f.vz };
    const contact = integrate(f, dt, w.arena);
    if (!contact) return;
    const speed = contact.speed;
    if (contact.kind === 'rope' || contact.kind === 'corner') {
      const flying = f.state === S.AIRBORNE;
      if (flying && speed > R.overTopSpeed && f.zone === ZONE.RING) {
        // over the top rope to the floor!
        const out = R.apronHalf + f.c.radius + 0.4;
        if (contact.nx !== 0) f.x = -contact.nx * out; else f.z = -contact.nz * out;
        f.vx = pre.vx * 0.5; f.vz = pre.vz * 0.5; f.vy = Math.max(f.vy, 2.5);
        f.zone = ZONE.FLOOR; f.onGround = false; f.fellFromRing = true;
        w.emit('over_top_rope', { fighter: f.id, pos: { x: f.x, y: f.y, z: f.z } });
        return;
      }
      if (contact.kind === 'corner' && speed > 4 && (f.state === S.WHIPPED || f.state === S.AIRBORNE || f.state === S.HITSTUN)) {
        setState(f, S.CORNER_STUN, 1.4 / f.c.recoverySpeed);
        f.vx = f.vz = 0; f.mash = 0;
        w.combat.applyEnvDamage(f, 30, 'turnbuckle');
        w.emit('turnbuckle_hit', { fighter: f.id, pos: { x: f.x, y: f.y + 1, z: f.z } });
        return;
      }
      if (speed > R.reboundSpeed && (f.state === S.WHIPPED || (f.state === S.MOVE && f.runTime > 0.2))) {
        const nx = contact.nx, nz = contact.nz;
        const dot = pre.vx * nx + pre.vz * nz;
        let rx = pre.vx - 2 * dot * nx, rz = pre.vz - 2 * dot * nz;
        const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        const whipped = f.state === S.WHIPPED;
        const spd = whipped ? f.lockDir.speed : f.c.runSpeed;
        setState(f, S.REBOUND, 0.2); f.sub = whipped ? 1 : 0;
        f.lockDir = { x: rx, z: rz, speed: spd };
        f.vx = rx * 1.5; f.vz = rz * 1.5;
        f.yaw = Math.atan2(rx, rz);
        w.emit('rope_bounce', { fighter: f.id, pos: { x: f.x, y: f.y + 1, z: f.z } });
      } else if (speed > 1.5) {
        w.emit('rope_touch', { fighter: f.id, speed, pos: { x: f.x, y: f.y + 1, z: f.z } });
      }
    } else if ((contact.kind === 'barricade' || contact.kind === 'cage' || contact.kind === 'desk' || contact.kind === 'apron') && speed > 4.2 &&
      (f.state === S.WHIPPED || f.state === S.AIRBORNE || f.state === S.HITSTUN)) {
      const dmg = contact.kind === 'cage' ? 55 : contact.kind === 'desk' ? 50 : 40;
      w.combat.applyEnvDamage(f, dmg, contact.kind);
      w.emit(contact.kind + '_hit', { fighter: f.id, pos: { x: f.x, y: f.y + 1, z: f.z }, speed });
      // thrown/whipped into the cell door (the +Z wall) → it breaks open
      if (contact.kind === 'cage' && !w.arena.cageDoorBroken && contact.nz < 0 && Math.abs(f.x) < (ARENA.cage.doorHalf ?? 1.0)) {
        w.arena.cageDoorBroken = true;
        w.emit('cage_door_break', { fighter: f.id, pos: { x: f.x, y: f.y + 1, z: f.z } });
      }
      if (f.state !== S.AIRBORNE) w.combat.knockDown(f, contact.nx * 1.5, 2, contact.nz * 1.5);
      else { f.vx = contact.nx * 1.5; f.vz = contact.nz * 1.5; }
    }
  }
}
