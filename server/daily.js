'use strict';
const cfg = require('./config');
const passages = require('./passages');
const { dayKey, daysBetween } = require('./accounts');
const { thin, PB_SAMPLES } = require('./ghosts');

/**
 * The Daily Challenge: one passage per UTC day, the same for everyone, with
 * the same golden words. Everybody types it in practice mode (entirely in
 * the browser) and the server keeps one scored entry per account per day —
 * by default the first verified, finished run, so it is one shot, like a
 * crossword. Later runs are still fine as practice; they just do not count.
 *
 * Results live in store.data.daily[day] and are swept after DAILY_KEEP_DAYS.
 */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prevDay(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
}

/** Daily #1 is DAILY_EPOCH. */
function numberFor(day) {
  return daysBetween(cfg.DAILY_EPOCH, day) + 1;
}

/** Index into the pool for a day, nudged so two consecutive days never share a passage. */
function indexFor(day, n, depth = 2) {
  const raw = hash32(`typedash-daily:${day}`) % n;
  if (n < 2 || depth === 0) return raw;
  const prev = indexFor(prevDay(day), n, depth - 1);
  return raw === prev ? (raw + 1) % n : raw;
}

/** Deterministic challenge for a UTC day key: passage plus golden words. */
function challengeFor(day) {
  const pool = passages.list({ lang: 'en', category: 'prose' });   // the daily is always English prose: everyone can type it
  const p = pool[indexFor(day, pool.length)];
  const bonusWords = passages.pickBonusWords(p.text, cfg.BONUS_WORDS, mulberry32(hash32(`golden:${day}:${p.id}`)));
  return { day, number: numberFor(day), passage: p, bonusWords };
}

class Daily {
  constructor(store, accounts) {
    this.store = store;
    this.accounts = accounts;
    this.data = store.data.daily || (store.data.daily = {});
    this.onChange = null;
    this.summaryCache = null;
  }

  today(now = new Date()) {
    return challengeFor(dayKey(now));
  }

  dayRecord(day, passageId) {
    if (!this.data[day]) {
      this.data[day] = { passageId, entries: {}, plays: 0 };
      this.sweep(day);
    }
    return this.data[day];
  }

  /** Drop results older than DAILY_KEEP_DAYS. */
  sweep(day = dayKey()) {
    for (const k of Object.keys(this.data)) {
      if (daysBetween(k, day) > cfg.DAILY_KEEP_DAYS) delete this.data[k];
    }
  }

  /**
   * Apply a finished daily run for an account. Only verified runs of today's
   * passage are scored; the reply says whether this one counted and where it
   * ranks right now.
   */
  record(acc, r, now = new Date()) {
    const day = dayKey(now);
    const ch = challengeFor(day);
    const number = ch.number;
    if (r.passageId !== ch.passage.id) return { counted: false, reason: 'not-today', number };
    if (!r.finished) return { counted: false, reason: 'unfinished', number };
    if (!r.verified) return { counted: false, reason: 'unverified', number };

    const rec = this.dayRecord(day, ch.passage.id);
    rec.plays += 1;
    const existing = rec.entries[acc.id] || null;
    const attempts = existing ? existing.attempts + 1 : 1;
    const of = () => Object.keys(rec.entries).length;

    if (existing && attempts > cfg.DAILY_ATTEMPTS) {
      existing.attempts = attempts;
      this.touch();
      return { counted: false, reason: 'already-played', number, entry: this.publicEntry(existing), rank: this.rankOf(day, acc.id), of: of(), streak: acc.daily ? acc.daily.streak : 0 };
    }

    const better = !existing || r.wpm > existing.wpm || (r.wpm === existing.wpm && (r.accuracy > existing.accuracy || (r.accuracy === existing.accuracy && r.time < existing.time)));
    if (better) {
      rec.entries[acc.id] = {
        wpm: r.wpm, accuracy: r.accuracy, time: r.time, errors: r.errors, at: Date.now(), attempts,
        name: acc.name, country: acc.country, skin: acc.skin,
      };
    } else {
      existing.attempts = attempts;
    }

    // account side: how many dailies, the daily streak, best speed
    const d = (acc.daily ||= { last: null, streak: 0, bestStreak: 0, best: 0, count: 0, bestRank: null });
    const first = !existing;
    if (first) {
      const gap = d.last ? daysBetween(d.last, day) : null;
      d.streak = gap === 1 ? d.streak + 1 : 1;
      d.bestStreak = Math.max(d.bestStreak || 0, d.streak);
      d.last = day;
      d.count += 1;
    }
    d.best = Math.max(d.best, r.wpm);
    const rank = this.rankOf(day, acc.id);
    if (rank && (!d.bestRank || rank < d.bestRank)) d.bestRank = rank;
    // the leader's replay is what everyone else races against
    if (rank === 1 && Array.isArray(r.timeline) && r.timeline.length >= 2) {
      rec.leaderGhost = { name: acc.name, country: acc.country, skin: acc.skin, wpm: r.wpm, accuracy: r.accuracy, time: r.time, timeline: thin(r.timeline, PB_SAMPLES) };
    }

    this.touch();
    return { counted: true, number, first, entry: this.publicEntry(rec.entries[acc.id]), rank, of: of(), streak: d.streak };
  }

  touch() {
    this.summaryCache = null;
    this.store.touch();
    if (this.onChange) this.onChange();
  }

  publicEntry(e) {
    return { wpm: e.wpm, accuracy: e.accuracy, time: e.time, attempts: e.attempts };
  }

  /** Board rows for a day: fastest first, ties by accuracy then time. */
  rows(day = dayKey()) {
    const rec = this.data[day];
    if (!rec) return [];
    return Object.entries(rec.entries)
      .map(([id, e]) => ({ id, name: e.name, country: e.country, skin: e.skin, value: e.wpm, tie: e.accuracy, accuracy: e.accuracy, time: e.time, races: 1, streak: 0 }))
      .sort((a, b) => b.value - a.value || b.tie - a.tie || a.time - b.time || a.name.localeCompare(b.name))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  rankOf(day, id) {
    const row = this.rows(day).find((r) => r.id === id);
    return row ? row.rank : null;
  }

  /** What the home page needs: today's challenge, how many played, the top few, and the caller's own entry. */
  summary(meId = null, now = new Date()) {
    const day = dayKey(now);
    if (!this.summaryCache || this.summaryCache.day !== day || Date.now() - this.summaryCache.at > 5000) {
      const ch = challengeFor(day);
      const rows = this.rows(day);
      const rec = this.data[day];
      this.summaryCache = {
        day,
        at: Date.now(),
        body: {
          day,
          number: ch.number,
          passage: { id: ch.passage.id, title: ch.passage.title, text: ch.passage.text, words: ch.passage.words },
          bonusWords: ch.bonusWords,
          plays: rec ? rec.plays : 0,
          players: rows.length,
          top: rows.slice(0, 10).map(({ id, rank, name, country, skin, value, accuracy, time }) => ({ id, rank, name, country, skin, wpm: value, accuracy, time })),
          leaderGhost: rec && rec.leaderGhost ? rec.leaderGhost : null,
          endsAt: Date.parse(`${day}T00:00:00Z`) + 86400000,
        },
        rows,
      };
    }
    const c = this.summaryCache;
    const mine = meId ? c.rows.find((r) => r.id === meId) : null;
    return { ...c.body, me: mine ? { rank: mine.rank, wpm: mine.value, accuracy: mine.accuracy, time: mine.time, of: c.rows.length } : null };
  }
}

module.exports = { Daily, challengeFor, numberFor, indexFor, hash32, mulberry32 };
