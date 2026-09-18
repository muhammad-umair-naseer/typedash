'use strict';
const cfg = require('./config');
const Room = require('./Room');
const { roomCode } = require('./util');

class RoomManager {
  constructor({ accounts = null, boards = null } = {}) {
    this.rooms = new Map();
    this.accounts = accounts;      // persistent accounts (server/accounts.js)
    this.boards = boards;          // ranking boards (server/leaderboards.js)
    this.onRaceSettled = null;
    this.timer = setInterval(() => this.tick(), cfg.TICK_MS);
    this.timer.unref?.();
  }

  createRoom(isPrivate, opts = {}) {
    let code;
    do { code = roomCode(); } while (this.rooms.has(code));
    const room = new Room(this, { code, isPrivate, lang: opts.lang, category: opts.category });
    this.rooms.set(code, room);
    return room;
  }

  destroyRoom(room) {
    this.rooms.delete(room.code);
  }

  /**
   * Public matchmaking: prefer the fullest lobby that is still waiting, then a
   * room showing results (its next race starts shortly), else open a new one.
   */
  quickMatch(player, opts = {}) {
    const lang = opts.lang || 'en';
    const category = opts.category || 'prose';
    let best = null;
    let fallback = null;
    for (const r of this.rooms.values()) {
      if (r.isPrivate || r.isFull || r.lang !== lang || r.category !== category) continue;
      if (r.state === 'waiting') {
        if (!best || r.humanCount > best.humanCount) best = r;
      } else if (r.state === 'finished' && !fallback) {
        fallback = r;
      }
    }
    const room = best || fallback || this.createRoom(false, { lang, category });
    room.addPlayer(player);
    return room;
  }

  createPrivate(player, opts = {}) {
    const room = this.createRoom(true, opts);
    room.addPlayer(player);
    return room;
  }

  join(player, rawCode) {
    const code = String(rawCode || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) throw new Error('Room not found. Check the code and try again.');
    if (room.isFull) throw new Error('That room is full.');
    if (room.state === 'racing') throw new Error('A race is in progress there. Try again in a minute.');
    room.addPlayer(player);
    return room;
  }

  leave(player) {
    if (player.room) player.room.removePlayer(player);
  }

  tick() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      try { room.tick(now); } catch (err) { console.error(`[room ${room.code}]`, err); }
    }
  }


  stats() {
    let racing = 0;
    let humans = 0;
    for (const r of this.rooms.values()) {
      if (r.state === 'racing') racing++;
      humans += r.humanCount;
    }
    return { rooms: this.rooms.size, racing, inRooms: humans };
  }
}

module.exports = RoomManager;
