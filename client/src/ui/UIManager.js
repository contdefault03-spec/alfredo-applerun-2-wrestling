// UIManager – every DOM screen: loading, main menu, character select,
// exhibition setup, game modes, friend rooms/lobby, settings, HUD, pause,
// results. Game.js wires the callbacks.
import { CHARACTERS, CHARACTER_IDS, getCharacter } from '@shared/config/characters.js';
import { ABILITIES } from '@shared/config/abilities.js';
import { GAME_MODES, MODE_IDS } from '@shared/config/gameModes.js';
import { AI_DIFFICULTY } from '@shared/config/ai.js';
import { CONTROLS_HELP } from '../core/Input.js';

export const TEAM_COLORS = ['#e8283f', '#2f7bff', '#3ddc84', '#ffb020', '#b05cff', '#20d4d4'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function statBars(id) {
  const c = getCharacter(id);
  const norm = (v, a, b) => Math.round(Math.max(0.05, Math.min(1, (v - a) / (b - a))) * 100);
  const stats = [
    ['POWER', norm(c.attackPower, 0.5, 1.6)], ['SPEED', norm(c.runSpeed, 3.8, 8.4)], ['HEALTH', norm(c.maxHealth, 700, 1750)],
    ['DEFENSE', norm(c.defense + c.knockbackResistance * 0.5, 0, 0.55)], ['GRAPPLE', norm(c.grabStrength, 0.5, 2.0)], ['AGILITY', norm(c.dodgeSpeed / c.dodgeCooldown, 5, 50)],
  ];
  return stats.map(([n, v]) => `<div class="stat"><span>${n}</span><div class="b"><div style="width:${v}%"></div></div><span>${Math.round(v / 10)}</span></div>`).join('');
}

export class UIManager {
  constructor(root, settings) {
    this.root = root; this.settings = settings;
    this.portraits = {};
    this.screens = {};
    this.hudEls = null;
    this.bannerTimer = null;
  }

  el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  mount(name, html) {
    this.unmount(name);
    const e = this.el(html); e.dataset.screen = name;
    this.root.appendChild(e); this.screens[name] = e; return e;
  }
  unmount(name) { this.screens[name]?.remove(); delete this.screens[name]; }
  clearMenus() { for (const n of Object.keys(this.screens)) if (n !== 'hud' && n !== 'loading') this.unmount(n); }
  toast(msg, ms = 2600) {
    const e = this.el(`<div class="toast passive">${esc(msg)}</div>`); this.root.appendChild(e);
    setTimeout(() => e.remove(), ms);
  }
  portrait(id) { return this.portraits[id] || ''; }

  // ── loading ──
  showLoading() {
    this.mount('loading', `<div id="loading" class="screen"><div class="logo">ALFREDO APPLERUN 2<small>WRESTLING</small></div>
      <div class="bar"><div></div></div><div class="dim" style="margin-top:12px" id="ltxt">Loading the arena…</div></div>`);
  }
  loading(p, text) {
    const s = this.screens.loading; if (!s) return;
    s.querySelector('.bar > div').style.width = Math.round(p * 100) + '%';
    if (text) s.querySelector('#ltxt').textContent = text;
  }
  hideLoading() { const s = this.screens.loading; if (s) { s.style.transition = 'opacity .5s'; s.style.opacity = 0; setTimeout(() => this.unmount('loading'), 500); } }

  // ── main menu ──
  showMenu(h) {
    const s = this.settings.get();
    const c = CHARACTERS[s.lastChar] || CHARACTERS.masked;
    const A = 'assets/art/';
    const feat = { a: 'play', label: 'PLAY', sub: `AS ${esc(c.name).toUpperCase()}`, img: `${A}7.jpg` };
    const tiles = [
      { a: 'vsai', label: 'VS AI', img: `${A}8.jpg` },
      { a: 'multiplayer', label: 'MULTIPLAYER', img: `${A}9.jpg` },
      { a: 'friend', label: 'PLAY WITH FRIEND', img: `${A}10.jpg` },
      { a: 'tournament', label: 'TOURNAMENT', img: `${A}11.jpg` },
      { a: 'championship', label: 'CHAMPIONSHIP', img: `${A}12.jpg` },
      { a: 'watch', label: 'WATCH (BROADCAST)', img: `${A}13.jpg` },
    ];
    const mini = [
      { a: 'modes', label: 'GAME MODES' },
      { a: 'chars', label: 'CHARACTER SELECT' },
      { a: 'settings', label: 'SETTINGS' },
    ];
    const tileHTML = (t, cls = '') => `<button class="mtile ${cls}" data-a="${t.a}" style="background-image:url('${t.img}')">
      <span class="scrim"></span><span class="lbl">${t.label}${t.sub ? `<small>${t.sub}</small>` : ''}</span></button>`;
    const e = this.mount('menu', `<div id="menu" class="screen">
      <div class="hero" style="background-image:url('${A}5.webp')"></div>
      <div class="veil"></div>
      <header class="mhead">
        <div class="gametitle">ALFREDO APPLERUN&nbsp;2<small>WRESTLING</small></div>
      </header>
      <div class="mbody">
        <div class="homebar"><span class="dot"></span><span class="homeword">HOME</span>
          <label class="nametag">WRESTLER <input class="field" id="pname" maxlength="16" placeholder="Guest" value="${esc(s.name)}" /></label>
        </div>
        <div class="tilewrap">
          ${tileHTML(feat, 'feat')}
          <div class="tilegrid">${tiles.map((t) => tileHTML(t)).join('')}</div>
        </div>
        <div class="minirow">${mini.map((m) => `<button class="mbtn" data-a="${m.a}">${m.label}</button>`).join('')}</div>
      </div>
      <div class="foot dim">WASD move · J punch · K kick · E grab · F interact · X special · H controls</div></div>`);
    e.querySelector('#pname').addEventListener('change', (ev) => this.settings.set({ name: ev.target.value.trim().slice(0, 16) }));
    e.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => { this.settings.set({ name: e.querySelector('#pname').value.trim().slice(0, 16) }); h[b.dataset.a]?.(); }));
  }

  // ── character select ──
  showCharSelect({ current, onPreview, onConfirm, onBack, taken = {} }) {
    let sel = current || this.settings.get().lastChar || 'masked';
    const e = this.mount('chars', `<div id="charselect" class="screen">
      <div class="top"><div class="title" style="font-size:52px;color:var(--gold)">CHOOSE YOUR WRESTLER</div>
        <div class="row"><button class="btn" data-a="back">BACK</button><button class="btn primary" data-a="ok">CONFIRM</button></div></div>
      <div class="info panel"></div>
      <div class="grid">${CHARACTER_IDS.map((id) => `<div class="card ${taken[id] ? 'taken' : ''}" data-id="${id}" data-taken="${esc(taken[id] || '')}"><img src="${this.portrait(id)}" alt="" /><div class="nm">${CHARACTERS[id].name}</div></div>`).join('')}</div></div>`);
    const render = () => {
      e.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.id === sel));
      const c = getCharacter(sel), ab = ABILITIES[c.special];
      e.querySelector('.info').innerHTML = `<div class="nm">${c.name}</div><div class="tl">${esc(c.tagline)}</div>
        <div class="dim" style="margin-bottom:10px">${esc(c.description)}</div>${statBars(sel)}
        <div class="row dim" style="margin-top:8px;font-size:15px"><span>HEIGHT ${c.height.toFixed(2)} m</span>·<span>WEIGHT ${c.weight} kg</span>·<span>HP ${c.maxHealth}</span></div>
        ${ab ? `<div class="special"><div class="t">SPECIAL · ${esc(ab.name)}</div><div>${esc(ab.description)}</div><div class="dim" style="font-size:14px">Cost ${c.specialCost} meter · Cooldown ${c.specialCooldown}s · Press X</div></div>` : ''}`;
      onPreview?.(sel);
    };
    e.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => { sel = c.dataset.id; render(); }));
    e.querySelector('[data-a=back]').onclick = () => onBack?.();
    e.querySelector('[data-a=ok]').onclick = () => { this.settings.set({ lastChar: sel }); onConfirm?.(sel); };
    this.charKeys = (ev) => {
      const i = CHARACTER_IDS.indexOf(sel);
      if (ev.key === 'ArrowRight') { sel = CHARACTER_IDS[(i + 1) % CHARACTER_IDS.length]; render(); }
      if (ev.key === 'ArrowLeft') { sel = CHARACTER_IDS[(i + CHARACTER_IDS.length - 1) % CHARACTER_IDS.length]; render(); }
      if (ev.key === 'Enter') e.querySelector('[data-a=ok]').click();
    };
    window.addEventListener('keydown', this.charKeys);
    const origUnmount = e.remove.bind(e);
    e.remove = () => { window.removeEventListener('keydown', this.charKeys); origUnmount(); };
    render();
  }

  /** First-run input chooser: PC keyboard/mouse or on-screen mobile controls. */
  showInputPicker({ suggest = 'pc', onPick }) {
    const e = this.mount('inputpick', `<div class="screen overlay"><div class="center-panel panel">
      <h2>HOW ARE YOU PLAYING?</h2>
      <div class="dim" style="text-align:center">Same game, same servers — only the controls change. You can switch later in Settings.</div>
      <div class="inputpick">
        <div class="pick" data-m="pc"><div class="big">PC</div><div class="dim">Keyboard &amp; mouse<br>WASD · J/K · E · F · X</div></div>
        <div class="pick" data-m="mobile"><div class="big">MOBILE</div><div class="dim">On-screen stick<br>&amp; touch buttons</div></div>
      </div></div></div>`);
    const hi = e.querySelector(`[data-m="${suggest}"]`); if (hi) hi.style.borderColor = 'var(--gold2,#ffd24a)';
    e.querySelectorAll('.pick').forEach((n) => n.addEventListener('click', () => { this.unmount('inputpick'); onPick?.(n.dataset.m); }));
  }

  // ── game modes list ──
  showModes({ onPick, onBack }) {
    const e = this.mount('modes', `<div class="screen overlay"><div class="center-panel panel"><button class="btn small close-x" data-a="back">BACK</button>
      <h2>GAME MODES</h2><div class="col">${MODE_IDS.map((id) => { const m = GAME_MODES[id]; return `<div class="mode" data-id="${id}"><div class="t">${m.name}</div><div class="d">${esc(m.description)}</div>
      <div class="dim" style="font-size:13px;margin-top:4px">${m.minFighters}–${m.maxFighters} wrestlers · ${Math.round(m.timeLimit / 60)} min · win by ${m.winBy.join(' / ')}${m.tag ? ' · tag rules' : ''}${m.cage ? ' · steel cell' : ''}</div></div>`; }).join('')}</div></div></div>`);
    e.querySelectorAll('.mode').forEach((m) => m.addEventListener('click', () => onPick(m.dataset.id)));
    e.querySelector('[data-a=back]').onclick = onBack;
  }

  /** Tournament bracket: shows the 3 rounds, who you face and in what match type. */
  showBracket({ t, onGo, onBack }) {
    const rows = t.bracket.map((r, i) => {
      const n = i + 1;
      const state = n < t.round ? 'won' : n === t.round ? 'now' : 'next';
      const tag = state === 'won' ? '✔ WON' : state === 'now' ? '▶ NOW' : 'UPCOMING';
      const opp = CHARACTERS[r.opp]?.name || r.opp;
      const mode = GAME_MODES[r.mode]?.name || r.mode;
      return `<div class="mode" style="opacity:${state === 'next' ? 0.55 : 1};border-color:${state === 'now' ? '#ffd24a' : ''}">
        <div class="t">${r.name} — ${esc(mode)}</div>
        <div class="d">${esc(CHARACTERS[t.charId]?.name || t.charId)} vs ${esc(opp)}</div>
        <div class="dim" style="font-size:13px;margin-top:4px">${tag}</div></div>`;
    }).join('');
    const done = t.round > t.bracket.length;
    const e = this.mount('bracket', `<div class="screen overlay"><div class="center-panel panel">
      <h2>TOURNAMENT ${done ? '— CHAMPION!' : '· ROUND ' + t.round + ' OF ' + t.bracket.length}</h2>
      <div class="col">${rows}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        ${onBack ? '<button class="btn small" data-a="back">QUIT</button>' : ''}
        <button class="btn primary" data-a="go">${done ? 'CELEBRATE' : 'FIGHT'}</button></div></div></div>`);
    e.querySelector('[data-a=go]').onclick = () => { this.unmount('bracket'); onGo?.(); };
    const b = e.querySelector('[data-a=back]'); if (b) b.onclick = () => { this.unmount('bracket'); onBack?.(); };
  }

  // ── exhibition (vs AI) setup ──
  showSetup({ mode = 'normal', me, onStart, onBack, onChangeChar }) {
    const s = this.settings.get();
    const state = { mode, slots: [] };
    const defaultSlots = (m) => {
      const others = CHARACTER_IDS.filter((c) => c !== me);
      const pickC = (i) => others[(i * 2 + 1) % others.length];
      if (m === 'tag') return [{ charId: pickC(0), team: 0, difficulty: s.difficulty }, { charId: pickC(1), team: 1, difficulty: s.difficulty }, { charId: pickC(2), team: 1, difficulty: s.difficulty }];
      if (m === 'ffa') return [0, 1, 2].map((i) => ({ charId: pickC(i), team: i + 1, difficulty: s.difficulty }));
      return [{ charId: pickC(0), team: 1, difficulty: s.difficulty }];
    };
    state.slots = defaultSlots(mode);
    const e = this.mount('setup', `<div class="screen overlay"><div class="center-panel panel"><button class="btn small close-x" data-a="back">BACK</button>
      <h2>VS AI · EXHIBITION</h2><div class="modes">${MODE_IDS.map((id) => `<div class="mode" data-id="${id}"><div class="t">${GAME_MODES[id].short}</div><div class="d">${GAME_MODES[id].name}</div></div>`).join('')}</div>
      <div class="dim" id="mdesc" style="margin:10px 0"></div>
      <div class="slots" id="slots"></div>
      <div class="row" style="margin-top:12px"><button class="btn small" data-a="add">+ ADD WRESTLER</button><span class="error" id="err"></span></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn primary" data-a="start">START MATCH</button></div></div></div>`);
    const charOpts = (sel) => CHARACTER_IDS.map((c) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${CHARACTERS[c].name}</option>`).join('');
    const diffOpts = (sel) => Object.entries(AI_DIFFICULTY).map(([k, d]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${d.name}</option>`).join('');
    const teamOpts = (sel) => TEAM_COLORS.map((c, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>Team ${i + 1}</option>`).join('');
    const render = () => {
      const m = GAME_MODES[state.mode];
      e.querySelectorAll('.mode').forEach((x) => x.classList.toggle('sel', x.dataset.id === state.mode));
      e.querySelector('#mdesc').textContent = m.description + ` (${m.minFighters}–${m.maxFighters} wrestlers)`;
      const mine = `<div class="slot"><img src="${this.portrait(me)}" /><div class="who">YOU · ${CHARACTERS[me].name}</div><button class="btn small" data-a="mychar">CHANGE</button>
        <span><span class="team-dot" style="background:${TEAM_COLORS[0]}"></span>Team 1</span><span></span></div>`;
      e.querySelector('#slots').innerHTML = mine + state.slots.map((sl, i) => `<div class="slot" data-i="${i}"><img src="${this.portrait(sl.charId)}" />
        <select class="field" data-k="charId">${charOpts(sl.charId)}</select><select class="field" data-k="difficulty">${diffOpts(sl.difficulty)}</select>
        <select class="field" data-k="team" ${m.teams !== 'free' ? 'disabled' : ''}>${teamOpts(sl.team)}</select><button class="btn small" data-a="rm">✕</button></div>`).join('');
      e.querySelector('[data-a=mychar]').onclick = () => onChangeChar?.(state.mode);
      e.querySelectorAll('.slot[data-i]').forEach((row) => {
        const i = +row.dataset.i;
        row.querySelectorAll('select').forEach((sel) => sel.onchange = () => { state.slots[i][sel.dataset.k] = sel.dataset.k === 'team' ? +sel.value : sel.value; render(); });
        row.querySelector('[data-a=rm]').onclick = () => { state.slots.splice(i, 1); render(); };
      });
      e.querySelector('[data-a=add]').disabled = state.slots.length + 1 >= m.maxFighters;
    };
    e.querySelectorAll('.mode').forEach((x) => x.onclick = () => { state.mode = x.dataset.id; state.slots = defaultSlots(state.mode); render(); });
    e.querySelector('[data-a=add]').onclick = () => {
      const m = GAME_MODES[state.mode];
      const i = state.slots.length;
      const used = new Set([me, ...state.slots.map((x) => x.charId)]);
      const charId = CHARACTER_IDS.find((c) => !used.has(c)) || CHARACTER_IDS[i % CHARACTER_IDS.length];
      state.slots.push({ charId, team: m.teams === 'solo' ? i + 1 : m.teams === 'two' ? (i + 1) % 2 : 1, difficulty: s.difficulty });
      render();
    };
    e.querySelector('[data-a=back]').onclick = onBack;
    e.querySelector('[data-a=start]').onclick = () => {
      const m = GAME_MODES[state.mode];
      const total = state.slots.length + 1;
      const err = e.querySelector('#err');
      if (total < m.minFighters) return (err.textContent = `${m.name} needs at least ${m.minFighters} wrestlers.`);
      if (total > m.maxFighters) return (err.textContent = `${m.name} allows at most ${m.maxFighters} wrestlers.`);
      const teams = new Set([0, ...state.slots.map((x) => x.team)]);
      if (teams.size < 2) return (err.textContent = 'Put at least one opponent on a different team.');
      if (state.slots[0]) this.settings.set({ difficulty: state.slots[0].difficulty });
      onStart({ mode: state.mode, slots: state.slots });
    };
    render();
  }

  // ── friend: create / join ──
  showFriend({ onCreate, onJoin, onBack, code = '' }) {
    const e = this.mount('friend', `<div class="screen overlay"><div class="center-panel panel" style="width:min(640px,94vw)"><button class="btn small close-x" data-a="back">BACK</button>
      <h2>PLAY WITH A FRIEND</h2>
      <div class="col"><div class="dim">Create a private room, then send the code or invite link to your friend.</div>
      <button class="btn primary" data-a="create">CREATE ROOM</button>
      <div class="dim" style="margin-top:16px">Got a code? Join your friend's room:</div>
      <div class="row"><input class="field" id="code" maxlength="5" placeholder="A7K92" style="font-size:28px;width:180px;text-transform:uppercase;letter-spacing:6px" value="${esc(code)}" />
      <button class="btn" data-a="join">JOIN</button></div><div class="error" id="err"></div></div></div></div>`);
    e.querySelector('[data-a=back]').onclick = onBack;
    e.querySelector('[data-a=create]').onclick = onCreate;
    e.querySelector('[data-a=join]').onclick = () => onJoin(e.querySelector('#code').value.trim().toUpperCase());
    e.querySelector('#code').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') e.querySelector('[data-a=join]').click(); });
  }
  friendError(msg) { const x = this.screens.friend?.querySelector('#err'); if (x) x.textContent = msg; else this.toast(msg); }

  // ── lobby ──
  showLobby(room, myId, h) {
    const e = this.mount('lobby', `<div class="screen overlay"><div class="center-panel panel"><button class="btn small close-x" data-a="leave">LEAVE</button>
      <div class="row" style="justify-content:space-between;align-items:flex-end;flex-wrap:wrap"><div><div class="dim">ROOM CODE</div><div class="roomcode" id="rc"></div></div>
      <div class="col" style="align-items:flex-end"><button class="btn small" data-a="copy">COPY INVITE LINK</button><div class="dim" id="lnk" style="font-size:13px"></div></div></div>
      <div class="modes" id="modes" style="margin-top:14px"></div><div class="dim" id="mdesc" style="margin-top:6px"></div>
      <div class="slots" id="slots"></div>
      <div class="row" id="hostai" style="margin-top:10px"></div>
      <div class="error" id="err"></div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-a="char">CHANGE WRESTLER</button><button class="btn" data-a="ready">READY</button><button class="btn primary" data-a="start">START MATCH</button></div>
      </div></div>`);
    e.querySelector('[data-a=leave]').onclick = h.leave;
    e.querySelector('[data-a=copy]').onclick = () => h.copy();
    e.querySelector('[data-a=char]').onclick = h.changeChar;
    e.querySelector('[data-a=ready]').onclick = () => h.ready();
    e.querySelector('[data-a=start]').onclick = h.start;
    this.lobbyHandlers = h; this.lobbyMe = myId;
    this.updateLobby(room);
  }
  updateLobby(room) {
    const e = this.screens.lobby; if (!e) return;
    const h = this.lobbyHandlers, me = this.lobbyMe;
    const isHost = room.hostId === me;
    e.querySelector('#rc').textContent = room.code;
    e.querySelector('#lnk').textContent = h.link(room.code);
    const m = GAME_MODES[room.mode];
    e.querySelector('#modes').innerHTML = MODE_IDS.map((id) => `<div class="mode ${id === room.mode ? 'sel' : ''}" data-id="${id}" style="${isHost ? '' : 'pointer-events:none;opacity:' + (id === room.mode ? 1 : 0.35)}"><div class="t">${GAME_MODES[id].short}</div><div class="d">${GAME_MODES[id].name}</div></div>`).join('');
    e.querySelector('#mdesc').textContent = `${m.description} · ${m.minFighters}–${m.maxFighters} wrestlers`;
    e.querySelectorAll('#modes .mode').forEach((x) => x.onclick = () => h.mode(x.dataset.id));
    const teamSel = (team, dis, attr) => `<select class="field" ${attr} ${dis ? 'disabled' : ''}>${TEAM_COLORS.map((c, i) => `<option value="${i}" ${i === team ? 'selected' : ''}>Team ${i + 1}</option>`).join('')}</select>`;
    const rows = room.players.map((p) => `<div class="slot"><img src="${this.portrait(p.charId)}" /><div class="who">${esc(p.name)} ${p.isHost ? '<span class="tag">HOST</span>' : ''} ${p.id === me ? '<span class="tag">YOU</span>' : ''}<div class="dim" style="font-size:14px">${CHARACTERS[p.charId]?.name || ''}</div></div>
      <span>${p.ready ? '<b style="color:var(--good)">READY</b>' : '<span class="dim">not ready</span>'}</span>${teamSel(p.team, !(isHost || p.id === me) || m.teams !== 'free', `data-pteam="${p.id}"`)}<span></span></div>`);
    const ai = room.ai.map((a, i) => `<div class="slot"><img src="${this.portrait(a.charId)}" /><div class="who">AI · ${CHARACTERS[a.charId].name}<div class="dim" style="font-size:14px">${AI_DIFFICULTY[a.difficulty].name}</div></div>
      <span class="dim">CPU</span>${teamSel(a.team, !isHost || m.teams !== 'free', `data-aiteam="${i}"`)}${isHost ? `<button class="btn small" data-rmai="${i}">✕</button>` : '<span></span>'}</div>`);
    e.querySelector('#slots').innerHTML = rows.concat(ai).join('');
    e.querySelectorAll('[data-pteam]').forEach((s) => s.onchange = () => h.team(s.dataset.pteam, +s.value));
    e.querySelectorAll('[data-aiteam]').forEach((s) => s.onchange = () => h.aiTeam(+s.dataset.aiteam, +s.value));
    e.querySelectorAll('[data-rmai]').forEach((b) => b.onclick = () => h.removeAI(+b.dataset.rmai));
    e.querySelector('#hostai').innerHTML = isHost ? `<span class="dim">ADD AI:</span><select class="field" id="aic">${CHARACTER_IDS.map((c) => `<option value="${c}">${CHARACTERS[c].name}</option>`).join('')}</select>
      <select class="field" id="aid">${Object.entries(AI_DIFFICULTY).map(([k, d]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${d.name}</option>`).join('')}</select><button class="btn small" id="aiadd">ADD</button>` : '<span class="dim">Waiting for the host to start the match…</span>';
    if (isHost) e.querySelector('#aiadd').onclick = () => h.addAI(e.querySelector('#aic').value, e.querySelector('#aid').value);
    const mine = room.players.find((p) => p.id === me);
    e.querySelector('[data-a=ready]').textContent = mine?.ready ? 'NOT READY' : 'READY';
    e.querySelector('[data-a=start]').classList.toggle('hidden', !isHost);
  }
  lobbyError(msg) { const x = this.screens.lobby?.querySelector('#err'); if (x) x.textContent = msg; else this.toast(msg); }

  // ── settings ──
  showSettings({ onBack, onChange }) {
    const s = this.settings.get();
    const range = (k, label) => `<span>${label}</span><input type="range" min="0" max="1" step="0.05" data-k="${k}" value="${s[k]}" />`;
    const e = this.mount('settings', `<div class="screen overlay"><div class="center-panel panel" style="width:min(720px,94vw)"><button class="btn small close-x" data-a="back">BACK</button>
      <h2>SETTINGS</h2><div class="settings-grid">
      <span>Graphics quality</span><select class="field" data-k="quality">${['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<option ${q === s.quality ? 'selected' : ''}>${q}</option>`).join('')}</select>
      ${range('masterVolume', 'Master volume')}${range('sfxVolume', 'Effects volume')}${range('crowdVolume', 'Crowd volume')}${range('voiceVolume', 'Commentary volume')}${range('musicVolume', 'Music volume')}
      <span>Voice commentary</span><select class="field" data-k="voice"><option value="auto">Auto (AI voice when available)</option><option value="ai">AI voice (Gemini)</option><option value="browser">Browser voice</option><option value="off">Off (subtitles only)</option></select>
      <span>AI commentary text</span><select class="field" data-k="aiCommentary"><option value="true">On (when server has a Gemini key)</option><option value="false">Off</option></select>
      <span>Camera</span><select class="field" data-k="cameraMode"><option value="auto">Broadcast (auto)</option><option value="free">Free orbit</option></select>
      <span>Camera shake</span><input type="range" min="0" max="1.5" step="0.1" data-k="cameraShake" value="${s.cameraShake}" />
      <span>Mouse sensitivity</span><input type="range" min="0.2" max="3" step="0.1" data-k="mouseSens" value="${s.mouseSens}" />
      <span>Invert camera Y</span><select class="field" data-k="invertY"><option value="false">No</option><option value="true">Yes</option></select>
      <span>Show controls in match</span><select class="field" data-k="showControls"><option value="true">Yes</option><option value="false">No</option></select>
      <span>Controls</span><select class="field" data-k="inputMode"><option value="pc">PC (keyboard &amp; mouse)</option><option value="mobile">Mobile (on-screen)</option></select>
      </div></div></div>`);
    e.querySelector('[data-k=voice]').value = s.voice;
    e.querySelector('[data-k=aiCommentary]').value = String(s.aiCommentary);
    e.querySelector('[data-k=cameraMode]').value = s.cameraMode;
    e.querySelector('[data-k=invertY]').value = String(s.invertY);
    e.querySelector('[data-k=showControls]').value = String(s.showControls);
    e.querySelector('[data-k=inputMode]').value = s.inputMode || 'pc';
    e.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
      let v = inp.value; if (inp.type === 'range') v = +v; if (v === 'true') v = true; if (v === 'false') v = false;
      this.settings.set({ [inp.dataset.k]: v }); onChange?.(inp.dataset.k, v);
    }));
    e.querySelector('[data-a=back]').onclick = onBack;
  }

  // ── HUD ──
  showHud(fighters, rules, localId, { online = false } = {}) {
    const e = this.mount('hud', `<div id="hud"><div class="hbars"><div class="hgroup" id="hl"></div><div class="hgroup right" id="hr"></div></div>
      <div class="clock"><div class="t" id="clk">5:00</div><div class="m" id="mode">${esc(rules.name).toUpperCase()}</div></div>
      <div class="feed" id="feed"></div><div class="banner" id="ban"></div><div class="pincount" id="pin"></div>
      <div class="prompt" id="prm"></div><div class="commentary" id="com"><div class="who"></div><div class="txt"></div></div>
      <div class="netinfo" id="net"></div><div class="help panel ${this.settings.get().showControls ? '' : 'hidden'}" id="help"><table>${CONTROLS_HELP.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join('')}</table><div class="dim" style="margin-top:6px;font-size:13px">H to hide</div></div></div>`);
    const me = fighters.find((f) => f.id === localId);
    const myTeam = me ? me.team : 0;
    const left = fighters.filter((f) => f.team === myTeam).sort((a, b) => (a.id === localId ? -1 : b.id === localId ? 1 : 0));
    const right = fighters.filter((f) => f.team !== myTeam);
    const bar = (f, mini) => `<div class="hb ${mini ? 'mini' : ''}" data-id="${f.id}"><div class="nm"><span class="team-dot" style="background:${TEAM_COLORS[f.team % 6]}"></span>${esc(getCharacter(f.charId).name)}<span class="sub">${esc(f.name !== getCharacter(f.charId).name ? f.name : '')}${f.isAI ? ' · CPU' : ''}${f.id === localId ? ' · YOU' : ''}</span></div>
      <div class="life"><div class="lag"></div><div class="cur"></div></div>${f.id === localId ? '<div class="sm"><div></div></div><div class="sp"><div></div></div>' : '<div class="sp"><div></div></div>'}</div>`;
    e.querySelector('#hl').innerHTML = left.map((f, i) => bar(f, i > 0)).join('');
    e.querySelector('#hr').innerHTML = right.map((f, i) => bar(f, right.length > 2 || i > 0 && right.length > 1)).join('');
    this.hudEls = { e, bars: new Map([...e.querySelectorAll('.hb')].map((b) => [+b.dataset.id, { el: b, cur: b.querySelector('.cur'), lag: b.querySelector('.lag'), sm: b.querySelector('.sm > div'), sp: b.querySelector('.sp'), spb: b.querySelector('.sp > div') }])),
      clk: e.querySelector('#clk'), feed: e.querySelector('#feed'), ban: e.querySelector('#ban'), pin: e.querySelector('#pin'), prm: e.querySelector('#prm'), com: e.querySelector('#com'), net: e.querySelector('#net'), help: e.querySelector('#help') };
    this.lastPrompt = '';
    clearTimeout(this.helpTimer);
    this.helpTimer = setTimeout(() => this.hudEls?.help.classList.add('fade'), 12000);
  }
  hideHud() { this.unmount('hud'); this.hudEls = null; }
  toggleHelp() { const h = this.hudEls?.help; if (!h) return; if (h.classList.contains('fade')) { h.classList.remove('fade', 'hidden'); } else h.classList.toggle('hidden'); }

  updateHud(view, { abilityStatus, netText }) {
    const H = this.hudEls; if (!H) return;
    for (const f of view.fighters) {
      const b = H.bars.get(f.id); if (!b) continue;
      const hp = Math.max(0, f.hp / f.maxHp);
      b.cur.style.width = (hp * 100).toFixed(1) + '%';
      b.lag.style.width = (hp * 100).toFixed(1) + '%';
      b.el.classList.toggle('low', hp < 0.25);
      b.el.classList.toggle('out', !!f.eliminated || f.state === 'ko');
      if (b.sm) b.sm.style.width = Math.max(0, f.stamina / f.c.maxStamina * 100).toFixed(0) + '%';
      if (b.spb) {
        const cdFrac = f.specialCd > 0 ? 1 - f.specialCd / f.c.specialCooldown : 1;
        b.spb.style.width = Math.min(100, (f.meter / f.c.specialCost) * 100 * cdFrac).toFixed(0) + '%';
        b.sp.classList.toggle('ready', f.meter >= f.c.specialCost && f.specialCd <= 0);
      }
    }
    const t = Math.max(0, view.match.timeLeft ?? 0);
    H.clk.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    H.net.textContent = netText || '';
  }

  prompt(items) {
    const H = this.hudEls; if (!H) return;
    const html = items.map((p) => `<div class="${p.hot ? 'hot' : ''}"><b>${esc(p.key)}</b>${esc(p.text)}</div>`).join('');
    if (html !== this.lastPrompt) { H.prm.innerHTML = html; this.lastPrompt = html; }
  }

  banner(text, sub = '', ms = 1600) {
    const H = this.hudEls; if (!H) return;
    H.ban.innerHTML = `${esc(text)}${sub ? `<span class="s">${esc(sub)}</span>` : ''}`;
    H.ban.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => H.ban.classList.remove('show'), ms);
  }

  feed(text) {
    const H = this.hudEls; if (!H) return;
    const d = document.createElement('div'); d.textContent = text; H.feed.prepend(d);
    while (H.feed.children.length > 4) H.feed.lastChild.remove();
    setTimeout(() => d.remove(), 3200);
  }

  pinCount(n) {
    const H = this.hudEls; if (!H) return;
    H.pin.textContent = n > 0 ? String(n) : ''; H.pin.style.opacity = n > 0 ? 1 : 0;
    clearTimeout(this.pinTimer); this.pinTimer = setTimeout(() => { H.pin.style.opacity = 0; }, 700);
  }

  commentary(who, text, big = false) {
    const H = this.hudEls; if (!H || !this.settings.get().subtitles) return;
    H.com.querySelector('.who').textContent = who.toUpperCase();
    H.com.querySelector('.txt').textContent = text;
    H.com.classList.add('show'); H.com.classList.toggle('big', big);
    clearTimeout(this.comTimer); this.comTimer = setTimeout(() => H.com.classList.remove('show'), 4200);
  }

  damageNumber(x, y, dmg) {
    const H = this.hudEls; if (!H) return;
    const d = document.createElement('div'); d.className = 'dmg'; d.textContent = dmg; d.style.left = x + 'px'; d.style.top = y + 'px';
    H.e.appendChild(d); setTimeout(() => d.remove(), 900);
  }

  // ── pause / results ──
  showPause(h) {
    const e = this.mount('pause', `<div class="screen overlay"><div class="center-panel panel" style="width:min(460px,90vw)"><h2>PAUSED</h2><div class="col">
      <button class="btn primary" data-a="resume">RESUME</button><button class="btn" data-a="settings">SETTINGS</button><button class="btn" data-a="controls">CONTROLS</button>
      <button class="btn" data-a="quit">QUIT TO MENU</button></div>${h.online ? '<div class="dim" style="margin-top:10px">Online match keeps running while paused.</div>' : ''}</div></div>`);
    e.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => h[b.dataset.a]?.());
  }
  hidePause() { this.unmount('pause'); }

  showResults(r, h) {
    const winnerNames = r.winners.map((w) => w.name).join(' & ');
    const e = this.mount('results', `<div class="screen overlay results"><div class="center-panel panel"><div class="dim">${esc(r.modeName)} · ${esc((r.method || '').toUpperCase())}</div>
      <div class="winner">${r.youWon ? 'YOU WIN!' : esc(winnerNames || 'NO CONTEST')}</div><div class="dim" style="font-size:20px">${r.youWon ? esc(winnerNames) + ' is victorious' : 'wins the match'}</div>
      <table><tr><th>WRESTLER</th><th>TEAM</th><th>DAMAGE</th><th>HITS</th><th>SPECIALS</th><th>HEALTH</th></tr>
      ${r.stats.map((s) => `<tr><td><img src="${this.portrait(s.charId)}" style="width:30px;height:30px;vertical-align:middle;margin-right:8px" />${esc(s.name)}</td><td><span class="team-dot" style="background:${TEAM_COLORS[s.team % 6]}"></span></td><td>${s.damage}</td><td>${s.hits}</td><td>${s.specials}</td><td>${Math.max(0, s.hp)}</td></tr>`).join('')}</table>
      <div class="row" style="justify-content:flex-end;margin-top:18px">${h.rematch ? '<button class="btn primary" data-a="rematch">REMATCH</button>' : ''}${h.lobby ? '<button class="btn primary" data-a="lobby">BACK TO LOBBY</button>' : ''}<button class="btn" data-a="menu">MAIN MENU</button></div></div></div>`);
    e.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => h[b.dataset.a]?.());
  }
}
