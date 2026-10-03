// GrappleSystem – grabs, holds, escapes, reversals, slams, throws, Irish whips.
import { ATTACKS } from '../config/attacks.js';
import { ARENA } from '../config/arena.js';
import { BTN, S, ZONE, DOWN_STATES, RING_BREAK_CHANCE } from './constants.js';
import { setState, forwardOf, dist2D, scaleOf, angleTo, turnToward, hpFrac } from './Fighter.js';
import { moveId } from './FighterController.js';

const R = ARENA.ring;
const GRAB_TIME = 0.42, GRAB_ACTIVE = [0.08, 0.26];
const HOLD_MAX = 3.2, REVERSAL_WINDOW = 0.32, ESCAPE_NEEDED = 7;

function lerpPath(path, t) {
  if (t <= path[0][0]) return path[0];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0]);
      const e = u * u * (3 - 2 * u);
      return a.map((v, k) => v + (b[k] - v) * e);
    }
  }
  return path[path.length - 1];
}

export class GrappleSystem {
  constructor(world) { this.world = world; }

  startGrab(f, tgt) {
    setState(f, S.GRAB, GRAB_TIME / Math.sqrt(f.c.attackSpeed));
    if (tgt && dist2D(f, tgt) < 3) turnToward(f, angleTo(f, tgt.x, tgt.z), 0.9);
    f.stamina -= 6;
    this.world.emit('grab_attempt', { fighter: f.id });
  }

  grabbable(v) {
    return [S.IDLE, S.MOVE, S.BLOCK, S.HITSTUN, S.ATTACK, S.TAUNT, S.CORNER_STUN, S.DOWN, S.WHIPPED, S.REBOUND, S.PARRIED, S.GETUP].includes(v.state) && v.invuln <= 0;
  }

  grabUpdate(f, dt) {
    const w = this.world;
    const fw = forwardOf(f);
    const t = f.stateTime;
    if (t < GRAB_ACTIVE[1]) { f.vx = fw.x * 2.4; f.vz = fw.z * 2.4; }
    if (t >= GRAB_ACTIVE[0] && t <= GRAB_ACTIVE[1]) {
      const reach = f.c.radius + 0.55 * Math.max(0.85, scaleOf(f));
      for (const v of w.fighters) {
        if (!w.combat.enemies(f, v) || v.zone !== f.zone || Math.abs(v.y - f.y) > 0.6) continue;
        const dx = v.x - f.x, dz = v.z - f.z, d = Math.hypot(dx, dz);
        if (d > reach + v.c.radius) continue;
        if ((dx * fw.x + dz * fw.z) / (d || 1) < 0.35) continue;
        if (!this.grabbable(v)) continue;
        if (v.state === S.GRAB) { // clash
          setState(f, S.HITSTUN, 0.4); setState(v, S.HITSTUN, 0.4);
          w.emit('grab_clash', { a: f.id, b: v.id });
          return;
        }
        if (v.state === S.ATTACK && v.armor > 0) continue;
        this.link(f, v);
        return;
      }
    }
    if (t >= f.stateDur) { setState(f, S.IDLE); w.emit('whiff', { fighter: f.id }); }
  }

  link(f, v) {
    const w = this.world;
    if (v.item != null) w.items.drop(v, true);
    if (f.item != null) w.items.drop(f);
    const pickedUp = DOWN_STATES.has(v.state);
    setState(f, S.HOLD); setState(v, S.HELD);
    f.holding = v.id; v.heldBy = f.id; f.gstrikes = 0; v.mash = 0; v.input.pressed = 0;
    v.yaw = f.yaw + Math.PI;
    w.emit('grab', { fighter: f.id, victim: v.id, pickedUp });
  }

  /** Release any grapple involving fighter x (called when x is hit, KO'd…). */
  breakFor(x) {
    const w = this.world;
    if (x.holding != null) {
      const v = w.byId(x.holding); x.holding = null;
      if (v) { v.heldBy = null; if (v.state === S.HELD || v.state === S.GRAPPLE_VICTIM) { setState(v, S.HITSTUN, 0.3); v.y = w.arena.groundFor(v.zone); } }
      if (x.state === S.HOLD || x.state === S.GRAPPLE_MOVE) setState(x, S.IDLE);
    }
    if (x.heldBy != null) {
      const g = w.byId(x.heldBy); x.heldBy = null;
      if (g) { g.holding = null; if (g.state === S.HOLD || g.state === S.GRAPPLE_MOVE) setState(g, S.IDLE); }
      if (x.state === S.HELD || x.state === S.GRAPPLE_VICTIM) setState(x, S.IDLE);
    }
  }

  placeVictim(f, v, fwd, up, side) {
    const fw = forwardOf(f);
    const sc = scaleOf(f);
    v.x = f.x + fw.x * fwd * sc + fw.z * side * sc;
    v.z = f.z + fw.z * fwd * sc - fw.x * side * sc;
    v.y = f.y + up * sc;
    v.vx = v.vy = v.vz = 0;
    v.zone = f.zone;
  }

  holdUpdate(f, dt) {
    const w = this.world;
    const v = w.byId(f.holding);
    if (!v || v.state !== S.HELD) { f.holding = null; setState(f, S.IDLE); return; }
    const inp = f.input;
    // carry / drag the opponent around (slower than a free walk); stand still mid-strike
    const moving = f.sub !== 1 && Math.hypot(inp.mx, inp.mz) > 0.2;
    if (moving) {
      const sp = (f.c.walkSpeed || 2.6) * 0.55;
      f.vx = inp.mx * sp; f.vz = inp.mz * sp;
      f.yaw = Math.atan2(inp.mx, inp.mz);
    } else { f.vx *= 0.5; f.vz *= 0.5; }
    const gap = (f.c.radius + v.c.radius) * 0.78;
    const fw = forwardOf(f);
    v.x = f.x + fw.x * gap; v.z = f.z + fw.z * gap; v.y = f.y; v.yaw = f.yaw + Math.PI; v.vx = v.vy = v.vz = 0;
    v.zone = f.zone; v.outside = f.outside;   // the carried opponent comes along to wherever we drag them
    // grapple strike in progress
    if (f.sub === 1) {
      if (f.stateTime - f.gstrikeAt > 0.18 && !f.gstrikeHit) {
        f.gstrikeHit = true;
        const m = ATTACKS[moveId(f, 'grappleStrike')];
        const dmg = Math.round(m.damage * f.c.attackPower * (1 - v.c.defense));
        v.hp = Math.max(1, v.hp - dmg); f.meter = Math.min(100, f.meter + dmg * 0.09);
        f.stats.damage += dmg; v.mash = Math.max(0, v.mash - 2);
        w.emit('hit', { attacker: f.id, victim: v.id, damage: dmg, move: m.id, moveName: m.name, sound: 'heavy', reaction: 'flinch', pos: { x: v.x, y: v.y + v.c.height * 0.85, z: v.z }, crowd: 0.15 });
      }
      if (f.stateTime - f.gstrikeAt > 0.45) f.sub = 0;
      return;
    }
    const p = f.input.pressed;
    if (f.stateTime > HOLD_MAX && !moving) { this.separate(f, v); return; }
    if (p & BTN.SPECIAL && w.abilities.tryGrappleSpecial(f, v)) return;
    if (p & BTN.PUNCH && f.gstrikes < 3) { f.sub = 1; f.gstrikeAt = f.stateTime; f.gstrikeHit = false; f.gstrikes++; w.emit('attack', { fighter: f.id, move: 'grapple_strike' }); return; }
    if (p & BTN.KICK) { this.startMove(f, v, this.pickSlam(f, v)); return; }
    if (p & (BTN.GRAB | BTN.THROW)) { this.startThrow(f, v); return; }
    if (p & BTN.BLOCK) { this.separate(f, v); return; }
  }

  pickSlam(f, v) {
    const inp = f.input; const fw = forwardOf(f);
    const back = (inp.mx * fw.x + inp.mz * fw.z) < -0.4;
    const heavy = f.c.weight >= 150 || f.c.grabStrength >= 1.6;
    let id = back ? moveId(f, 'slamAlt') : heavy ? moveId(f, 'slamHeavy') : moveId(f, 'slam');
    const m = ATTACKS[id];
    const liftPower = f.c.weight * f.c.grabStrength * (m.liftRatio ?? 1.2);
    if (liftPower < v.c.weight) id = 'takedown';
    return id;
  }

  heldUpdate(v, dt) {
    const w = this.world;
    const g = w.byId(v.heldBy);
    if (!g || (g.state !== S.HOLD && g.state !== S.THROWING)) { v.heldBy = null; setState(v, S.IDLE); return; }
    if (g.state === S.THROWING) return; // being thrown – no escaping now
    // reversal
    if (v.input.pressed & BTN.BLOCK && v.stateTime < REVERSAL_WINDOW && g.c.grabStrength < v.c.grabStrength * 1.8 && !v.reversalUsed) {
      v.reversalUsed = true;
      this.breakFor(v);
      this.link(v, g);
      w.emit('reversal', { fighter: v.id, victim: g.id });
      return;
    }
    if (v.stateTime > REVERSAL_WINDOW) v.reversalUsed = false;
    const esc = v.mash * Math.sqrt(v.c.grabStrength / g.c.grabStrength);
    if (esc >= ESCAPE_NEEDED) { this.separate(g, v); w.emit('escape', { fighter: v.id, from: g.id }); }
  }

  separate(g, v) {
    const fw = forwardOf(g);
    this.breakFor(g);
    setState(g, S.HITSTUN, 0.35); setState(v, S.HITSTUN, 0.3);
    g.vx = -fw.x * 2.5; g.vz = -fw.z * 2.5; v.vx = fw.x * 2.5; v.vz = fw.z * 2.5;
  }

  startMove(f, v, id) {
    const w = this.world;
    if (id === 'takedown') {
      // can't lift this one – quick leg-sweep takedown instead
      setState(f, S.ATTACK, 0.55, 'takedown');
      f.holding = null; v.heldBy = null;
      w.combat.applyHit(f, v, { damage: 55, knockback: 1.5, launch: 1.5, reaction: 'knockdown', unblockable: true, sound: 'slam', move: 'takedown', moveName: 'Takedown', crowd: 0.3, hitstop: 0.05 });
      return;
    }
    const m = ATTACKS[id];
    setState(f, S.GRAPPLE_MOVE, m.duration / Math.sqrt(f.c.attackSpeed), id);
    setState(v, S.GRAPPLE_VICTIM, 0, id);
    f.moveSpecial = null;
    w.emit('grapple_move', { fighter: f.id, victim: v.id, move: id, name: m.name });
  }

  moveUpdate(f, dt) {
    const w = this.world;
    const v = w.byId(f.holding);
    const m = ATTACKS[f.move];
    f.vx = f.vz = 0;
    const tn = f.stateTime / f.stateDur * m.duration; // path time in move units
    if (v && v.state === S.GRAPPLE_VICTIM) {
      const p = lerpPath(m.victim, tn);
      this.placeVictim(f, v, p[1] * (0.5 + 0.5 * (f.c.radius + v.c.radius) / 0.66), p[2], p[3]);
      v.tilt = p[4];
      v.yaw = f.yaw + Math.PI;
      if (tn >= m.impact && !f.moveImpact) {
        f.moveImpact = true;
        const ground = w.arena.groundFor(f.zone);
        v.y = ground;
        const dmg0 = f.moveSpecial?.damage ?? m.damage;
        const dmg = Math.round(dmg0 * f.c.attackPower * (1 - v.c.defense));
        v.hp = Math.max(0, v.hp - dmg);
        v.lastHitBy = f.id; v.lastHitTime = w.time;
        f.stats.damage += dmg; f.meter = Math.min(100, f.meter + dmg * 0.09); v.meter = Math.min(100, v.meter + dmg * 0.05);
        const pos = { x: v.x, y: ground, z: v.z };
        w.emit('slam', { attacker: f.id, victim: v.id, damage: dmg, move: m.id, moveName: f.moveSpecial?.name ?? m.name, pos, special: !!f.moveSpecial, crowd: m.crowd ?? 0.6 });
        if (v.zone === ZONE.RING) {
          // progressive collapse: every slam loads the canvas by force (damage × slammer weight),
          // cracking the section it lands on and shaking the ones around it; a special can still
          // smash straight through on the rare roll.
          const force = (dmg / 40) * (0.6 + f.c.weight / 160);
          w.ring?.registerImpact(pos.x, pos.z, force);
          if (f.moveSpecial) w.ring?.breakChance(pos.x, pos.z, RING_BREAK_CHANCE);
        }
        w.emit('hit', { attacker: f.id, victim: v.id, damage: dmg, move: m.id, moveName: f.moveSpecial?.name ?? m.name, sound: 'slam', reaction: 'knockdown', pos, heavy: true, special: !!f.moveSpecial, crowd: m.crowd ?? 0.6 });
        if (f.moveSpecial) w.emit('special_hit', { fighter: f.id, victim: v.id, ability: f.moveSpecial.id, name: f.moveSpecial.name, pos, damage: dmg });
        w.items.checkTableBreak(v, 12);
        // victim now lying down
        f.holding = null; v.heldBy = null;
        setState(v, S.DOWN); v.downTimer = (f.moveSpecial ? 6.5 : 5 + (1 - hpFrac(v)) * 2) / v.c.recoverySpeed; v.mash = 0; v.tilt = 0;
        if (v.hp <= 0) w.combat.knockOut(v, f);
      }
    }
    if (f.stateTime >= f.stateDur) { f.moveImpact = false; f.moveSpecial = null; setState(f, S.IDLE); }
  }

  startThrow(f, v) {
    const w = this.world;
    const inp = f.input;
    let dx = inp.mx, dz = inp.mz;
    const m0 = Math.hypot(dx, dz);
    const fw = forwardOf(f);
    if (m0 < 0.3) { dx = fw.x; dz = fw.z; } else { dx /= m0; dz /= m0; }
    const heavy = f.c.weight >= 150;
    const id = heavy ? 'heavy_throw' : 'irish_whip';
    const m = ATTACKS[id];
    setState(f, S.THROWING, m.duration, id);
    f.throwDir = { x: dx, z: dz };
    f.yaw = Math.atan2(dx, dz);
  }

  throwUpdate(f, dt) {
    const w = this.world;
    const m = ATTACKS[f.move];
    const v = f.holding != null ? w.byId(f.holding) : null;
    f.vx = f.vz = 0;
    if (v && v.state === S.HELD) {
      const fw = forwardOf(f);
      const gap = (f.c.radius + v.c.radius) * 0.8;
      v.x = f.x + fw.x * gap; v.z = f.z + fw.z * gap;
      if (f.stateTime >= m.release) {
        this.breakFor(f);
        const d = f.throwDir;
        const power = Math.min(1.6, Math.pow((f.c.weight * f.c.grabStrength) / v.c.weight, 0.35));
        const nearRopes = f.zone === ZONE.RING && w.arena.ropeGap(f.x + d.x * 1.2, f.z + d.z * 1.2) < 0.4;
        if (m.id === 'heavy_throw' || nearRopes) {
          // launched – may fly over the top rope
          const sp = (m.speed ?? 9) * power * (nearRopes ? 1.15 : 1);
          w.combat.knockDown(v, d.x * sp, (m.launch ?? 4) + (nearRopes ? 1.5 : 0), d.z * sp);
          if (m.damage) { v.lastHitBy = f.id; v.lastHitTime = w.time; w.combat.applyEnvDamage(v, m.damage, 'throw'); }
          w.emit('throw', { fighter: f.id, victim: v.id, heavy: true, pos: { x: v.x, y: v.y + 1, z: v.z } });
        } else {
          setState(v, S.WHIPPED);
          v.lockDir = { x: d.x, z: d.z, speed: Math.min(9.5, m.speed * power) };
          w.emit('irish_whip', { fighter: f.id, victim: v.id });
        }
      }
    }
    if (f.stateTime >= f.stateDur) setState(f, S.IDLE);
  }
}
