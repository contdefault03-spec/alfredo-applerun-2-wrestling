// Room – a lobby + (when started) an authoritative match.
// The server owns the World; clients only send inputs.
import { World } from '../shared/sim/World.js';
import { DT, SNAPSHOT_RATE, TICK_RATE } from '../shared/sim/constants.js';
import { snapshot, roster } from '../shared/net/protocol.js';
import { GAME_MODES } from '../shared/config/gameModes.js';
import { CHARACTER_IDS } from '../shared/config/characters.js';
import { AI_DIFFICULTY } from '../shared/config/ai.js';
import { CommentaryEngine } from '../shared/commentary/CommentaryEngine.js';

const MAX_PLAYERS = 6;
const SNAP_EVERY = Math.round(TICK_RATE / SNAPSHOT_RATE);

export class Room {
  constructor(code, { isPublic = false, commentary = null, log = console } = {}) {
    this.code = code; this.isPublic = isPublic;
    this.players = new Map();   // playerId -> { id, name, charId, team, ready, ws, fighterId, lastSeq }
    this.ai = [];               // [{ charId, difficulty, team }]
    this.hostId = null;
    this.mode = 'normal';
    this.state = 'lobby';
    this.world = null;
    this.timer = null;
    this.createdAt = Date.now(); this.lastActive = Date.now();
    this.commentaryProvider = commentary;
    this.log = log;
  }

  get size() { return this.players.size; }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }
  send(p, msg) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }

  info() {
    return {
      code: this.code, hostId: this.hostId, mode: this.mode, state: this.state, public: this.isPublic,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, charId: p.charId, team: p.team, ready: p.ready, isHost: p.id === this.hostId })),
      ai: this.ai, maxPlayers: MAX_PLAYERS,
    };
  }
  pushState() { this.broadcast({ t: 'room', room: this.info() }); }

  addPlayer(p) {
    if (this.players.size >= MAX_PLAYERS) return 'Room is full';
    if (this.state !== 'lobby') return 'Match already in progress';
    p.charId = p.charId || CHARACTER_IDS[this.players.size % CHARACTER_IDS.length];
    p.team = this.nextTeam(); p.ready = false;
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.lastActive = Date.now();
    this.pushState();
    return null;
  }

  nextTeam() {
    const used = [...this.players.values()].map((p) => p.team).concat(this.ai.map((a) => a.team));
    for (let t = 0; t < 6; t++) if (!used.includes(t)) return t;
    return 0;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    this.players.delete(id);
    if (this.hostId === id) this.hostId = this.players.keys().next().value ?? null;
    if (this.world && p?.fighterId != null) {
      // hand the wrestler to the AI so the match can continue
      const f = this.world.byId(p.fighterId);
      if (f && !f.eliminated) { f.isAI = true; f.difficulty = 'normal'; f.ownerId = null; f.name = f.name + ' (AI)'; }
    }
    if (this.players.size === 0) this.stopMatch();
    else this.pushState();
  }

  handle(p, msg) {
    this.lastActive = Date.now();
    const isHost = p.id === this.hostId;
    switch (msg.t) {
      case 'char': if (CHARACTER_IDS.includes(msg.charId) && this.state === 'lobby') { p.charId = msg.charId; p.ready = false; this.pushState(); } break;
      case 'ready': p.ready = !!msg.ready; this.pushState(); break;
      case 'team': {
        const target = msg.playerId && isHost ? this.players.get(msg.playerId) : p;
        if (target && Number.isInteger(msg.team) && msg.team >= 0 && msg.team < 6) { target.team = msg.team; this.pushState(); }
        break;
      }
      case 'mode': if (isHost && GAME_MODES[msg.mode] && this.state === 'lobby') { this.mode = msg.mode; this.autoTeams(); this.pushState(); } break;
      case 'addAI':
        if (isHost && this.state === 'lobby' && this.players.size + this.ai.length < MAX_PLAYERS && CHARACTER_IDS.includes(msg.charId)) {
          this.ai.push({ charId: msg.charId, difficulty: AI_DIFFICULTY[msg.difficulty] ? msg.difficulty : 'normal', team: Number.isInteger(msg.team) ? msg.team : this.nextTeam() });
          this.pushState();
        }
        break;
      case 'aiTeam': if (isHost && this.ai[msg.index] && Number.isInteger(msg.team)) { this.ai[msg.index].team = msg.team; this.pushState(); } break;
      case 'removeAI': if (isHost && this.state === 'lobby') { this.ai.splice(msg.index | 0, 1); this.pushState(); } break;
      case 'start': if (isHost) { const err = this.startMatch(); if (err) this.send(p, { t: 'error', message: err }); } break;
      case 'backToLobby': if (isHost && this.state !== 'lobby') { this.stopMatch(); this.pushState(); } break;
      case 'skipEntrance': if (this.world && p.fighterId != null) this.world.match.voteSkipEntrance(p.fighterId); break;
      case 'input': {
        if (!this.world || p.fighterId == null) break;
        const f = this.world.byId(p.fighterId);
        if (!f || f.isAI) break;
        const mx = Number(msg.mx) || 0, mz = Number(msg.mz) || 0;
        const len = Math.hypot(mx, mz);
        f.input.mx = len > 1 ? mx / len : mx; f.input.mz = len > 1 ? mz / len : mz;
        f.input.held = (msg.held | 0) & 0x7ff;
        f.input.pressed |= (msg.pressed | 0) & 0x7ff;
        p.lastSeq = msg.seq | 0;
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 140);
        if (text) this.broadcast({ t: 'chat', from: p.name, text });
        break;
      }
    }
  }

  autoTeams() {
    const m = GAME_MODES[this.mode];
    const all = [...this.players.values(), ...this.ai];
    if (m.teams === 'solo') all.forEach((x, i) => { x.team = i; });
    if (m.teams === 'two') all.forEach((x, i) => { x.team = i % 2; });
  }

  startMatch() {
    if (this.state === 'match') return 'Already started';
    const m = GAME_MODES[this.mode];
    const entrants = [...this.players.values()].map((p) => ({ charId: p.charId, team: p.team, name: p.name, isAI: false, ownerId: p.id, player: p }))
      .concat(this.ai.map((a, i) => ({ charId: a.charId, team: a.team, difficulty: a.difficulty, isAI: true, name: undefined })));
    if (entrants.length < m.minFighters) return `${m.name} needs at least ${m.minFighters} wrestlers (add AI opponents)`;
    if (entrants.length > m.maxFighters) return `${m.name} allows at most ${m.maxFighters} wrestlers`;
    if (m.teams === 'two') entrants.forEach((e, i) => { if (e.team > 1) e.team = i % 2; });
    const teams = new Set(entrants.map((e) => e.team));
    if (teams.size < 2) return 'Put at least two different teams in the match';
    this.world = new World({ mode: this.mode, entrances: true, fighters: entrants.map(({ player, ...e }) => e) });
    entrants.forEach((e, i) => { if (e.player) { e.player.fighterId = this.world.fighters[i].id; e.player.lastSeq = 0; } });
    this.state = 'match';
    this.commentary = new CommentaryEngine({
      nameOf: (id) => this.world?.byId(id)?.name ?? 'someone', charOf: (id) => this.world?.byId(id)?.charId ?? null, mode: this.mode,
    });
    const r = roster(this.world);
    for (const p of this.players.values()) this.send(p, { t: 'start', roster: r, mode: this.mode, rules: this.world.rules, you: p.fighterId, code: this.code });
    this.pushState();
    this.pending = [];
    this.tickCount = 0;
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= DT) { acc -= DT; this.step(); }
    }, 1000 / TICK_RATE);
    this.log.info?.(`[room ${this.code}] match started: ${this.mode} with ${entrants.length} wrestlers`);
    return null;
  }

  step() {
    const w = this.world; if (!w) return;
    w.step(DT);
    const ev = w.takeEvents();
    this.pending.push(...ev);
    // server-side commentary → broadcast (optionally AI-generated)
    const moments = this.commentary.update(DT, ev);
    for (const m of moments) this.deliverCommentary(m);
    this.tickCount++;
    if (this.tickCount % SNAP_EVERY === 0) {
      const events = this.pending; this.pending = [];
      for (const p of this.players.values()) {
        if (p.ws.readyState !== 1) continue;
        p.ws.send(JSON.stringify(snapshot(w, events, { seq: p.lastSeq, id: p.fighterId })));
      }
    }
    if (w.match.phase === 'over' && !this.overAt) {
      this.overAt = Date.now();
      this.broadcast({ t: 'end', winnerTeam: w.match.winnerTeam, winners: w.match.winners, method: w.match.method,
        stats: w.fighters.map((f) => ({ id: f.id, name: f.name, charId: f.charId, team: f.team, damage: f.stats.damage, hits: f.stats.hits, specials: f.stats.specials, hp: f.hp })) });
      setTimeout(() => { if (this.state === 'match') { this.stopMatch(); this.pushState(); } }, 12000);
    }
  }

  async deliverCommentary(m) {
    let text = m.text;
    if (this.commentaryProvider?.enabled) {
      const ai = await this.commentaryProvider.generate({ key: m.key, ctx: m.ctx, speaker: m.speaker?.id }, 'room:' + this.code).catch(() => null);
      if (ai) text = ai;
    }
    this.broadcast({ t: 'commentary', key: m.key, text, speaker: m.speaker?.id, priority: m.priority });
  }

  stopMatch() {
    clearInterval(this.timer); this.timer = null;
    this.world = null; this.state = 'lobby'; this.overAt = null;
    for (const p of this.players.values()) { p.fighterId = null; p.ready = false; }
  }
}
