'use strict';
const cfg = require('./config');
const { seasonKey } = require('./accounts');

/**
 * Seasons: every calendar month (UTC) the points race starts again. Accounts
 * keep a per-season counter (rolled lazily like day/week); when a month ends
 * the finished season is archived once — top 100 with ranks — and the
 * placings become badges on the accounts. All-time points are untouched, so a
 * newcomer always has a board they can actually climb this month.
 */
function seasonNumber(key) {
  const [y, m] = key.split('-').map(Number);
  const [ey, em] = cfg.SEASON_EPOCH.split('-').map(Number);
  return (y - ey) * 12 + (m - em) + 1;
}

/** First millisecond after the season (UTC). */
function seasonEnd(key) {
  const [y, m] = key.split('-').map(Number);
  return Date.UTC(y, m, 1);
}

class Seasons {
  constructor(store, accounts) {
    this.store = store;
    this.accounts = accounts;
    this.data = store.data.seasons || (store.data.seasons = {});
    if (!store.data.seasonCurrent) store.data.seasonCurrent = null;
    this.onArchived = null;
    // archive before any account clears its counters for the new month
    accounts.beforeSeasonReset = (now) => this.check(now);
  }

  get current() { return this.store.data.seasonCurrent; }

  /** Roll the calendar forward. Idempotent and cheap unless a month just ended. */
  check(now = new Date()) {
    const key = seasonKey(now);
    const cur = this.store.data.seasonCurrent;
    if (cur === key) return null;
    if (cur && cur < key && !this.data[cur]) this.archive(cur);
    this.store.data.seasonCurrent = key;
    this.store.touch();
    return cur;
  }

  /** Freeze a finished season: ranked top 100, badges for everyone on it. */
  archive(key) {
    const rows = this.accounts.all
      .filter((a) => a.season && a.season.key === key && a.season.points > 0)
      .map((a) => ({ id: a.id, name: a.name, country: a.country, skin: a.skin, points: a.season.points, races: a.season.races, wins: a.season.wins }))
      .sort((x, y) => y.points - x.points || y.wins - x.wins || x.name.localeCompare(y.name))
      .map((r, i) => ({ ...r, rank: i + 1 }));
    const number = seasonNumber(key);
    this.data[key] = { key, number, endedAt: seasonEnd(key), players: rows.length, top: rows.slice(0, 100) };
    for (const r of this.data[key].top) {
      const acc = this.accounts.accounts[r.id];
      if (!acc) continue;
      (acc.badges ||= []).push({ season: key, number, rank: r.rank });
      this.accounts.unlock(acc, {}, ['season']);
    }
    // keep the archive bounded
    const keys = Object.keys(this.data).sort();
    while (keys.length > cfg.SEASON_KEEP) delete this.data[keys.shift()];
    this.store.touch();
    if (this.onArchived) this.onArchived(this.data[key]);
    return this.data[key];
  }

  /** Past seasons, newest first. */
  past(limit = 12) {
    return Object.values(this.data).sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, limit);
  }

  /** What the home page and /leaderboard show: the running season and a glance at past ones. */
  summary(boards, meId = null, now = new Date()) {
    const key = seasonKey(now);
    const rows = boards.rows('points', 'season', 'global');
    const mine = meId ? rows.find((r) => r.id === meId) : null;
    return {
      key,
      number: seasonNumber(key),
      endsAt: seasonEnd(key),
      players: rows.length,
      top: rows.slice(0, 10).map(({ id, rank, name, country, skin, value }) => ({ id, rank, name, country, skin, points: value })),
      me: mine ? { rank: mine.rank, points: mine.value, of: rows.length } : null,
      past: this.past(12).map((s) => ({ key: s.key, number: s.number, players: s.players, top: s.top.slice(0, 3).map(({ id, rank, name, country, points }) => ({ id, rank, name, country, points })) })),
    };
  }
}

module.exports = { Seasons, seasonNumber, seasonEnd };
