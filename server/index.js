// RING KINGS game server
//  • serves the built client (dist/) – one Render Web Service can host everything
//  • WebSocket endpoint /ws for lobbies + authoritative matches
//  • /api/config, /api/commentary, /api/tts (optional Gemini), /healthz
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { LobbyManager } from './LobbyManager.js';
import { GeminiProvider } from './gemini.js';
import { PROTOCOL_VERSION } from '../shared/net/protocol.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.resolve(ROOT, process.env.STATIC_DIR || 'dist');
const PORT = Number(process.env.PORT || 3000);
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
const log = { info: (...a) => console.log(new Date().toISOString(), ...a), warn: (...a) => console.warn(new Date().toISOString(), ...a) };

const gemini = new GeminiProvider(process.env, log);
const lobby = new LobbyManager({ commentary: gemini, log });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const gzCache = new Map();

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (ALLOWED.includes('*') || ALLOWED.includes(origin)) return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  return {};
}

function json(res, code, obj, extra = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function clientKey(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon').toString().split(',')[0].trim(); }

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(p)) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(DIST, 'index.html'); // SPA fallback (invite links etc.)
  }
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('Client not built. Run `npm run build` (or use `npm run dev` for development).');
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  headers['Cache-Control'] = ext === '.html' ? 'no-cache' : p.startsWith('/assets/') && /-[A-Za-z0-9_]{8,}\./.test(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const st = fs.statSync(file);
    const key = file + ':' + st.mtimeMs;
    let gz = gzCache.get(key);
    if (!gz) { gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 }); gzCache.set(key, gz); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length, 'Vary': 'Accept-Encoding' });
    return res.end(gz);
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  try {
    if (url.pathname === '/healthz') return json(res, 200, { ok: true, ...lobby.stats(), uptime: process.uptime() }, cors);
    if (url.pathname === '/api/config') return json(res, 200, { ai: gemini.enabled, tts: gemini.ttsEnabled, protocol: PROTOCOL_VERSION }, cors);
    if (url.pathname === '/api/stats') return json(res, 200, lobby.stats(), cors);
    if (url.pathname === '/api/room' && req.method === 'GET') {
      const r = lobby.get(url.searchParams.get('code'));
      return json(res, r ? 200 : 404, r ? { code: r.code, players: r.size, state: r.state, mode: r.mode } : { error: 'Room not found' }, cors);
    }
    if (url.pathname === '/api/commentary' && req.method === 'POST') {
      if (!gemini.enabled) return json(res, 503, { fallback: true }, cors);
      const body = await readBody(req);
      if (typeof body.key !== 'string' || body.key.length > 40) return json(res, 400, { error: 'bad key' }, cors);
      const ctx = typeof body.ctx === 'object' && body.ctx ? Object.fromEntries(Object.entries(body.ctx).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), Array.isArray(v) ? v.slice(0, 6).map(String) : String(v ?? '').slice(0, 60)])) : {};
      const text = await gemini.generate({ key: body.key, ctx, speaker: { role: body.speaker === 'color' ? 'colour' : 'pbp' } }, clientKey(req));
      return text ? json(res, 200, { text, source: 'gemini' }, cors) : json(res, 503, { fallback: true }, cors);
    }
    if (url.pathname === '/api/tts' && req.method === 'POST') {
      if (!gemini.ttsEnabled) return json(res, 503, { fallback: true }, cors);
      const body = await readBody(req);
      const audio = await gemini.tts(String(body.text || '').slice(0, 200), body.speaker | 0, clientKey(req));
      if (!audio) return json(res, 503, { fallback: true }, cors);
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store', ...cors });
      return res.end(audio);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (e) {
    log.warn('request error', req.url, e.message);
    if (!res.headersSent) json(res, 500, { error: 'server error' }, cors);
  }
});

// ── WebSocket ──
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED.includes('*') && !ALLOWED.includes(origin)) { ws.close(1008, 'origin not allowed'); return; }
  const player = { id: crypto.randomUUID().slice(0, 8), name: 'Guest', ws, room: null, charId: null, alive: true, msgs: 0, window: Date.now() };
  ws.on('pong', () => { player.alive = true; });
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  send({ t: 'welcome', id: player.id, protocol: PROTOCOL_VERSION });

  const leave = () => {
    if (player.room) { player.room.removePlayer(player.id); if (player.room.size === 0) lobby.remove(player.room); player.room = null; }
  };
  const enter = (room) => {
    leave();
    const err = room.addPlayer(player);
    if (err) { send({ t: 'error', message: err }); return false; }
    player.room = room; return true;
  };

  ws.on('message', (data) => {
    // flood protection
    const now = Date.now();
    if (now - player.window > 1000) { player.window = now; player.msgs = 0; }
    if (++player.msgs > 150) return;
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const setName = () => { if (msg.name) player.name = String(msg.name).replace(/[^\w \-.!]/g, '').slice(0, 16) || 'Guest'; };
    switch (msg.t) {
      case 'hello': setName(); break;
      case 'create': setName(); { const r = lobby.create(!!msg.public); if (msg.charId) player.charId = msg.charId; enter(r); } break;
      case 'join': {
        setName(); if (msg.charId) player.charId = msg.charId;
        const r = lobby.get(msg.code);
        if (!r) send({ t: 'error', message: `Room ${String(msg.code || '').toUpperCase()} not found` }); else enter(r);
        break;
      }
      case 'quick': setName(); if (msg.charId) player.charId = msg.charId; enter(lobby.quickMatch()); break;
      case 'leave': leave(); send({ t: 'left' }); break;
      case 'ping': send({ t: 'pong', ts: msg.ts, server: now }); break;
      default: if (player.room) player.room.handle(player, msg);
    }
  });
  ws.on('close', leave);
  ws.on('error', leave);
});

// heartbeat: Render (and most proxies) drop idle sockets – ping every 25s
wss.on('connection', (ws) => { ws.isAliveFlag = true; ws.on('pong', () => { ws.isAliveFlag = true; }); });
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAliveFlag === false) { ws.terminate(); continue; }
    ws.isAliveFlag = false; ws.ping();
  }
}, 25000).unref?.();

server.listen(PORT, () => log.info(`RING KINGS server on :${PORT}  (static: ${fs.existsSync(DIST) ? DIST : 'not built'})`));

export { server, lobby };
