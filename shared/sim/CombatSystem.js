// CombatSystem – hitboxes vs hurt-capsules, blocking/parrying, damage,
// reactions and knockback. Also used by abilities, items and grapples.
import { ATTACKS } from '../config/attacks.js';
import { S, DOWN_STATES, INVULN_STATES, ZONE } from './constants.js';
import { setState, hurtCapsule, pointSegDist, scaleOf, forwardOf, hpFrac, wrapAngle } from './Fighter.js';

export const REACTION_TIME = { flinch: 0.28, stagger: 0.6 };

export class CombatSystem {
  constructor(world) { this.world = world; }

  /** Are a and b enemies (can hurt each other)? */
  enemies(a, b) {
    if (a === b || b.eliminated || b.hidden) return false;
    if (a.team === b.team && !this.world.rules.friendlyFire) return false;
    if (b.state === S.APRON) return false;
    return true;
  }

  /** Attack hitbox centre for fighter `f` using attack config `m`. */
  hitboxOf(f, m) {
    const sc = scaleOf(f);
    const fw = forwardOf(f);
    const reach = f.c.radius + (m.reach ?? 0.5) * sc;
    return { x: f.x + fw.x * reach, y: f.y + (m.height ?? 0.7) * f.c.height, z: f.z + fw.z * reach, r: (m.hitRadius ?? 0.3) * Math.max(0.8, sc) };
  }

  /** Sphere vs capsule overlap. */
  overlaps(hb, v) {
    const cap = hurtCapsule(v);
    return pointSegDist(hb.x, hb.y, hb.z, cap) < hb.r + cap.r;
  }

  /** Per-tick: resolve active attack hitboxes. */
  update() {
    const w = this.world;
    for (const a of w.fighters) {
      if (a.state !== S.ATTACK || a.hitstop > 0) continue;
      const m = ATTACKS[a.move];
      if (!m || m.noHitbox) continue;
      const sp = a.c.attackSpeed;
      const t0 = m.startup / sp, t1 = t0 + m.active;
      if (a.stateTime < t0 || a.stateTime > t1) continue;
      const hb = this.hitboxOf(a, m);
      for (const v of w.fighters) {
        if (!this.enemies(a, v) || a.moveHits.includes(v.id)) continue;
        if (Math.abs(v.y - a.y) > 2.5) continue;
        const down = DOWN_STATES.has(v.state) || (v.state === S.KNOCKDOWN && v.stateTime > 0.3);
        if (m.onlyDowned && !down) continue;
        if (down && !m.hitsDowned) continue;
        if (!this.overlaps(hb, v)) continue;
        a.moveHits.push(v.id);
        const dmg = m.type === 'item' ? this.world.items.weaponDamage(a, m) : m.damage;
        const fw = forwardOf(a);
        const landed = this.applyHit(a, v, {
          damage: dmg, knockback: m.knockback, launch: m.launch, reaction: m.reaction, stun: m.stun, hitstop: m.hitstop,
          sound: m.type === 'item' ? this.world.items.weaponSound(a) : this.soundFor(a, m), weapon: m.weapon || m.type === 'item', guardBreak: m.guardBreak,
          move: m.id, moveName: m.name, dirX: fw.x, dirZ: fw.z, crowd: m.crowd, pos: hb,
        });
        if (landed && m.type === 'item') this.world.items.onWeaponHit(a, v);
      }
    }
  }

  soundFor(a, m) {
    if (a.c.hands?.foodStrikes && m.sound === 'food') return 'food';
    return m.sound;
  }

  isBlocking(v, a) {
    if (v.state !== S.BLOCK) return false;
    const toA = Math.atan2(a.x - v.x, a.z - v.z);
    return Math.abs(wrapAngle(toA - v.yaw)) < 1.35;
  }

  /**
   * Apply a hit. Returns true if damage landed (not blocked/parried/avoided).
   * spec: { damage, knockback, launch, reaction, stun, hitstop, sound, weapon, guardBreak,
   *         unblockable, dirX, dirZ, downTime, special, move, moveName, crowd, pos }
   */
  applyHit(a, v, spec) {
    const w = this.world;
    if (v.invuln > 0 || INVULN_STATES.has(v.state) || v.eliminated) return false;
    if (v.state === S.DODGE && v.stateTime < v.c.dodgeDuration * 0.8) { w.emit('dodge_evade', { fighter: v.id, attacker: a.id }); return false; }
    const pos = spec.pos || { x: (a.x + v.x) / 2, y: v.y + v.c.height * 0.6, z: (a.z + v.z) / 2 };
    let dirX = spec.dirX ?? (v.x - a.x), dirZ = spec.dirZ ?? (v.z - a.z);
    const dl = Math.hypot(dirX, dirZ) || 1; dirX /= dl; dirZ /= dl;

    // ── block / parry ──
    if (!spec.unblockable && this.isBlocking(v, a)) {
      if (v.stateTime < 0.18 && !spec.special) {
        // PARRY → counter: attacker is left open
        setState(a, S.PARRIED, 0.75);
        a.vx = -dirX * 3; a.vz = -dirZ * 3;
        v.meter = Math.min(100, v.meter + 8);
        w.emit('parry', { fighter: v.id, attacker: a.id, pos });
        return false;
      }
      if (!spec.guardBreak) {
        const chip = Math.round(spec.damage * 0.12);
        v.hp = Math.max(1, v.hp - chip);
        v.stamina -= spec.damage * 0.25;
        const push = (spec.knockback ?? 2) * 0.5 * Math.sqrt(100 / v.c.weight);
        v.vx += dirX * push; v.vz += dirZ * push;
        a.hitstop = v.hitstop = 0.05;
        w.emit('block', { fighter: v.id, attacker: a.id, pos, sound: 'block' });
        if (v.stamina <= 0) { v.stamina = 0; setState(v, S.HITSTUN, 0.9); v.sub = 2; w.emit('guard_break', { fighter: v.id, pos }); }
        return false;
      }
      w.emit('guard_break', { fighter: v.id, pos });
    }

    // ── damage ──
    const wasHp = v.hp;
    let dmg = spec.damage * a.c.attackPower * (1 - v.c.defense);
    if (v.state === S.CAGE_CLIMB || v.state === S.PERCH) dmg *= 1.1;
    dmg = Math.max(1, Math.round(dmg));
    v.hp = Math.max(0, v.hp - dmg);
    v.lastHitBy = a.id; v.lastHitTime = w.time;
    a.stats.damage += dmg; a.stats.hits++;
    a.meter = Math.min(100, a.meter + dmg * 0.09);
    v.meter = Math.min(100, v.meter + dmg * 0.05);
    v.staminaDelay = 0.3;

    // release any grapple the victim was involved in
    w.grapple.breakFor(v);
    w.match.onFighterHit(v);

    // ── reaction ──
    let reaction = spec.reaction || 'flinch';
    const resist = v.c.knockbackResistance;
    const bigHit = dmg >= 140 || spec.special;
    if (resist >= 0.5 && !bigHit) {
      reaction = { flinch: 'none', stagger: 'flinch', knockdown: 'stagger', launch: 'knockdown' }[reaction] || reaction;
    }
    if (v.state === S.PERCH || v.state === S.CAGE_CLIMB) reaction = 'knockdown';
    if (v.armor > 0 && reaction !== 'knockdown' && reaction !== 'launch') reaction = 'none';
    const alreadyDown = DOWN_STATES.has(v.state) || v.state === S.KNOCKDOWN;
    if (alreadyDown) reaction = v.state === S.KO ? 'none' : 'downhit';

    const wf = Math.sqrt(100 / v.c.weight) * (1 - resist * 0.8) * Math.pow(a.c.weight / 100, 0.25);
    const kb = (spec.knockback ?? 1) * wf;
    const up = (spec.launch ?? 0) * Math.min(1.4, wf);
    const hs = spec.hitstop ?? 0.06;
    a.hitstop = Math.max(a.hitstop, hs); v.hitstop = Math.max(v.hitstop, hs);

    if (reaction === 'flinch' || reaction === 'stagger') {
      setState(v, S.HITSTUN, (spec.stun ?? REACTION_TIME[reaction]) / Math.sqrt(v.c.recoverySpeed));
      v.sub = reaction === 'stagger' ? 1 : 0;
      v.vx = dirX * kb; v.vz = dirZ * kb;
    } else if (reaction === 'knockdown' || reaction === 'launch') {
      this.knockDown(v, dirX * kb, up + (reaction === 'launch' ? 1.5 : 2.2), dirZ * kb, spec.downTime);
    } else if (reaction === 'downhit') {
      v.downTimer = Math.max(v.downTimer, 0.6);
    } else {
      // armored – keep going, small push
      v.vx += dirX * kb * 0.3; v.vz += dirZ * kb * 0.3;
    }
    if (v.item != null && (reaction === 'knockdown' || reaction === 'launch' || reaction === 'stagger')) w.items.drop(v, true);

    w.emit('hit', {
      attacker: a.id, victim: v.id, damage: dmg, move: spec.move, moveName: spec.moveName, sound: spec.sound,
      weapon: !!spec.weapon, reaction, pos: { x: pos.x, y: pos.y, z: pos.z }, heavy: dmg >= 80 || reaction === 'knockdown' || reaction === 'launch',
      special: !!spec.special, crowd: spec.crowd ?? 0.1,
    });

    // comeback: a badly hurt fighter drops a healthy one
    if (hpFrac(a) < 0.25 && wasHp / v.maxHp > 0.5 && (reaction === 'knockdown' || reaction === 'launch') && w.time - a.lastComeback > 20) {
      a.lastComeback = w.time;
      w.emit('comeback', { fighter: a.id, victim: v.id });
    }
    if (v.hp <= 0) this.knockOut(v, a);
    return true;
  }

  /** Damage from the environment (turnbuckles, barricades, cage, missed dives…). */
  applyEnvDamage(v, amount, kind) {
    if (v.eliminated || v.state === S.KO) return;
    const dmg = Math.round(amount * (1 - v.c.defense * 0.5));
    v.hp = Math.max(0, v.hp - dmg);
    const by = v.lastHitBy != null && this.world.time - v.lastHitTime < 4 ? this.world.byId(v.lastHitBy) : null;
    if (by) { by.stats.damage += dmg; by.meter = Math.min(100, by.meter + dmg * 0.06); }
    this.world.emit('env_damage', { fighter: v.id, damage: dmg, kind });
    if (v.hp <= 0) this.knockOut(v, by);
  }

  knockDown(v, vx, vy, vz, downTime) {
    setState(v, S.AIRBORNE, 0);
    v.vx = vx; v.vy = vy; v.vz = vz; v.onGround = false;
    v.downTimer = downTime ?? (1.5 + Math.random() * 0.4) / v.c.recoverySpeed;
    // fall on back when pushed away from the direction they face, else face-down
    const facing = Math.sin(v.yaw) * vx + Math.cos(v.yaw) * vz;
    v.sub = facing > 0 ? 1 : 0; // 1 = falls forward (face down)
    if (v.holding != null || v.heldBy != null) this.world.grapple.breakFor(v);
  }

  knockOut(v, by) {
    const w = this.world;
    if (v.state === S.KO) return;
    if (v.state !== S.AIRBORNE && v.state !== S.KNOCKDOWN) this.knockDown(v, 0, 1.5, 0, 999);
    v.downTimer = 999;
    v.koPending = true;
    w.emit('ko', { fighter: v.id, by: by?.id ?? null });
    w.match.onKO(v, by);
  }
}
