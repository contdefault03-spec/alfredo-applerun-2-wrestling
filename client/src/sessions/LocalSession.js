// LocalSession – single player / vs AI. The full simulation runs in the
// browser at a fixed 60 Hz; the renderer interpolates between steps.
import { World } from '@shared/sim/World.js';
import { DT } from '@shared/sim/constants.js';

export class LocalSession {
  constructor(config, localFighterId) {
    this.online = false;
    this.world = new World(config);
    this.localId = localFighterId;
    this.acc = 0;
    this.prev = new Map();
    this.events = [];
    this.paused = false;
  }
  get rules() { return this.world.rules; }
  get fighters() { return this.world.fighters; }

  update(dt, input) {
    if (this.paused) return;
    this.acc += Math.min(dt, 0.1);
    const me = this.world.byId(this.localId);
    while (this.acc >= DT) {
      this.acc -= DT;
      for (const f of this.world.fighters) this.prev.set(f.id, [f.x, f.y, f.z, f.yaw]);
      if (me && !me.isAI) {
        me.input.mx = input.mx; me.input.mz = input.mz; me.input.held = input.held;
        me.input.pressed |= input.pressed; input.pressed = 0;
      }
      this.world.step(DT);
      this.events.push(...this.world.takeEvents());
    }
  }

  takeEvents() { const e = this.events; this.events = []; return e; }

  /** Render view: fighters with positions interpolated between sim steps. */
  view() {
    const a = this.acc / DT;
    const w = this.world;
    const fighters = w.fighters.map((f) => {
      const p = this.prev.get(f.id);
      const v = Object.create(f);
      if (p) {
        v.x = p[0] + (f.x - p[0]) * a; v.y = p[1] + (f.y - p[1]) * a; v.z = p[2] + (f.z - p[2]) * a;
        let dy = f.yaw - p[3]; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
        v.yaw = p[3] + dy * a;
      }
      const it = f.item != null ? w.items.get(f.item) : null;
      v.itemType = it ? it.type : null;
      return v;
    });
    return { fighters, items: w.items.items, referee: w.match.referee, match: w.match, ring: w.ring.encode(), cageDoor: w.arena.cageDoorBroken, rules: w.rules, localId: this.localId, time: w.time };
  }

  abilityStatus(f) { return this.world.abilities.status(f); }
  dispose() {}
}
