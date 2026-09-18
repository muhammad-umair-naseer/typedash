'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { randomId, clamp } = require('./util');
const { ACHIEVEMENTS } = require('./achievements');

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** UTC day key, e.g. 2026-09-13. Everyone's streak rolls over at the same instant. */
function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** ISO week key, e.g. 2026-W37. */
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);          // Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Season key: the UTC month, e.g. 2026-09. Seasons are archived on rollover (server/seasons.js). */
function seasonKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const blank = (id, tokenHash) => ({
  id,
  tokenHash,
  name: 'Guest',
  country: 'UN',
  skin: 'dash',
  createdAt: Date.now(),
  lastSeen: Date.now(),

  points: 0,
  races: 0,
  wins: 0,
  podiums: 0,
  chars: 0,
  golden: 0,
  nitros: 0,
  friendlies: 0,
  friendlyWins: 0,

  bestWpm: 0,
  bestCombo: 0,
  bestScore: 0,

  streak: 0,
  bestStreak: 0,
  lastPlayDay: null,

  day: { key: null, points: 0, races: 0, wins: 0 },
  week: { key: null, points: 0, races: 0, wins: 0 },
  season: { key: null, points: 0, races: 0, wins: 0 },
  badges: [],            // seasonal placings: { season, number, rank }
  team: null,            // team id (server/teams.js)
  langs: {},             // finished runs per passage language, e.g. { en: 12, es: 3 }

  achievements: [],
  rivals: {},

  // practice runs (computed in the browser, validated once on submit)
  solo: { runs: 0, finished: 0, bestWpm: 0, bestAcc: 0, pacerWins: 0, chars: 0 },
  // daily challenge (see server/daily.js)
  daily: { last: null, streak: 0, bestStreak: 0, best: 0, count: 0, bestRank: null },
});

const SOLO_BLANK = () => ({ runs: 0, finished: 0, bestWpm: 0, bestAcc: 0, pacerWins: 0, chars: 0 });

/**
 * Persistent player accounts: identity, lifetime stats, ranked points, daily
 * streaks, achievements and head-to-head records.
 *
 * Identity is device-based and sign-up free: the server mints an id plus a
 * secret token on first connect, the browser keeps them in localStorage, and
 * only the token's hash is ever stored. Losing the token just means starting a
 * fresh profile, which is the right trade for a no-signup arcade game.
 */
class Accounts {
  constructor(store) {
    this.store = store;
    this.accounts = store.data.accounts;
    this.beforeSeasonReset = null;   // seasons.js archives the old season before any counter is cleared
  }

  get all() { return Object.values(this.accounts); }
  get size() { return Object.keys(this.accounts).length; }

  /** Resolve an existing account from (id, token) or mint a new one. */
  login(id, token) {
    const acc = id && this.accounts[id];
    if (acc && token && acc.tokenHash === hash(token)) {
      acc.lastSeen = Date.now();
      this.rollWindows(acc);
      this.store.touch();
      return { account: acc, token: null, created: false };
    }
    const newId = `p_${randomId(14)}`;
    const newToken = crypto.randomBytes(24).toString('base64url');
    const fresh = blank(newId, hash(newToken));
    this.accounts[newId] = fresh;
    this.store.touch();
    return { account: fresh, token: newToken, created: true };
  }

  /** Reset per-day / per-week counters when the calendar moves on. */
  rollWindows(acc, now = new Date()) {
    const d = dayKey(now);
    const w = weekKey(now);
    const s = seasonKey(now);
    if (acc.day.key !== d) acc.day = { key: d, points: 0, races: 0, wins: 0 };
    if (acc.week.key !== w) acc.week = { key: w, points: 0, races: 0, wins: 0 };
    if (!acc.season) acc.season = { key: null, points: 0, races: 0, wins: 0 };
    if (acc.season.key !== s) {
      if (acc.season.key && this.beforeSeasonReset) this.beforeSeasonReset(now);
      acc.season = { key: s, points: 0, races: 0, wins: 0 };
    }
    if (!acc.badges) acc.badges = [];
    // a streak dies once a whole day has been missed
    if (acc.lastPlayDay && daysBetween(acc.lastPlayDay, d) > 1 && acc.streak !== 0) acc.streak = 0;
  }

  setIdentity(acc, { name, country, skin }) {
    if (name) acc.name = name;
    if (country) acc.country = country;
    if (skin) acc.skin = skin;
    acc.lastSeen = Date.now();
    this.store.touch();
  }

  /**
   * Ranked points from server-validated race stats. The client's own score,
   * combo and nitro counters are cosmetic; these are the numbers the global
   * boards are built from.
   */
  pointsFor(r, streak) {
    let p = r.chars;                                   // distance covered
    p += Math.round(r.wpm * 3);                        // speed
    if (r.finished) {
      p += r.accuracy >= 100 ? 150 : r.accuracy >= 98 ? 80 : r.accuracy >= 95 ? 30 : 0;
      p += r.rank === 1 ? 200 : r.rank === 2 ? 120 : r.rank === 3 ? 80 : 40;
    }
    p += r.golden * 60;
    p += Math.min(r.bestCombo, r.chars);
    const mult = 1 + Math.min(cfg.STREAK_BONUS_CAP, Math.max(0, streak) * cfg.STREAK_BONUS_STEP);
    return Math.max(10, Math.round(p * mult));
  }

  /**
   * Apply a finished race. Returns everything the client needs to celebrate:
   * points earned, the streak state, and any achievements unlocked.
   */
  recordRace(acc, race, now = new Date()) {
    this.rollWindows(acc, now);
    const streakEvent = this.touchStreak(acc, dayKey(now));

    const r = {
      rank: race.rank,
      wpm: race.wpm,
      accuracy: race.accuracy,
      errors: race.errors,
      finished: !!race.finished,
      chars: race.chars,
      golden: race.golden,
      goldenTotal: race.goldenTotal,
      bestCombo: race.bestCombo,
      nitros: race.nitros,
      score: race.score,
      lane: race.lane,
      racers: race.racers,
      humans: race.humans,
      ranked: !!race.ranked,
      setWr: !!race.setWr,                 // this run became the passage's world record (server/ghosts.js)
      lang: race.lang || 'en',
      category: race.category || 'prose',
      hour: now.getUTCHours(),
    };
    if (r.finished) this.countLang(acc, r.lang);

    const points = r.ranked ? this.pointsFor(r, acc.streak) : 0;

    acc.races += 1;
    acc.chars += r.chars;
    acc.golden += r.golden;
    acc.nitros += r.nitros;
    if (r.rank === 1) acc.wins += 1;
    if (r.rank <= 3) acc.podiums += 1;
    if (r.finished) acc.bestWpm = Math.max(acc.bestWpm, r.wpm);
    acc.bestCombo = Math.max(acc.bestCombo, r.bestCombo);
    acc.bestScore = Math.max(acc.bestScore, r.score || 0);
    if (!r.ranked && r.humans > 1) {
      acc.friendlies += 1;
      if (r.rank === 1) acc.friendlyWins += 1;
    }
    if (points) {
      acc.points += points;
      acc.day.points += points;
      acc.week.points += points;
      acc.season.points += points;
    }
    acc.day.races += 1;
    acc.week.races += 1;
    acc.season.races += 1;
    if (r.rank === 1) { acc.day.wins += 1; acc.week.wins += 1; acc.season.wins += 1; }
    acc.lastSeen = Date.now();

    const unlocked = this.unlock(acc, r, ['race', 'any']);

    this.store.touch();
    return { points, streak: acc.streak, bestStreak: acc.bestStreak, streakEvent, unlocked, ranked: r.ranked };
  }

  countLang(acc, lang) {
    if (!acc.langs) acc.langs = {};
    acc.langs[lang] = (acc.langs[lang] || 0) + 1;
  }

  /** Daily streak: the first finished run of the day keeps it alive. Returns the event, or null if today was already banked. */
  touchStreak(acc, d) {
    if (acc.lastPlayDay === d) return null;
    const gap = acc.lastPlayDay ? daysBetween(acc.lastPlayDay, d) : null;
    let event;
    if (gap === 1) { acc.streak += 1; event = 'extended'; }
    else { event = acc.streak > 1 ? 'reset' : 'started'; acc.streak = 1; }
    acc.lastPlayDay = d;
    acc.bestStreak = Math.max(acc.bestStreak, acc.streak);
    return event;
  }

  /** Evaluate every achievement in `scopes` that the account does not have yet. */
  unlock(acc, r, scopes) {
    const unlocked = [];
    for (const a of ACHIEVEMENTS) {
      if (!scopes.includes(a.scope || 'race')) continue;
      if (acc.achievements.includes(a.id)) continue;
      let ok = false;
      try { ok = !!a.check(acc, r); } catch (_) { ok = false; }
      if (ok) { acc.achievements.push(a.id); unlocked.push(a.id); }
    }
    return unlocked;
  }

  /**
   * Apply a finished practice run (see server/solo.js). Practice never awards
   * ranked points or touches the racing stats the world boards are built
   * from; it keeps the daily streak alive, counts typing volume and tracks a
   * separate practice best.
   */
  recordSolo(acc, run, now = new Date()) {
    this.rollWindows(acc, now);
    const streakEvent = run.finished && cfg.SOLO_STREAK ? this.touchStreak(acc, dayKey(now)) : null;

    const s = (acc.solo ||= SOLO_BLANK());
    s.runs += 1;
    s.chars += run.chars;
    acc.chars += run.chars;
    let improved = false;
    if (run.finished) {
      s.finished += 1;
      this.countLang(acc, run.lang || 'en');
      if (run.wpm > s.bestWpm) { s.bestWpm = run.wpm; improved = true; }
      if (run.accuracy > s.bestAcc) s.bestAcc = run.accuracy;
      if (run.beatPacer) s.pacerWins += 1;
    }
    acc.lastSeen = Date.now();

    const unlocked = this.unlock(acc, { ...run, solo: true, rank: run.beatPacer ? 1 : 2 }, ['solo', 'any']);

    this.store.touch();
    return { streak: acc.streak, bestStreak: acc.bestStreak, streakEvent, unlocked, improved, best: s.bestWpm, runs: s.finished };
  }

  /** Head-to-head record between two humans who raced in the same room. */
  recordHeadToHead(winner, loser) {
    if (!winner || !loser || winner.id === loser.id) return;
    const a = (winner.rivals[loser.id] ||= { n: 0, w: 0, l: 0, name: loser.name, country: loser.country });
    const b = (loser.rivals[winner.id] ||= { n: 0, w: 0, l: 0, name: winner.name, country: winner.country });
    a.n += 1; a.w += 1; a.name = loser.name; a.country = loser.country; a.at = Date.now();
    b.n += 1; b.l += 1; b.name = winner.name; b.country = winner.country; b.at = Date.now();
    // keep the rival list bounded: drop the least-played once it grows large
    for (const acc of [winner, loser]) {
      const ids = Object.keys(acc.rivals);
      if (ids.length > cfg.MAX_RIVALS) {
        ids.sort((x, y) => (acc.rivals[x].at || 0) - (acc.rivals[y].at || 0));
        delete acc.rivals[ids[0]];
      }
    }
    this.store.touch();
  }

  /** Everything the client shows about itself. */
  profile(acc) {
    const rivals = Object.entries(acc.rivals)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => b.n - a.n || (b.at || 0) - (a.at || 0))
      .slice(0, 8);
    return {
      id: acc.id,
      name: acc.name,
      country: acc.country,
      skin: acc.skin,
      points: acc.points,
      races: acc.races,
      wins: acc.wins,
      podiums: acc.podiums,
      chars: acc.chars,
      golden: acc.golden,
      nitros: acc.nitros,
      friendlies: acc.friendlies,
      friendlyWins: acc.friendlyWins,
      bestWpm: acc.bestWpm,
      bestCombo: acc.bestCombo,
      bestScore: acc.bestScore,
      streak: acc.streak,
      bestStreak: acc.bestStreak,
      lastPlayDay: acc.lastPlayDay,
      playedToday: acc.lastPlayDay === dayKey(),
      today: { points: acc.day.points, races: acc.day.races, wins: acc.day.wins },
      week: { points: acc.week.points, races: acc.week.races, wins: acc.week.wins },
      season: { key: acc.season ? acc.season.key : null, points: acc.season ? acc.season.points : 0, races: acc.season ? acc.season.races : 0, wins: acc.season ? acc.season.wins : 0 },
      badges: acc.badges || [],
      team: acc.team || null,
      langs: acc.langs || {},
      push: { devices: (acc.push || []).length, prefs: acc.pushPrefs || null },
      achievements: acc.achievements,
      rivals,
      solo: { ...SOLO_BLANK(), ...(acc.solo || {}) },
      daily: { last: null, streak: 0, bestStreak: 0, best: 0, count: 0, bestRank: null, ...(acc.daily || {}), playedToday: !!(acc.daily && acc.daily.last === dayKey()) },
    };
  }
}

module.exports = { Accounts, dayKey, weekKey, seasonKey, daysBetween, clampPoints: clamp };
