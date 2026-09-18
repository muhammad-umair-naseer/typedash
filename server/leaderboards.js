'use strict';
const cfg = require('./config');
const { dayKey, weekKey, seasonKey } = require('./accounts');

/**
 * Ranking boards. Every board is a (category, window, scope) triple:
 *
 *   category  points | wpm | combo | wins | streak | golden | races
 *   window    all | today | week          (points/wins/races only)
 *   scope     global | <2-letter country>
 *
 * Boards are computed on demand from the account table and cached briefly, so
 * a busy lobby doesn't re-sort the world on every keystroke. The response
 * always carries the caller's own rank, even when they're nowhere near the top.
 */
const CATEGORIES = {
  points: { label: 'Points', windows: ['all', 'season', 'week', 'today'], value: (a, w) => (w === 'all' ? a.points : w === 'today' ? a.day.points : w === 'season' ? (a.season ? a.season.points : 0) : a.week.points), format: 'points' },
  wpm: { label: 'Fastest', windows: ['all'], value: (a) => a.bestWpm, format: 'wpm' },
  combo: { label: 'Longest run', windows: ['all'], value: (a) => a.bestCombo, format: 'combo' },
  wins: { label: 'Wins', windows: ['all', 'season', 'week', 'today'], value: (a, w) => (w === 'all' ? a.wins : w === 'today' ? a.day.wins : w === 'season' ? (a.season ? a.season.wins : 0) : a.week.wins), format: 'wins' },
  streak: { label: 'Days in a row', windows: ['all'], value: (a) => a.streak, tiebreak: (a) => a.bestStreak, format: 'streak' },
  golden: { label: 'Bonus words', windows: ['all'], value: (a) => a.golden, format: 'golden' },
};

const WINDOWS = { all: 'All time', season: 'This season', week: 'This week', today: 'Today' };

class Leaderboards {
  constructor(accounts) {
    this.accounts = accounts;
    this.cache = new Map(); // key -> { at, rows }
    this.sources = {};      // boards whose rows come from elsewhere (e.g. today's daily challenge)
  }

  static get meta() {
    return {
      categories: Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, windows: c.windows, format: c.format })),
      windows: WINDOWS,
    };
  }

  /** Categories plus registered sources — what the client renders tabs from. */
  meta() {
    const m = Leaderboards.meta;
    for (const [id, s] of Object.entries(this.sources)) m.categories.push({ id, label: s.label, windows: s.windows, format: s.format });
    return m;
  }

  /**
   * Register a board computed outside the account table. `rows()` returns
   * unsorted rows shaped like the account rows ({ id, name, country, skin,
   * value, tie, ... }); scope filtering, sorting, ranking and caching are
   * handled here like any other board.
   */
  register(id, { label, windows = ['all'], format = 'points', rows }) {
    this.sources[id] = { label, windows, format, rows };
  }

  def(category) {
    return CATEGORIES[category] || this.sources[category] || null;
  }

  key(category, window, scope) {
    return `${category}|${window}|${scope}`;
  }

  /** Sorted rows for a board (all entries with a non-zero value). */
  rows(category, window, scope) {
    const cat = this.def(category);
    if (!cat) return [];
    const win = cat.windows.includes(window) ? window : cat.windows[0];
    const k = this.key(category, win, scope);
    const hit = this.cache.get(k);
    const now = Date.now();
    if (hit && now - hit.at < cfg.BOARD_CACHE_MS) return hit.rows;

    if (cat.rows) { // an external source
      const rows = cat.rows(win, this.live.bind(this)).filter((r) => scope === 'global' || r.country === scope);
      rows.sort((x, y) => y.value - x.value || (y.tie || 0) - (x.tie || 0) || x.name.localeCompare(y.name));
      rows.forEach((r, i) => { r.rank = i + 1; });
      this.cache.set(k, { at: now, rows });
      return rows;
    }

    // stale per-day/week counters belong to an older calendar window
    const d = dayKey();
    const w = weekKey();
    const s = seasonKey();
    const live = (a) => {
      if (win === 'today') return a.day.key === d;
      if (win === 'week') return a.week.key === w;
      if (win === 'season') return !!a.season && a.season.key === s;
      return true;
    };

    const rows = [];
    for (const a of this.accounts.all) {
      if (scope !== 'global' && a.country !== scope) continue;
      if (!live(a)) continue;
      const v = cat.value(a, win);
      if (!v) continue;
      rows.push({
        id: a.id,
        name: a.name,
        country: a.country,
        skin: a.skin,
        value: v,
        tie: cat.tiebreak ? cat.tiebreak(a) : a.points,
        streak: a.streak,
        races: a.races,
      });
    }
    rows.sort((x, y) => y.value - x.value || y.tie - x.tie || x.name.localeCompare(y.name));
    rows.forEach((r, i) => { r.rank = i + 1; });
    this.cache.set(k, { at: now, rows });
    return rows;
  }

  /** Do this account's counters belong to the current window? (stale day/week/season counters are ignored) */
  live(a, win) {
    if (win === 'today') return a.day.key === dayKey();
    if (win === 'week') return a.week.key === weekKey();
    if (win === 'season') return !!a.season && a.season.key === seasonKey();
    return true;
  }

  /** Top slice of a board plus the caller's own row, wherever it sits. */
  board(category, window, scope, meId) {
    const cat = this.def(category) ? category : 'points';
    const def = this.def(cat);
    const win = def.windows.includes(window) ? window : def.windows[0];
    const sc = scope && /^[A-Z]{2}$/.test(scope) ? scope : 'global';
    const rows = this.rows(cat, win, sc);
    const top = rows.slice(0, cfg.BOARD_SIZE);
    const mine = meId ? rows.find((r) => r.id === meId) || null : null;
    return {
      type: 'board',
      category: cat,
      window: win,
      scope: sc,
      total: rows.length,
      entries: top,
      me: mine,
      inTop: !!(mine && mine.rank <= cfg.BOARD_SIZE),
    };
  }

  /** Compact "where do I stand" summary for the profile card. */
  standings(acc) {
    if (!acc) return [];
    const out = [];
    const push = (category, window, scope) => {
      const rows = this.rows(category, window, scope);
      const row = rows.find((r) => r.id === acc.id);
      out.push({ category, window, scope, rank: row ? row.rank : null, of: rows.length, value: row ? row.value : 0 });
    };
    push('points', 'all', 'global');
    push('points', 'all', acc.country);
    push('points', 'season', 'global');
    push('points', 'today', 'global');
    push('wpm', 'all', 'global');
    push('streak', 'all', 'global');
    return out;
  }

  invalidate() {
    this.cache.clear();
  }
}

module.exports = { Leaderboards, CATEGORIES, WINDOWS };
