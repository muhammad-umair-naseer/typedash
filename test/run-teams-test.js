'use strict';
/** Teams: create / join / leave rules, team and country boards, pages, tags in lobbies, season trophies. */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/teams.json';
process.env.TEAM_MAX_MEMBERS = '2';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts, boards, teams, seasons, store, _resetCaches } = require('../server/index.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej); });
const race = (rank) => ({ rank, wpm: 70, accuracy: 97, errors: 3, finished: true, chars: 200, golden: 1, goldenTotal: 3, bestCombo: 60, nitros: 1, score: 3000, lane: 1, racers: 4, humans: 2, ranked: true });

class C {
  constructor(url, name, country) {
    this.ws = new WebSocket(url); this.name = name; this.account = null; this.team = undefined; this.errors = []; this.room = null; this.helloOk = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'account') this.account = m; if (m.type === 'team') this.team = m; if (m.type === 'error') this.errors.push(m); if (m.type === 'room') this.room = m; if (m.type === 'hello_ok') this.helloOk = m; });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 8000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + ' (' + this.name + ')' + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  async ask(msg, label) { this.team = undefined; const n = this.errors.length; this.send(msg); await this.until((c) => c.team !== undefined || c.errors.length > n, 5000, label); return this.team !== undefined ? this.team : { error: this.errors[n].message }; }
  close() { this.ws.close(); }
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const url = `ws://localhost:${server.address().port}`;
  const a = new C(url, 'Umair', 'PK');
  const b = new C(url, 'Sara', 'SA');
  const c = new C(url, 'Kenji', 'JP');
  await Promise.all([a.ready, b.ready, c.ready]);
  for (const x of [a, b, c]) await x.until((y) => y.account, 4000, 'account');

  /* ---------------- create / validation ---------------- */
  assert.ok(/at least 3/.test((await a.ask({ type: 'team_create', name: 'ab', tag: 'ABC' }, 'short name')).error));
  assert.ok(/Tag must/.test((await a.ask({ type: 'team_create', name: 'Speed Demons', tag: 'TOOLONG' }, 'bad tag')).error));
  const made = await a.ask({ type: 'team_create', name: 'Speed <Demons>', tag: 'spd' }, 'create');
  assert.ok(made.team && made.team.tag === 'SPD' && made.team.name === 'Speed Demons', 'created (tag upper-cased, name sanitised)');
  assert.strictEqual(made.team.size, 1);
  assert.ok(made.team.members[0].owner, 'creator owns it');
  assert.ok(made.unlocked.includes('team_join'), 'Squad up achievement');
  assert.strictEqual(made.profile.team, made.team.id);
  const invite = teams.get(made.team.id).invite;
  assert.ok(/^[A-Z0-9]{6}$/.test(invite), 'invite code minted');
  assert.ok(/taken/.test((await b.ask({ type: 'team_create', name: 'Copycats', tag: 'SPD' }, 'dup tag')).error), 'tag uniqueness');
  assert.ok(/already in a team/.test((await a.ask({ type: 'team_create', name: 'Second', tag: 'TWO' }, 'second team')).error));
  console.log(`✓ create: validation, sanitising, uniqueness, one team per account (invite ${invite})`);

  /* ---------------- join / cap / leave ---------------- */
  assert.ok(/No team/.test((await b.ask({ type: 'team_join', code: 'ZZZZZZ' }, 'bad code')).error));
  const joined = await b.ask({ type: 'team_join', code: invite.toLowerCase() }, 'join');
  assert.strictEqual(joined.team.size, 2, 'joined (case-insensitive code)');
  assert.ok(/full/.test((await c.ask({ type: 'team_join', code: invite }, 'full')).error), 'member cap enforced');
  await a.until((x) => x.helloOk, 1000, 'hello');
  a.send({ type: 'hello', name: 'Umair', country: 'PK' });
  await wait(150);
  assert.strictEqual(a.helloOk.player.tag, 'SPD', 'tag on the player after hello');
  a.send({ type: 'create' });
  await a.until((x) => x.room, 3000, 'room');
  assert.strictEqual(a.room.players.find((p) => p.id === a.helloOk.player.id).tag, 'SPD', 'tag visible in room state');
  a.send({ type: 'leave' });
  console.log('✓ join by code, cap, tags in hello + room state');

  /* ---------------- boards ---------------- */
  accounts.recordRace(accounts.accounts[a.account.id], race(1));
  accounts.recordRace(accounts.accounts[b.account.id], race(2));
  accounts.recordRace(accounts.accounts[c.account.id], race(1));
  _resetCaches();
  const tRows = boards.rows('teams', 'season', 'global');
  assert.strictEqual(tRows.length, 1);
  assert.strictEqual(tRows[0].value, accounts.accounts[a.account.id].points + accounts.accounts[b.account.id].points, 'team points = members summed');
  assert.strictEqual(tRows[0].members, 2);
  const cRows = boards.rows('countries', 'week', 'global');
  assert.deepStrictEqual(cRows.map((r) => r.id).sort(), ['JP', 'PK', 'SA'], 'countries board');
  assert.strictEqual(cRows.find((r) => r.id === 'PK').players, 1);
  assert.ok(boards.meta().categories.some((x) => x.id === 'teams') && boards.meta().categories.some((x) => x.id === 'countries'), 'boards advertised');
  const view = teams.view(teams.get(made.team.id), boards);
  assert.strictEqual(view.season.rank, 1);
  assert.strictEqual(view.members[0].name, 'Umair', 'members sorted by season points');
  const api = JSON.parse((await get(`${base}/api/team/${made.team.id}`)).body);
  assert.strictEqual(api.tag, 'SPD');
  assert.strictEqual((await get(`${base}/api/team/t_nope00`)).status, 404);
  const page = await get(`${base}/t/${made.team.id}`);
  assert.ok(page.status === 200 && page.body.includes('[SPD] Speed Demons') && page.body.includes('>Umair<') && page.body.includes('"@type":"SportsTeam"'), 'team page');
  _resetCaches();
  const lb = (await get(`${base}/leaderboard`)).body;
  assert.ok(lb.includes('[SPD] Speed Demons') && lb.includes('Countries') && lb.includes('Pakistan'), 'leaderboard shows teams + countries');
  console.log('✓ team + country boards, /api/team, /t/:id page, /leaderboard sections');

  /* ---------------- season archive gives trophies ---------------- */
  const key = accounts.accounts[a.account.id].season.key;
  seasons.archive(key);
  const t = teams.get(made.team.id);
  assert.deepStrictEqual(t.trophies.map((x) => x.rank), [1], 'team trophy');
  assert.ok(accounts.accounts[a.account.id].badges.some((x) => x.team === 'SPD' && x.rank === 1), 'member badge carries the tag');
  assert.ok(accounts.accounts[a.account.id].achievements.includes('team_top3'), 'Dynasty achievement');
  assert.ok(store.data.teamSeasons[key] && store.data.teamSeasons[key].top[0].id === t.id, 'team season archived');
  console.log('✓ season archive: team trophy, member badges, Dynasty');

  /* ---------------- leave: ownership passes, empty team dies ---------------- */
  const left = await a.ask({ type: 'team_leave' }, 'owner leaves');
  assert.strictEqual(left.team, null);
  assert.strictEqual(teams.get(made.team.id).ownerId, b.account.id, 'ownership passed to Sara');
  const rot = await b.ask({ type: 'team_rotate' }, 'rotate');
  assert.notStrictEqual(teams.get(made.team.id).invite, invite, 'invite rotated by the new owner');
  assert.ok(rot.team);
  await b.ask({ type: 'team_leave' }, 'last leaves');
  assert.strictEqual(teams.get(made.team.id), null, 'empty team deleted');
  assert.strictEqual(accounts.accounts[b.account.id].team, null);
  console.log('✓ leave: ownership transfer, invite rotation, empty team removed');

  for (const x of [a, b, c]) x.close();
  await wait(150);
  console.log('\nALL TEAM TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
