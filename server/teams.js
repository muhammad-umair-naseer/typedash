'use strict';
const cfg = require('./config');
const { roomCode, sanitizeText } = require('./util');
const { nameOf, isCountry } = require('./countries');

/**
 * Teams and country standings. A team is a named group with a short tag that
 * shows next to its members in every lobby; its score in any window is the
 * sum of its members' ranked points in that window, so recruiting a fast
 * friend is the way up. Countries work the same way with no sign-up at all:
 * every ranked point you earn also counts for your flag.
 *
 * Both are plain aggregations over the account table, computed on demand and
 * cached by the board layer like every other board.
 */
const TAG_RE = /^[A-Z0-9]{2,4}$/;

class Teams {
  constructor(store, accounts) {
    this.store = store;
    this.accounts = accounts;
    this.data = store.data.teams || (store.data.teams = {});
    this.seasons = store.data.teamSeasons || (store.data.teamSeasons = {});
  }

  get(id) { return this.data[String(id || '')] || null; }
  byTag(tag) { return Object.values(this.data).find((t) => t.tag === tag) || null; }
  byInvite(code) { return Object.values(this.data).find((t) => t.invite === String(code || '').toUpperCase()) || null; }
  of(acc) { return acc && acc.team ? this.get(acc.team) : null; }

  create(acc, { name, tag }) {
    if (acc.team && this.get(acc.team)) throw new Error('You are already in a team. Leave it first.');
    const cleanName = sanitizeText(name, cfg.TEAM_NAME_MAX);
    const cleanTag = String(tag || '').toUpperCase().trim();
    if (cleanName.length < 3) throw new Error('Team name needs at least 3 characters.');
    if (!TAG_RE.test(cleanTag)) throw new Error('Tag must be 2 to 4 letters or digits.');
    if (this.byTag(cleanTag)) throw new Error(`Tag ${cleanTag} is taken.`);
    let id;
    do { id = `t_${roomCode(6).toLowerCase()}`; } while (this.data[id]);
    let invite;
    do { invite = roomCode(6); } while (this.byInvite(invite));
    const team = { id, name: cleanName, tag: cleanTag, ownerId: acc.id, members: [acc.id], invite, createdAt: Date.now(), trophies: [] };
    this.data[id] = team;
    acc.team = id;
    this.store.touch();
    return team;
  }

  join(acc, code) {
    const team = this.byInvite(code);
    if (!team) throw new Error('No team has that invite code.');
    if (acc.team === team.id) return team;
    if (acc.team && this.get(acc.team)) throw new Error('You are already in a team. Leave it first.');
    if (team.members.length >= cfg.TEAM_MAX_MEMBERS) throw new Error('That team is full.');
    team.members.push(acc.id);
    acc.team = team.id;
    this.store.touch();
    return team;
  }

  leave(acc) {
    const team = this.of(acc);
    acc.team = null;
    if (!team) { this.store.touch(); return null; }
    team.members = team.members.filter((id) => id !== acc.id);
    if (team.members.length === 0) delete this.data[team.id];
    else if (team.ownerId === acc.id) team.ownerId = team.members[0];
    this.store.touch();
    return team.members.length ? team : null;
  }

  /** Fresh invite code (owner only). */
  rotateInvite(acc) {
    const team = this.of(acc);
    if (!team || team.ownerId !== acc.id) throw new Error('Only the team owner can do that.');
    do { team.invite = roomCode(6); } while (Object.values(this.data).some((t) => t !== team && t.invite === team.invite));
    this.store.touch();
    return team;
  }

  pointsIn(acc, win) {
    if (win === 'season') return acc.season ? acc.season.points : 0;
    if (win === 'week') return acc.week.points;
    if (win === 'today') return acc.day.points;
    return acc.points;
  }

  /** Board rows: one per team, summed over its members. `live` keeps stale windows out (same rule as the account boards). */
  rows(win, live) {
    const rows = [];
    for (const team of Object.values(this.data)) {
      let value = 0;
      let races = 0;
      for (const id of team.members) {
        const a = this.accounts.accounts[id];
        if (!a || !live(a, win)) continue;
        value += this.pointsIn(a, win);
        races += win === 'all' ? a.races : win === 'season' ? (a.season ? a.season.races : 0) : win === 'week' ? a.week.races : a.day.races;
      }
      if (!value) continue;
      rows.push({ id: team.id, name: `[${team.tag}] ${team.name}`, tag: team.tag, country: 'UN', skin: 'checker', value, tie: team.members.length, members: team.members.length, races, streak: 0 });
    }
    return rows;
  }

  /** Country standings: every ranked point counts for the flag. */
  countryRows(win, live) {
    const sums = new Map();
    for (const a of this.accounts.all) {
      if (!isCountry(a.country) || !live(a, win)) continue;
      const v = this.pointsIn(a, win);
      if (!v) continue;
      const s = sums.get(a.country) || { id: a.country, name: nameOf(a.country), country: a.country, skin: 'flag', value: 0, tie: 0, players: 0, races: 0, streak: 0 };
      s.value += v;
      s.players += 1;
      s.tie = s.players;
      sums.set(a.country, s);
    }
    return [...sums.values()];
  }

  /** Public view of a team with its members' contributions. */
  view(team, boards) {
    const rows = boards.rows('teams', 'season', 'global');
    const row = rows.find((r) => r.id === team.id);
    const allRows = boards.rows('teams', 'all', 'global');
    const allRow = allRows.find((r) => r.id === team.id);
    const members = team.members.map((id) => this.accounts.accounts[id]).filter(Boolean)
      .map((a) => ({ id: a.id, name: a.name, country: a.country, skin: a.skin, points: a.points, season: a.season ? a.season.points : 0, bestWpm: a.bestWpm, owner: a.id === team.ownerId }))
      .sort((x, y) => y.season - x.season || y.points - x.points);
    return {
      id: team.id, name: team.name, tag: team.tag, createdAt: team.createdAt, trophies: team.trophies || [],
      members, size: team.members.length, max: cfg.TEAM_MAX_MEMBERS,
      season: { points: row ? row.value : 0, rank: row ? row.rank : null, of: rows.length },
      allTime: { points: allRow ? allRow.value : 0, rank: allRow ? allRow.rank : null, of: allRows.length },
    };
  }

  /** A season ended: record the team podium and hand out trophies. */
  archiveSeason(key, seasonNumber, live) {
    const rows = this.rows('season', (a) => a.season && a.season.key === key && live(a, 'season'))
      .sort((x, y) => y.value - x.value || y.tie - x.tie)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    this.seasons[key] = { key, number: seasonNumber, top: rows.slice(0, 20) };
    for (const r of rows.slice(0, 3)) {
      const team = this.get(r.id);
      if (!team) continue;
      (team.trophies ||= []).push({ season: key, number: seasonNumber, rank: r.rank });
      for (const id of team.members) {
        const a = this.accounts.accounts[id];
        if (a) { (a.badges ||= []).push({ season: key, number: seasonNumber, rank: r.rank, team: team.tag }); this.accounts.unlock(a, {}, ['season']); }
      }
    }
    this.store.touch();
    return this.seasons[key];
  }
}

module.exports = { Teams, TAG_RE };
