// LobbyManager – room codes, joining, quick-match and cleanup.
import { Room } from './Room.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
const ROOM_IDLE_MS = 30 * 60 * 1000;

export class LobbyManager {
  constructor({ commentary = null, log = console } = {}) {
    this.rooms = new Map();
    this.commentary = commentary;
    this.log = log;
    setInterval(() => this.cleanup(), 60 * 1000).unref?.();
  }

  code() {
    for (let tries = 0; tries < 100; tries++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('no room codes left');
  }

  create(isPublic = false) {
    const room = new Room(this.code(), { isPublic, commentary: this.commentary, log: this.log });
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code || '').trim().toUpperCase()) || null; }

  /** Join the fullest open public lobby, or create a new public one. */
  quickMatch() {
    let best = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.state !== 'lobby' || r.size >= 4) continue;
      if (!best || r.size > best.size) best = r;
    }
    return best || this.create(true);
  }

  remove(room) { room.stopMatch(); this.rooms.delete(room.code); }

  cleanup() {
    const now = Date.now();
    for (const r of this.rooms.values()) {
      if (r.size === 0 || now - r.lastActive > ROOM_IDLE_MS) this.remove(r);
    }
  }

  stats() {
    let players = 0, matches = 0;
    for (const r of this.rooms.values()) { players += r.size; if (r.state === 'match') matches++; }
    return { rooms: this.rooms.size, players, matches };
  }
}
