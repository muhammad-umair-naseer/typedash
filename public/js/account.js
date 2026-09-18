/**
 * The player's persistent identity and progression.
 *
 * The server owns the numbers (points, streak, stats, achievements, rivals)
 * because they feed the worldwide boards; this class keeps the browser's half
 * of the deal: the id/token pair that proves who you are, a cached copy of the
 * profile for instant first paint, and the level curve the UI draws.
 */
import { SKINS, skinFor } from './skins.js';

const KEY = 'td_account_v1';
const CACHE = 'td_profile_cache_v1';

export const TITLES = [
  [1, 'Rookie'], [3, 'Cadet'], [5, 'Racer'], [8, 'Turbo'], [11, 'Nitro Head'],
  [14, 'Speed Demon'], [18, 'Keyboard Ace'], [22, 'Blazer'], [27, 'Legend'], [35, 'Immortal'],
];

/** Cumulative ranked points needed to *reach* a level (level 1 = 0). */
export function pointsForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(400 * Math.pow(level - 1, 1.6));
}

export function levelForPoints(points) {
  let lvl = 1;
  while (pointsForLevel(lvl + 1) <= points) lvl++;
  return lvl;
}

export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (level >= min) t = name;
  return t;
}

const EMPTY = {
  points: 0, races: 0, wins: 0, podiums: 0, chars: 0, golden: 0, nitros: 0,
  friendlies: 0, friendlyWins: 0, bestWpm: 0, bestCombo: 0, bestScore: 0,
  streak: 0, bestStreak: 0, playedToday: false,
  today: { points: 0, races: 0, wins: 0 }, week: { points: 0, races: 0, wins: 0 },
  achievements: [], rivals: [],
};

export class Account {
  constructor() {
    this.id = null;
    this.token = null;
    this.profile = { ...EMPTY };
    this.standings = [];
    this.catalogue = [];       // achievement definitions, sent by the server
    this.boardMeta = null;     // categories + windows the server supports
    this.skin = localStorage.getItem('td_skin') || 'dash';
    this.synced = false;

    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && saved.id && saved.token) { this.id = saved.id; this.token = saved.token; }
      const cached = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (cached) this.profile = { ...EMPTY, ...cached };
    } catch (_) { /* private mode or corrupt storage: run signed-out */ }

    if (skinFor(this.skin).unlock > this.level) this.skin = 'dash';
  }

  /** Credentials to send with `hello`. */
  get credentials() {
    return this.id && this.token ? { accountId: this.id, token: this.token } : {};
  }

  /** Server replied to our handshake. */
  onAccount(msg) {
    if (msg.id) this.id = msg.id;
    if (msg.token) this.token = msg.token;     // only present when freshly minted
    if (this.id && this.token) {
      try { localStorage.setItem(KEY, JSON.stringify({ id: this.id, token: this.token })); } catch (_) { /* ignore */ }
    }
    this.setProfile(msg.profile, msg.standings);
    this.synced = true;
  }

  setProfile(profile, standings) {
    if (profile) {
      this.profile = { ...EMPTY, ...profile };
      if (profile.skin) this.skin = profile.skin;
      try { localStorage.setItem(CACHE, JSON.stringify(this.profile)); } catch (_) { /* ignore */ }
    }
    if (standings) this.standings = standings;
  }

  get points() { return this.profile.points || 0; }
  get level() { return levelForPoints(this.points); }
  get title() { return titleFor(this.level); }
  get stats() { return this.profile; }
  get streak() { return this.profile.streak || 0; }
  get bestStreak() { return this.profile.bestStreak || 0; }
  get playedToday() { return !!this.profile.playedToday; }
  get achievements() { return this.profile.achievements || []; }
  get rivals() { return this.profile.rivals || []; }

  /** [points into this level, span of this level, fraction 0..1] */
  get levelProgress() {
    const lvl = this.level;
    const lo = pointsForLevel(lvl);
    const hi = pointsForLevel(lvl + 1);
    return [this.points - lo, hi - lo, Math.min(1, (this.points - lo) / (hi - lo))];
  }

  has(id) { return this.achievements.includes(id); }

  achievement(id) { return this.catalogue.find((a) => a.id === id) || { id, icon: '🏅', name: id, desc: '' }; }

  unlockedSkins() { return SKINS.filter((s) => s.unlock <= this.level); }

  setSkin(id) {
    const s = skinFor(id);
    if (!s || s.unlock > this.level) return false;
    this.skin = s.id;
    try { localStorage.setItem('td_skin', s.id); } catch (_) { /* ignore */ }
    return true;
  }

  /** A race settled on the server. Returns what to celebrate. */
  applyResult(msg) {
    const before = this.level;
    this.setProfile(msg.profile, msg.standings);
    const after = this.level;
    return {
      points: msg.points || 0,
      ranked: !!msg.ranked,
      streak: msg.streak || 0,
      streakEvent: msg.streakEvent,
      unlocked: (msg.unlocked || []).map((id) => this.achievement(id)),
      levelBefore: before,
      levelAfter: after,
      leveledUp: after > before,
      newSkins: after > before ? SKINS.filter((s) => s.unlock > before && s.unlock <= after) : [],
      series: msg.series || [],
    };
  }
}
