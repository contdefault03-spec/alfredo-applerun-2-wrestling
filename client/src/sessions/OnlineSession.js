// OnlineSession – client side of an authoritative server match.
//  • remote entities: snapshot interpolation (render ~100 ms in the past)
//  • local wrestler: client-side prediction of movement + reconciliation
//    against the server's acknowledged input sequence
//  • events are released when the render clock reaches their timestamp
import { decodeFighter, decodeItem, decodeReferee, decodeMatch, clientFighter } from '@shared/net/protocol.js';
import { stepLocomotion, integrate } from '@shared/sim/FighterController.js';
import { Arena } from '@shared/sim/Arena.js';
import { DT, S } from '@shared/sim/constants.js';
import { ABILITIES } from '@shared/config/abilities.js';

const INTERP = 0.1;
const FREE = new Set([S.IDLE, S.MOVE, S.BLOCK]);

export class OnlineSession {
  constructor(net, start) {
    this.online = true;
    this.net = net;
    this.localId = start.you;
    this.rules = start.rules;
    this.arena = new Arena({ cage: !!start.rules.cage });
    this.fighters = start.roster.map(clientFighter);
    this.byId = new Map(this.fighters.map((f) => [f.id, f]));
    this.snaps = [];
    this.events = []; this.pendingEvents = [];
    this.serverTime = 0; this.clockBase = null;
    this.seq = 0; this.inputs = []; this.acc = 0;
    this.pred = null; this.renderPos = null; this.lastView = performance.now();
    this.items = []; this.referee = { x: 0, y: 1.2, z: 0, yaw: 0, state: 'watch', count: 0 };
    this.match = { phase: 'intro', timeLeft: start.rules.timeLimit, winners: [] };
    this.ringCells = [];
    this.off = [net.on('snap', (m) => this.onSnap(m)), net.on('end', (m) => { this.endInfo = m; })];
  }

  onSnap(m) {
    const now = performance.now() / 1000;
    const snap = { time: m.time, recv: now, f: new Map(m.f.map((a) => [a[0], decodeFighter(a)])), items: m.i.map(decodeItem), ref: decodeReferee(m.r), match: decodeMatch(m.m) };
    this.snaps.push(snap);
    if (this.snaps.length > 30) this.snaps.shift();
    // clock sync: estimate server time = snapshot time + elapsed since receipt (smoothed)
    const est = m.time - now;
    this.clockBase = this.clockBase == null ? est : Math.max(this.clockBase + (est - this.clockBase) * 0.05, est - 0.25);
    for (const e of m.ev || []) this.pendingEvents.push(e);
    this.match = snap.match;
    if (m.rd) this.ringCells = m.rd;
    this.arena.cageDoorBroken = !!m.cd;
    this.reconcile(snap.f.get(this.localId), m.ack?.seq || 0);
  }

  reconcile(server, ack) {
    if (!server) return;
    const me = this.byId.get(this.localId);
    const p = Object.assign(this.pred || { c: me.c, input: {} }, server);
    p.c = me.c;
    this.inputs = this.inputs.filter((i) => i.seq > ack);
    if (FREE.has(p.state)) for (const i of this.inputs) this.predictStep(p, i.input);
    this.pred = p;
  }

  predictStep(p, input) {
    if (!FREE.has(p.state)) { p.x += p.vx * DT; p.z += p.vz * DT; return; }
    const target = p.target != null ? this.byId.get(p.target) : null;
    stepLocomotion(p, input, DT, this.arena, target);
    integrate(p, DT, this.arena);
  }

  update(dt, input) {
    // fixed-rate input + prediction (60 Hz)
    this.acc += Math.min(dt, 0.1);
    let pressed = input.pressed; input.pressed = 0;
    while (this.acc >= DT) {
      this.acc -= DT;
      const inp = { mx: input.mx, mz: input.mz, held: input.held, pressed };
      this.seq++;
      this.net.send({ t: 'input', seq: this.seq, mx: +inp.mx.toFixed(3), mz: +inp.mz.toFixed(3), held: inp.held, pressed: inp.pressed });
      pressed = 0;
      this.inputs.push({ seq: this.seq, input: inp });
      if (this.inputs.length > 120) this.inputs.shift();
      if (this.pred) this.predictStep(this.pred, inp);
    }
    if (pressed) input.pressed = pressed; // not sent yet – keep for next tick
    // release events whose time has come
    const rt = this.renderTime();
    const due = [], keep = [];
    for (const e of this.pendingEvents) (e.t <= rt + 0.02 || e.fighter === this.localId || e.attacker === this.localId ? due : keep).push(e);
    this.pendingEvents = keep; this.events.push(...due);
  }

  renderTime() { return this.clockBase == null ? 0 : performance.now() / 1000 + this.clockBase - INTERP; }
  takeEvents() { const e = this.events; this.events = []; return e; }

  view() {
    const rt = this.renderTime();
    const S_ = this.snaps;
    let a = null, b = null;
    for (let i = S_.length - 1; i >= 0; i--) { if (S_[i].time <= rt) { a = S_[i]; b = S_[i + 1] || null; break; } }
    if (!a) { a = S_[0]; b = null; }
    const out = [];
    const latest = S_[S_.length - 1];
    if (!a) return { fighters: this.fighters, items: [], referee: this.referee, match: this.match, ring: this.ringCells, cageDoor: this.arena.cageDoorBroken, rules: this.rules, localId: this.localId, time: 0 };
    const u = b ? Math.min(1, Math.max(0, (rt - a.time) / (b.time - a.time))) : 0;
    for (const f of this.fighters) {
      const fa = a.f.get(f.id), fb = b ? b.f.get(f.id) : null;
      if (!fa) continue;
      Object.assign(f, fa);
      if (fb) {
        f.x = fa.x + (fb.x - fa.x) * u; f.y = fa.y + (fb.y - fa.y) * u; f.z = fa.z + (fb.z - fa.z) * u;
        let dy = fb.yaw - fa.yaw; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
        f.yaw = fa.yaw + dy * u;
        if (fb.state === fa.state) f.stateTime = fa.stateTime + (fb.stateTime - fa.stateTime) * u; else f.stateTime = fa.stateTime + (rt - a.time);
      }
      if (f.id === this.localId && latest) {
        // own wrestler: freshest server state + predicted position
        const ls = latest.f.get(f.id);
        Object.assign(f, ls);
        f.stateTime = ls.stateTime + Math.max(0, performance.now() / 1000 - latest.recv);
        if (this.pred) {
          // render position eases toward the prediction (hides reconciliation snaps; time-based so it is frame-rate independent)
          const now = performance.now(), dtv = Math.min(0.25, (now - this.lastView) / 1000); this.lastView = now;
          const rp = this.renderPos || (this.renderPos = { x: this.pred.x, y: this.pred.y, z: this.pred.z });
          const k = 1 - Math.exp(-dtv * 18);
          if (Math.hypot(this.pred.x - rp.x, this.pred.z - rp.z) > 2.5) { rp.x = this.pred.x; rp.z = this.pred.z; }
          rp.x += (this.pred.x - rp.x) * k; rp.y += (this.pred.y - rp.y) * k; rp.z += (this.pred.z - rp.z) * k;
          f.x = rp.x; f.y = rp.y; f.z = rp.z;
          if (FREE.has(ls.state)) f.yaw = this.pred.yaw; f.vx = this.pred.vx; f.vz = this.pred.vz;
        }
      }
      const it = f.item != null ? (latest?.items.find((i) => i.id === f.item)) : null;
      f.itemType = it ? it.type : null;
      out.push(f);
    }
    // items: interpolate positions
    const items = a.items.map((ia) => {
      const ib = b?.items.find((x) => x.id === ia.id);
      if (!ib) return ia;
      return { ...ia, x: ia.x + (ib.x - ia.x) * u, y: ia.y + (ib.y - ia.y) * u, z: ia.z + (ib.z - ia.z) * u, roll: ia.roll + (ib.roll - ia.roll) * u, yaw: ib.yaw };
    });
    const ra = a.ref, rb = b?.ref;
    const referee = rb ? { ...ra, x: ra.x + (rb.x - ra.x) * u, y: ra.y + (rb.y - ra.y) * u, z: ra.z + (rb.z - ra.z) * u, yaw: rb.yaw } : ra;
    return { fighters: out, items, referee, match: this.match, ring: this.ringCells, cageDoor: this.arena.cageDoorBroken, rules: this.rules, localId: this.localId, time: rt };
  }

  abilityStatus(f) {
    const ab = ABILITIES[f.c.special];
    if (!ab) return { ready: false };
    if (f.specialCd > 0) return { ready: false, reason: 'cooldown', cd: f.specialCd };
    if (f.meter < f.c.specialCost) return { ready: false, reason: 'meter' };
    if (ab.maxRange) {
      const t = f.target != null ? this.byId.get(f.target) : null;
      const d = t ? Math.hypot(t.x - f.x, t.z - f.z) : 99;
      if (!t || d > ab.maxRange || d < (ab.minRange ?? 0)) return { ready: false, reason: 'range' };
    }
    return { ready: true };
  }

  dispose() { this.off.forEach((f) => f()); }
}
