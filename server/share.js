'use strict';
const { randomId } = require('./util');

const RESULT_TTL_MS = 30 * 60000;   // a settled result can be shared for half an hour
const RESULT_MAX = 20000;           // in-memory results kept before the oldest are dropped
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Share links. Every settled result gets a short-lived in-memory result id
 * (sent to the client in `race_result`). Only when the player actually shares
 * does it become a persistent share record with a public page (/r/:id) and a
 * card image (/og/r/:id.png), so the store never fills with results nobody
 * looked at twice. Shares are bounded to SHARE_KEEP newest.
 */
class Shares {
  constructor(store, { keep = 5000 } = {}) {
    this.store = store;
    this.keep = keep;
    this.data = store.data.shares || (store.data.shares = {});
    this.results = new Map();  // resultId -> { accountId, at, data, shareId }
  }

  /** Remember a settled result. Returns the result id for the client. */
  remember(accountId, data) {
    const id = randomId(12);
    this.results.set(id, { accountId, at: Date.now(), data, shareId: null });
    if (this.results.size > RESULT_MAX) {
      const cutoff = Date.now() - RESULT_TTL_MS;
      for (const [k, v] of this.results) {
        if (v.at < cutoff || this.results.size > RESULT_MAX) this.results.delete(k); else break;
      }
    }
    return id;
  }

  shortId() {
    let id;
    do {
      id = '';
      for (let i = 0; i < 8; i++) id += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    } while (this.data[id]);
    return id;
  }

  /** Turn a remembered result into a public share. Returns the share id, or null. */
  create(accountId, resultId) {
    const r = this.results.get(resultId);
    if (!r || r.accountId !== accountId || Date.now() - r.at > RESULT_TTL_MS) return null;
    if (r.shareId && this.data[r.shareId]) return r.shareId;
    const id = this.shortId();
    this.data[id] = { ...r.data, accountId, at: Date.now(), views: 0 };
    r.shareId = id;
    this.bound();
    this.store.touch();
    return id;
  }

  get(id) {
    const s = this.data[String(id || '')];
    return s || null;
  }

  viewed(id) {
    const s = this.get(id);
    if (s) { s.views = (s.views || 0) + 1; this.store.touch(); }
  }

  bound() {
    const ids = Object.keys(this.data);
    if (ids.length <= this.keep) return;
    ids.sort((a, b) => this.data[a].at - this.data[b].at);
    for (const id of ids.slice(0, ids.length - this.keep)) delete this.data[id];
  }

  /** The text a player posts alongside the link. */
  static text(s, url) {
    const acc = `${s.accuracy}%`;
    if (s.kind === 'daily') return `TypeDash Daily #${s.dailyNumber}: ${s.wpm} WPM · ${acc}${s.rank ? ` · #${s.rank} of ${s.of} today` : ''}. Your turn: ${url}`;
    if (s.kind === 'practice') return `${s.wpm} WPM at ${acc} on TypeDash. Beat my ghost: ${url}`;
    const place = s.rank === 1 ? '1st' : s.rank === 2 ? '2nd' : s.rank === 3 ? '3rd' : `${s.rank}th`;
    return `I came ${place} of ${s.of} with ${s.wpm} WPM (${acc}) in a TypeDash race — can you beat me? ${url}`;
  }
}

module.exports = { Shares };
