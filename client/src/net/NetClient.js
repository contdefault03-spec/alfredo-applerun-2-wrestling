// NetClient – WebSocket connection to the game server with auto-reconnect,
// typed message handlers and RTT measurement.
import { wsUrl } from './endpoints.js';

export class NetClient {
  constructor() {
    this.ws = null; this.handlers = {}; this.connected = false; this.rtt = 0; this.id = null;
    this.queue = []; this.wantOpen = false; this.retry = 0;
  }
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return () => { this.handlers[type] = this.handlers[type].filter((f) => f !== fn); }; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); for (const fn of this.handlers['*'] || []) fn(msg); }

  connect() {
    this.wantOpen = true;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return this.ready();
    const ws = new WebSocket(wsUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true; this.retry = 0;
      for (const m of this.queue) ws.send(m); this.queue = [];
      this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
      this.emit('open', {});
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') this.id = m.id;
      if (m.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - m.ts) * 0.2 : performance.now() - m.ts;
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      this.connected = false; clearInterval(this.pingTimer);
      this.emit('close', {});
      if (this.wantOpen && this.retry < 5) { this.retry++; setTimeout(() => this.wantOpen && this.connect(), 600 * this.retry); }
    };
    ws.onerror = () => this.emit('neterror', { message: 'Connection error – is the game server running?' });
    return this.ready();
  }
  ready() {
    return new Promise((res, rej) => {
      if (this.connected) return res();
      const off1 = this.on('open', () => { off1(); off2(); res(); });
      const off2 = this.on('neterror', (m) => { off1(); off2(); rej(new Error(m.message)); });
      setTimeout(() => { off1(); off2(); if (!this.connected) rej(new Error('Could not reach the game server')); }, 8000);
    });
  }
  send(m) {
    const s = JSON.stringify(m);
    if (this.connected && this.ws.readyState === 1) this.ws.send(s); else if (m.t !== 'input' && m.t !== 'ping') this.queue.push(s);
  }
  close() { this.wantOpen = false; this.ws?.close(); this.connected = false; }
}
