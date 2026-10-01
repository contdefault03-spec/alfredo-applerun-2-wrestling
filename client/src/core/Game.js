// Game – top-level orchestrator: boot, menus, match lifecycle (local and
// online), the frame loop and event → presentation (audio/effects/crowd/
// camera/HUD) wiring.
import * as THREE from 'three';
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '@shared/config/characters.js';
import { GAME_MODES } from '@shared/config/gameModes.js';
import { ABILITIES } from '@shared/config/abilities.js';
import { ITEMS } from '@shared/config/items.js';
import { ARENA } from '@shared/config/arena.js';
import { S, BTN } from '@shared/sim/constants.js';
import { Settings } from './Settings.js';
import { Input } from './Input.js';
import { AssetManager } from './AssetManager.js';
import { Renderer } from '../render/Renderer.js';
import { ArenaView } from '../render/ArenaBuilder.js';
import { CrowdSystem } from '../render/CrowdSystem.js';
import { FighterView } from '../render/FighterView.js';
import { ItemViews } from '../render/ItemViews.js';
import { Effects } from '../render/Effects.js';
import { Referee, Commentator } from '../render/NPCs.js';
import { ScreenDirector } from '../render/ScreenDirector.js';
import { CameraSystem } from '../camera/CameraSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { CommentarySystem } from '../commentary/CommentarySystem.js';
import { UIManager, TEAM_COLORS } from '../ui/UIManager.js';
import { LocalSession } from '../sessions/LocalSession.js';
import { OnlineSession } from '../sessions/OnlineSession.js';
import { NetClient } from '../net/NetClient.js';
import { makePortraits } from '../render/Portraits.js';

const HIT_SOUNDS = new Set(['punch', 'kick', 'heavy', 'metal', 'food', 'wood', 'slam', 'bell', 'plastic']);

export class Game {
  constructor(canvas, uiRoot) {
    this.settings = new Settings();
    this.renderer = new Renderer(canvas, this.settings.get().quality);
    this.scene = this.renderer.scene;
    this.ui = new UIManager(uiRoot, this.settings);
    this.assets = new AssetManager();
    this.input = new Input(canvas);
    this.audio = new AudioSystem(this.settings);
    this.camera = new CameraSystem(this.renderer.camera, this.settings);
    this.net = new NetClient();
    this.session = null;
    this.views = new Map();
    this.inputState = { mx: 0, mz: 0, held: 0, pressed: 0 };
    this.lastT = performance.now();
    this.time = 0;
    this.state = 'boot';
    this.showcase = null;
    window.__game = this; // debug / automated tests
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    this.settings.onChange((s, patch) => {
      if ('quality' in patch) this.renderer.setQuality(s.quality);
      this.audio.applyVolumes();
    });
    this.input.on('pause', () => this.togglePause());
    this.input.on('camera', () => { if (this.state === 'match') this.ui.feed('Camera: ' + (this.camera.toggleMode() === 'auto' ? 'Broadcast' : 'Free')); });
    this.input.on('help', () => this.ui.toggleHelp());
    this.wireNet();
  }

  async boot() {
    this.ui.showLoading();
    this.ui.loading(0.05, 'Building the arena…');
    await new Promise((r) => setTimeout(r, 30));
    const q = this.renderer.q;
    this.arena = new ArenaView(this.scene, this.renderer.qualityName);
    this.crowd = new CrowdSystem(this.scene, this.arena.seats, { density: q.crowdDensity });
    this.effects = new Effects(this.scene);
    this.itemViews = new ItemViews(this.scene);
    this.referee = new Referee(this.scene);
    this.referee.root.position.set(0, ARENA.ring.height, -1.5);
    this.commentators = this.arena.deskSeats.map((s, i) => new Commentator(this.scene, s, i ? '#3a1c24' : '#1c2238'));
    this.commentary = new CommentarySystem({ ui: this.ui, audio: this.audio, settings: this.settings, commentators: this.commentators });
    this.screens = new ScreenDirector(this.arena);
    this.renderer.renderer.compile(this.scene, this.renderer.camera);
    this.loop();
    this.ui.loading(0.15, 'Loading wrestlers…');
    this.assets.onProgress((p) => this.ui.loading(0.15 + p * 0.75, 'Loading wrestlers…'));
    await this.assets.loadAll();
    this.ui.loading(0.95, 'Warming up…');
    this.ui.portraits = makePortraits(this.renderer.renderer, this.assets);
    this.ui.hideLoading();
    const qs = new URLSearchParams(location.search);
    if (qs.get('room')) { this.showMainMenu(); this.friendMenu(qs.get('room')); }
    else if (qs.get('autostart')) {
      const opps = (qs.get('opp') || 'lucky').split(','), teams = (qs.get('teams') || '').split(',').filter(Boolean).map(Number);
      this.startLocalMatch(qs.get('mode') || 'normal', opps.map((c, i) => ({ charId: c, team: teams[i] ?? i + 1, difficulty: qs.get('diff') || 'normal' })), qs.get('char') || undefined);
    }
    else this.showMainMenu();
  }

  // ── menus ─────────────────────────────────────────────
  setShowcase(charId) {
    if (this.showcase?.charId === charId) return;
    this.showcase?.dispose();
    this.showcase = null;
    if (!charId || !this.assets.templates.has(charId)) return;
    const v = new FighterView(this.assets, charId);
    v.anim.menuMode = true;
    this.scene.add(v.root);
    this.showcase = v;
    this.showcaseState = { x: 0, y: ARENA.ring.height, z: 0.4, yaw: 0.35, state: S.IDLE, stateTime: 0, vx: 0, vz: 0 };
  }

  showMainMenu() {
    this.endMatchCleanup();
    this.state = 'menu';
    this.ui.clearMenus();
    this.setShowcase(this.settings.get().lastChar);
    this.audio.startMusic();
    this.ui.showMenu({
      play: () => this.quickPlay(),
      multiplayer: () => this.onlineQuick(),
      friend: () => this.friendMenu(),
      vsai: () => this.setupMenu('normal'),
      modes: () => this.ui.showModes({ onPick: (m) => { this.ui.unmount('modes'); this.setupMenu(m); }, onBack: () => this.ui.unmount('modes') }),
      chars: () => this.charSelect(() => this.showMainMenu()),
      settings: () => this.ui.showSettings({ onBack: () => this.ui.unmount('settings') }),
    });
  }

  charSelect(back, { taken = {}, onPick = null } = {}) {
    this.ui.clearMenus();
    this.state = 'charselect';
    this.ui.showCharSelect({
      current: this.settings.get().lastChar, taken,
      onPreview: (id) => this.setShowcase(id),
      onConfirm: (id) => { this.ui.unmount('chars'); onPick ? onPick(id) : back(); },
      onBack: () => { this.ui.unmount('chars'); back(); },
    });
  }

  setupMenu(mode) {
    this.ui.clearMenus();
    this.state = 'menu';
    const me = this.settings.get().lastChar;
    this.setShowcase(me);
    this.ui.showSetup({
      mode, me,
      onBack: () => this.showMainMenu(),
      onChangeChar: (m) => this.charSelect(() => this.setupMenu(m)),
      onStart: ({ mode: m, slots }) => this.startLocalMatch(m, slots),
    });
  }

  quickPlay() {
    const me = this.settings.get().lastChar;
    const others = CHARACTER_IDS.filter((c) => c !== me);
    this.startLocalMatch('normal', [{ charId: others[Math.floor(Math.random() * others.length)], team: 1, difficulty: this.settings.get().difficulty }]);
  }

  // ── local match ───────────────────────────────────────
  startLocalMatch(mode, slots, charOverride) {
    const s = this.settings.get();
    const me = charOverride || s.lastChar;
    const fighters = [{ charId: me, team: 0, name: s.name || getCharacter(me).name, isAI: false }, ...slots.map((sl) => ({ charId: sl.charId, team: sl.team, isAI: true, difficulty: sl.difficulty }))];
    this.lastLocal = { mode, slots, charOverride };
    const session = new LocalSession({ mode, fighters }, 1);
    this.beginMatch(session);
    this.commentary.startLocal(session.world);
  }

  async beginMatch(session) {
    try { await this.assets.ensure(session.fighters.map((f) => f.charId)); }
    catch (e) { this.ui.toast('Could not load wrestler models: ' + e.message); this.showMainMenu(); return; }
    this.endMatchCleanup();
    this.ui.clearMenus();
    this.setShowcase(null);
    this.audio.stopMusic();
    this.session = session;
    this.state = 'match';
    this.paused = false;
    this.arena.setMode(session.rules);
    this.camera.cage = !!session.rules.cage;
    this.crowd.react('calm');
    const view = session.view();
    for (const f of view.fighters) {
      const fv = new FighterView(this.assets, f.charId);
      const teams = new Set(view.fighters.map((x) => x.team));
      fv.setTeamColor(TEAM_COLORS[f.team % 6], teams.size > 2 || view.fighters.length > 2 || f.id === view.localId);
      this.scene.add(fv.root);
      this.views.set(f.id, fv);
    }
    this.ui.showHud(view.fighters, session.rules, view.localId, { online: session.online });
    this.input.enabled = true;
    this.me = view.fighters.find((f) => f.id === view.localId);
    this.camera.yaw = Math.atan2(-this.me.x, -this.me.z) + 0.6;
    this.ui.banner(session.rules.name.toUpperCase(), view.fighters.map((f) => getCharacter(f.charId).name).join('  VS  '), 2800);
    this.screens.matchIntro(view);
    this.resultsShown = false;
  }

  endMatchCleanup() {
    if (this.session) { this.session.dispose?.(); this.session = null; }
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.itemViews?.clear();
    this.commentary?.stop();
    this.ui.hideHud();
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    this.camera.cine = null;
  }

  togglePause() {
    if (this.state !== 'match') return;
    if (this.ui.screens.pause) { this.resume(); return; }
    this.paused = true;
    if (this.session && !this.session.online) this.session.paused = true;
    this.input.enabled = false;
    this.ui.showPause({
      online: this.session?.online,
      resume: () => this.resume(),
      settings: () => this.ui.showSettings({ onBack: () => this.ui.unmount('settings') }),
      controls: () => { this.ui.hidePause(); this.ui.toggleHelp(); this.resume(); },
      quit: () => { if (this.session?.online) this.net.send({ t: 'leave' }); this.ui.hidePause(); this.showMainMenu(); },
    });
  }
  resume() {
    this.ui.hidePause(); this.ui.unmount('settings');
    this.paused = false; if (this.session) this.session.paused = false;
    this.input.enabled = this.state === 'match';
  }

  showResults(info) {
    if (this.resultsShown) return;
    this.resultsShown = true;
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
    const view = this.session.view();
    const me = view.fighters.find((f) => f.id === view.localId);
    const winners = view.fighters.filter((f) => (info.winners || []).includes(f.id));
    const stats = info.stats || view.fighters.map((f) => ({ id: f.id, name: f.name, charId: f.charId, team: f.team, damage: f.stats?.damage ?? 0, hits: f.stats?.hits ?? 0, specials: f.stats?.specials ?? 0, hp: f.hp }));
    this.ui.showResults({ modeName: this.session.rules.name, method: info.method, winners, youWon: !!me && winners.some((w) => w.team === me.team), stats }, {
      rematch: this.session.online ? null : () => { const l = this.lastLocal; this.startLocalMatch(l.mode, l.slots, l.charOverride); },
      lobby: this.session.online ? () => { this.net.send({ t: 'backToLobby' }); this.backToLobby(); } : null,
      menu: () => { if (this.session?.online) this.net.send({ t: 'leave' }); this.showMainMenu(); },
    });
  }

  // ── online ────────────────────────────────────────────
  wireNet() {
    const n = this.net;
    n.on('room', (m) => {
      this.room = m.room;
      if (this.state === 'lobby') this.ui.updateLobby(m.room);
      else if (m.room.state === 'lobby' && (this.state === 'connecting' || this.state === 'friend')) this.enterLobby();
    });
    n.on('error', (m) => { if (this.state === 'lobby') this.ui.lobbyError(m.message); else if (this.state === 'friend') this.ui.friendError(m.message); else this.ui.toast(m.message); if (this.state === 'connecting') this.friendMenu(); });
    n.on('start', (m) => this.beginMatch(new OnlineSession(n, m)));
    n.on('end', (m) => { if (this.state === 'match' && this.session?.online) setTimeout(() => this.showResults(m), 1500); });
    n.on('commentary', (m) => { if (this.state === 'match') this.commentary.show({ text: m.text, speaker: m.speaker, priority: m.priority, key: m.key }); });
    n.on('chat', (m) => this.ui.feed(`${m.from}: ${m.text}`));
    n.on('close', () => { if (this.state === 'match' && this.session?.online) this.ui.toast('Connection lost – trying to reconnect…'); });
  }

  async connect() {
    try { await this.net.connect(); return true; } catch (e) { this.ui.toast(e.message || 'Could not reach the game server'); return false; }
  }

  friendMenu(code = '') {
    this.ui.clearMenus();
    this.state = 'friend';
    this.ui.showFriend({
      code,
      onBack: () => this.showMainMenu(),
      onCreate: async () => { if (!(await this.connect())) return this.ui.friendError('Game server unreachable.'); this.state = 'connecting'; this.net.send({ t: 'create', name: this.playerName(), charId: this.settings.get().lastChar }); },
      onJoin: async (c) => {
        if (!/^[A-Z0-9]{4,6}$/.test(c)) return this.ui.friendError('Enter the 5-character room code.');
        if (!(await this.connect())) return this.ui.friendError('Game server unreachable.');
        this.state = 'connecting'; this.net.send({ t: 'join', code: c, name: this.playerName(), charId: this.settings.get().lastChar });
      },
    });
  }

  async onlineQuick() {
    this.ui.clearMenus(); this.state = 'connecting';
    this.ui.toast('Finding a match…');
    if (!(await this.connect())) { this.showMainMenu(); return; }
    this.net.send({ t: 'quick', name: this.playerName(), charId: this.settings.get().lastChar });
  }

  playerName() { return this.settings.get().name || 'Guest' + Math.floor(Math.random() * 900 + 100); }

  inviteLink(code) { return `${location.origin}${location.pathname}?room=${code}`; }

  enterLobby() {
    this.endMatchCleanup();
    this.ui.clearMenus();
    this.state = 'lobby';
    const me = this.room.players.find((p) => p.id === this.net.id);
    this.setShowcase(me?.charId || this.settings.get().lastChar);
    if (!this.audio.musicTimer) this.audio.startMusic();
    const send = (m) => this.net.send(m);
    this.ui.showLobby(this.room, this.net.id, {
      leave: () => { send({ t: 'leave' }); this.showMainMenu(); },
      copy: async () => { try { await navigator.clipboard.writeText(this.inviteLink(this.room.code)); this.ui.toast('Invite link copied!'); } catch { this.ui.toast(this.inviteLink(this.room.code), 6000); } },
      link: (c) => this.inviteLink(c),
      ready: () => { const p = this.room.players.find((x) => x.id === this.net.id); send({ t: 'ready', ready: !p?.ready }); },
      start: () => send({ t: 'start' }),
      mode: (m) => send({ t: 'mode', mode: m }),
      team: (pid, team) => send({ t: 'team', playerId: pid, team }),
      aiTeam: (i, team) => send({ t: 'aiTeam', index: i, team }),
      addAI: (charId, difficulty) => send({ t: 'addAI', charId, difficulty }),
      removeAI: (i) => send({ t: 'removeAI', index: i }),
      changeChar: () => {
        const taken = {}; for (const p of this.room.players) if (p.id !== this.net.id) taken[p.charId] = p.name;
        this.state = 'lobby-char';
        this.charSelect(() => this.enterLobby(), { taken, onPick: (id) => { send({ t: 'char', charId: id }); this.enterLobby(); } });
      },
    });
  }
  backToLobby() { this.resultsShown = true; if (this.room) this.enterLobby(); }

  // ── frame loop ────────────────────────────────────────
  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now(); const dt = Math.min(0.05, (now - this.lastT) / 1000); this.lastT = now;
      this.time += dt;
      try { this.frame(dt); } catch (e) { console.error(e); }
    };
    requestAnimationFrame(tick);
  }

  frame(dt) {
    const camFwd = this.renderer.camera.getWorldDirection(new THREE.Vector3());
    const camYaw = Math.atan2(camFwd.x, camFwd.z);
    const inp = this.input.sample(camYaw);
    let loud = this.crowd?.loudness() ?? 0.3;
    if (this.state === 'match' && this.session) {
      const is = this.inputState;
      is.mx = inp.mx; is.mz = inp.mz; is.held = inp.held; is.pressed |= inp.pressed;
      this.session.update(dt, is);
      const view = this.session.view();
      this.renderMatch(dt, view, inp.look);
    } else {
      // menus: showcase wrestler + orbiting camera
      if (this.showcase) {
        const st = this.showcaseState; st.stateTime += dt;
        st.yaw = 0.35 + Math.sin(this.time * 0.25) * 0.35;
        this.showcase.anim.flex = Math.sin(this.time * 0.5) > 0.75 ? 1 : 0;
        this.showcase.update(dt, st);
      }
      const menuShot = this.state === 'charselect' || this.state === 'lobby-char'
        ? { kind: 'showcase', subject: { x: 0, y: ARENA.ring.height, z: 0.4, height: this.showcase?.c.height || 1.8 }, angle: 0.25 }
        : { kind: 'orbit' };
      this.camera.update(dt, { menu: menuShot });
      this.referee?.update(dt, { x: -1.8, y: ARENA.ring.height, z: -1.2, yaw: 0.6, state: 'watch', count: 0 });
      this.arena?.updateRopes(dt, []);
    }
    if (this.arena) {
      this.arena.update(dt, this.time, loud);
      this.crowd.update(dt, this.time);
      this.effects.update(dt);
      this.commentators.forEach((c) => c.update(dt));
      this.screens.update(dt, this.time, this.session?.view?.());
      const cam = this.renderer.camera;
      this.audio.setListener(cam.position, cam.getWorldDirection(new THREE.Vector3()));
      this.audio.updateCrowd(dt, loud);
    }
    this.renderer.render(dt, this.time);
  }

  renderMatch(dt, view, look) {
    const byId = new Map(view.fighters.map((f) => [f.id, f]));
    this.byId = byId;
    for (const f of view.fighters) this.views.get(f.id)?.update(dt, f);
    this.itemViews.sync(view.items);
    this.referee.update(dt, view.referee);
    this.arena.updateRopes(dt, view.fighters);
    const events = this.session.takeEvents();
    this.processEvents(events, byId, view);
    if (!this.session.online) this.commentary.update(dt, events);
    const me = byId.get(view.localId);
    const opp = me && me.target != null ? byId.get(me.target) : null;
    this.camera.update(dt, { me, opp, look });
    this.ui.updateHud(view, { netText: this.session.online ? `PING ${Math.round(this.net.rtt)} ms · ${Math.round(this.renderer.fps)} FPS` : `${Math.round(this.renderer.fps)} FPS` });
    if (me) this.ui.prompt(this.prompts(me, view));
    if (!this.session.online && view.match.phase === 'over' && !this.resultsShown) {
      this.showResults({ winners: view.match.winners, method: view.match.method });
    }
  }

  // ── context prompts for the local wrestler ──
  prompts(me, view) {
    const out = [];
    const st = me.state;
    const ab = ABILITIES[me.c.special];
    if (st === S.HELD) return [{ key: 'MASH', text: 'to escape' }, { key: 'Q', text: 'Reversal (quick!)', hot: me.stateTime < 0.3 }];
    if (st === S.PINNED) return [{ key: 'MASH J / K', text: 'KICK OUT!', hot: true }];
    if (st === S.DOWN || st === S.KNOCKDOWN) return [{ key: 'MASH', text: 'to get up faster' }];
    if (st === S.CORNER_STUN) return [{ key: 'MASH', text: 'to recover' }];
    if (st === S.HOLD) return [{ key: 'J', text: 'Strike' }, { key: 'K', text: 'Slam (S+K: suplex)' }, { key: 'E', text: 'Throw / Irish whip' }, ...(ab?.kind === 'grapple' ? [{ key: 'X', text: ab.name, hot: me.meter >= me.c.specialCost && me.specialCd <= 0 }] : [])];
    if (st === S.PERCH) return [{ key: 'J / K', text: 'DIVE!', hot: true }, { key: 'F', text: 'Climb down' }];
    if (st === S.CAGE_CLIMB) return [{ key: 'W / S', text: 'Climb' }, { key: 'J', text: 'Dive off!', hot: me.y > 1.2 }, { key: 'F', text: 'Drop' }];
    if (me.itemType) out.push({ key: 'J', text: 'Swing' }, { key: 'K', text: 'Smash' }, { key: 'G', text: 'Throw' }, { key: 'F', text: 'Drop' });
    else {
      // what would F do?
      const enemies = view.fighters.filter((o) => o.team !== me.team && !o.eliminated && !o.hidden);
      const downed = enemies.find((o) => (o.state === S.DOWN || o.state === S.KNOCKDOWN) && o.zone === me.zone && Math.hypot(o.x - me.x, o.z - me.z) < 1.3 + me.c.radius);
      const pinOk = downed && (!view.rules.pinsInRingOnly || me.zone === 'ring');
      if (pinOk) out.push({ key: 'F', text: 'PIN', hot: true });
      else {
        const item = view.items.find((it) => it.holder == null && !it.broken && Math.abs(it.y - me.y) < 0.8 && Math.hypot(it.x - me.x, it.z - me.z) < 1.35 + me.c.radius);
        if (item) out.push({ key: 'F', text: 'Pick up ' + (ITEMS[item.type]?.name || 'item') });
        else if (me.zone === 'ring') {
          const R = ARENA.ring;
          const cd = Math.hypot(Math.abs(me.x) - R.postInset, Math.abs(me.z) - R.postInset);
          const gap = R.ropeLine - Math.max(Math.abs(me.x), Math.abs(me.z));
          if (view.rules.tag && me.legal) {
            const [cx, cz] = ARENA.tagCorners[me.team] || [0, 0];
            if (Math.hypot(me.x - cx * R.postInset, me.z - cz * R.postInset) < 1.6) out.push({ key: 'F', text: 'TAG partner', hot: true });
          }
          if (!out.length && cd < R.cornerZone + 0.2) out.push({ key: 'F', text: 'Climb turnbuckle' });
          else if (!out.length && gap < 0.9) out.push({ key: 'F', text: 'Roll out of ring' });
        } else if (me.zone === 'floor') {
          const R = ARENA.ring;
          if (view.rules.cage && ARENA.cage.half - Math.max(Math.abs(me.x), Math.abs(me.z)) < 0.9 + me.c.radius) out.push({ key: 'F', text: 'Climb the cell' });
          else {
            const dx = Math.abs(me.x) - R.apronHalf, dz = Math.abs(me.z) - R.apronHalf;
            const d = dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
            if (d < 0.9 + me.c.radius) out.push({ key: 'F', text: 'Enter ring' });
          }
        }
      }
    }
    if (ab) {
      const s = this.session.abilityStatus(me);
      if (s.ready) out.push({ key: 'X', text: ab.name, hot: true });
      else if (s.reason === 'range' && me.meter >= me.c.specialCost && me.specialCd <= 0) out.push({ key: 'X', text: `${ab.name} – get within ${ab.maxRange} m` });
    }
    return out;
  }

  // ── events → presentation ─────────────────────────────
  processEvents(events, byId, view) {
    const me = view.localId;
    const A = this.audio, E = this.effects, C = this.crowd, cam = this.camera, ui = this.ui;
    const name = (id) => byId.get(id)?.name ?? '';
    const involved = (e) => e.fighter === me || e.victim === me || e.attacker === me;
    for (const e of events) {
      const p = e.pos ? new THREE.Vector3(e.pos.x, e.pos.y, e.pos.z) : null;
      switch (e.type) {
        case 'hit': {
          const snd = HIT_SOUNDS.has(e.sound) ? (e.sound === 'bell' ? 'bell_hit' : e.sound) : 'punch';
          A.play(snd, p, { volume: e.heavy ? 1.2 : 0.9 });
          const v = byId.get(e.victim);
          if (v && Math.random() < 0.7) A.play('grunt', p, { pitch: v.c.voicePitch, pain: true, volume: 0.7 });
          E.hit(p, { heavy: e.heavy, weapon: e.weapon, sound: e.sound });
          const vv = this.views.get(e.victim), a = byId.get(e.attacker);
          if (vv && a && v) { const dx = v.x - a.x, dz = v.z - a.z, d = Math.hypot(dx, dz) || 1; vv.onHit(dx / d, dz / d, Math.min(2, 0.4 + e.damage / 80)); }
          cam.shake((involved(e) ? 0.22 : 0.08) + (e.heavy ? 0.25 : 0) + (e.special ? 0.35 : 0));
          if (e.heavy) { cam.punch(e.special ? 6 : 2.5); this.renderer.impactFlash(e.special ? 0.35 : 0.12); }
          C.react('pop', e.crowd ?? 0.1); A.crowdPop((e.crowd ?? 0.1) * 0.8);
          if (p && (involved(e) || e.heavy)) this.damageNumber(p, e.damage);
          break;
        }
        case 'block': A.play('block', p); E.burst(p, { n: 6, speed: 2, color: [0.6, 0.8, 1], size: 0.06, life: 0.2 }); break;
        case 'parry': A.play('parry', p); E.burst(p, { n: 16, speed: 3, color: [0.6, 0.9, 1], size: 0.08, life: 0.3 }); if (involved(e)) ui.feed('COUNTER!'); C.react('pop', 0.3); break;
        case 'guard_break': A.play('heavy', p); if (e.fighter === me) ui.feed('GUARD BROKEN!'); break;
        case 'attack': { const f = byId.get(e.fighter); if (f) { A.play('whoosh', new THREE.Vector3(f.x, f.y + 1.2, f.z), { volume: 0.6 }); if (Math.random() < 0.25) A.play('grunt', new THREE.Vector3(f.x, f.y + 1.5, f.z), { pitch: f.c.voicePitch, volume: 0.5 }); } break; }
        case 'dodge': case 'jump': case 'grab_attempt': { const f = byId.get(e.fighter); if (f) A.play(e.type === 'jump' ? 'jump' : 'whoosh', new THREE.Vector3(f.x, f.y + 1, f.z), { volume: 0.4 }); break; }
        case 'dodge_evade': if (e.fighter === me) ui.feed('EVADED!'); break;
        case 'grab': { const f = byId.get(e.fighter); if (f) A.play('grunt', new THREE.Vector3(f.x, f.y + 1.5, f.z), { pitch: f.c.voicePitch }); break; }
        case 'reversal': A.play('parry', null, { volume: 0.6 }); ui.feed(`REVERSAL by ${name(e.fighter)}!`); C.react('pop', 0.5); A.crowdPop(0.5); break;
        case 'escape': if (involved(e)) ui.feed('ESCAPED!'); break;
        case 'slam': A.play('slam', p, { volume: 1.3 }); E.slam(p, 1); cam.shake(0.45); cam.punch(3); C.react('big'); A.crowdPop(0.9); ui.feed(e.moveName?.toUpperCase?.() || 'SLAM!'); break;
        case 'land': { const f = byId.get(e.fighter); if (f && (e.bodyfall || e.heavy)) { const lp = new THREE.Vector3(f.x, f.y, f.z); A.play(e.bodyfall ? 'bodyfall' : 'land', lp, { heavy: e.heavy }); if (e.bodyfall) E.slam(lp, 0.5); } break; }
        case 'rope_bounce': A.play('rope', p); this.arena.twang(p.x, p.z, 0.35); break;
        case 'rope_touch': if (!this.ropeT || this.time - this.ropeT > 0.4) { this.ropeT = this.time; A.play('rope', p, { volume: 0.35 }); this.arena.twang(p.x, p.z, 0.12); } break;
        case 'turnbuckle_hit': A.play('turnbuckle', p); cam.shake(0.25); C.react('pop', 0.3); break;
        case 'barricade_hit': case 'desk_hit': case 'apron_hit': A.play('barricade', p); cam.shake(0.35); C.react('pop', 0.5); A.crowdPop(0.5); break;
        case 'cage_hit': A.play('cage', p, { volume: 1.3 }); this.arena.cageShake = 1; cam.shake(0.5); C.react('big'); A.crowdPop(0.8); break;
        case 'over_top_rope': A.play('rope', p); C.react('big'); A.crowdPop(1); ui.feed(`${name(e.fighter)} goes OVER THE TOP!`); break;
        case 'table_break': A.play('table', p, { volume: 1.4 }); E.debris(p); cam.shake(0.6); cam.punch(4); C.react('big'); A.crowdPop(1.3); ui.banner('THROUGH THE TABLE!', '', 1500); break;
        case 'item_break': A.play('wood', p); E.debris(p); break;
        case 'item_pickup': A.play('ui', null, { volume: 0.3 }); if (e.fighter === me) ui.feed(`You picked up a ${e.name}`); else ui.feed(`${name(e.fighter)} grabs a ${e.name}!`); A.crowdPop(0.2); break;
        case 'item_throw': { const f = byId.get(e.fighter); if (f) A.play('whoosh', new THREE.Vector3(f.x, f.y + 1.2, f.z)); break; }
        case 'item_bounce': if (!this.bounceT || this.time - this.bounceT > 0.12) { this.bounceT = this.time; A.play(e.sound === 'bell' ? 'bell_hit' : e.sound || 'metal', p, { volume: 0.4 }); } break;
        case 'too_heavy': if (e.fighter === me) ui.feed('Too heavy to lift!'); break;
        case 'fan_throw': ui.feed(`A fan tossed a ${String(e.itemType).replace('_', ' ')} into the ring!`); C.react('pop', 0.4); A.crowdPop(0.4); break;
        case 'special_start': {
          const f = byId.get(e.fighter);
          A.play('special_charge', f ? new THREE.Vector3(f.x, f.y + 1, f.z) : null);
          ui.banner(e.name, getCharacter(f?.charId)?.name || '', 1400);
          C.react('pop', 0.6); A.crowdPop(0.6);
          if (e.camera === 'cinematic' && e.target !== me) {
            cam.cinematic({ kind: 'crush', dur: 1.75, subject: () => this.byId?.get(e.fighter), target: () => (e.target != null ? this.byId?.get(e.target) : null) });
          }
          break;
        }
        case 'special_jump': A.play('whoosh', p, { volume: 1.2 }); C.react('big'); A.crowdPop(0.7); break;
        case 'impact': A.play('impact', p, { volume: 1.5 }); E.crush(p); cam.shake(1); cam.punch(8); this.renderer.impactFlash(0.5); break;
        case 'AJAN_SPECIAL_HIT':
          // Ajan's signature sound plays ONLY when the crush actually lands
          A.playSample(e.sound || 'assets/audio/Ajan.mp3', p, { volume: 1.3 });
          ui.banner('SILVERBACK CRUSH!', `${name(e.fighter)} flattens ${e.victims?.map(name).join(' & ')}`, 2200);
          C.react('big'); A.crowdPop(1.5);
          break;
        case 'special_hit':
          if (e.ability !== 'ajan_crush') { ui.feed(`${e.name}!`); cam.shake(0.5); cam.punch(5); C.react('big'); A.crowdPop(1.1); }
          break;
        case 'special_miss': ui.feed('The special missed!'); A.crowdBoo(0.3); break;
        case 'special_denied':
          if (e.fighter === me && (!this.denyT || this.time - this.denyT > 1)) {
            this.denyT = this.time;
            ui.feed({ range: 'No opponent in range for your special', cooldown: 'Special on cooldown', meter: 'Special meter not full yet' }[e.reason] || 'Special not ready');
          }
          break;
        case 'pin_start': C.react('nearfall'); A.crowdPop(0.4); break;
        case 'pin_count': A.play('pin_slap', p || this.refPos(view)); ui.pinCount(e.count); C.react('nearfall'); A.crowdPop(0.35 + e.count * 0.2); break;
        case 'kickout': ui.banner('KICK OUT!', `${name(e.fighter)} survives at ${e.count}`, 1200); C.react('big'); A.crowdPop(1.2); break;
        case 'pin_broken': A.crowdBoo(0.35); break;
        case 'pinfall': ui.pinCount(3); ui.banner('PINFALL!', `${name(e.fighter)} pins ${name(e.victim)}`, 2400); A.crowdPop(1.4); break;
        case 'ko': ui.banner('K.O.!', name(e.fighter), 2000); C.react('big'); A.crowdPop(1.2); cam.shake(0.4); break;
        case 'elimination': ui.feed(`${name(e.fighter)} has been ELIMINATED`); break;
        case 'bell': A.play('ring_bell', new THREE.Vector3(2.6, 1, -6.3), { times: e.ending ? 3 : 2, volume: 1.2 }); break;
        case 'match_start': ui.banner('FIGHT!', '', 1100); C.react('pop', 0.8); A.crowdPop(1); this.screens.flash('FIGHT!'); break;
        case 'match_end': {
          const w = (e.winners || []).map(name).join(' & ');
          const meF = byId.get(me);
          const won = meF && (e.winners || []).some((id) => byId.get(id)?.team === meF.team);
          ui.banner(won ? 'VICTORY!' : 'WINNER', w, 4000);
          C.react('celebrate'); A.crowdPop(1.5);
          this.screens.flash(w);
          break;
        }
        case 'time_up': ui.banner('TIME!', 'Decision by remaining health', 2000); break;
        case 'tag': ui.feed(`TAG! ${name(e.partner)} is legal`); C.react('pop', 0.5); A.crowdPop(0.5); A.play('block', null, { volume: 0.5 }); break;
        case 'taunt': C.react('pop', 0.4); A.crowdPop(0.4); break;
        case 'comeback': ui.feed(`${name(e.fighter)} is making a COMEBACK!`); C.react('big'); A.crowdPop(1); break;
        case 'dive': case 'climb_turnbuckle': case 'cage_climb': C.react('nearfall'); A.crowdPop(0.5); break;
        case 'exit_ring': A.crowdBoo(0.15); break;
        case 'irish_whip': { const f = byId.get(e.fighter); if (f) A.play('grunt', new THREE.Vector3(f.x, f.y + 1.5, f.z), { pitch: f.c.voicePitch }); break; }
        case 'throw': A.play('whoosh', p, { volume: 1 }); C.react('pop', 0.4); break;
        case 'env_damage': break;
      }
    }
  }

  refPos(view) { return new THREE.Vector3(view.referee.x, view.referee.y, view.referee.z); }

  damageNumber(p, dmg) {
    const v = p.clone().project(this.renderer.camera);
    if (v.z > 1) return;
    this.ui.damageNumber((v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, dmg);
  }
}
