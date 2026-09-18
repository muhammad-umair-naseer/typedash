'use strict';
/* Ranking / streak / friendly integration test against a live server. */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/tdrank/db.json';
// short timers so a full lifecycle runs in seconds
process.env.LOBBY_WAIT_MS ||= '1500';
process.env.COUNTDOWN_MS ||= '1000';
process.env.RESULTS_MS ||= '1500';
process.env.AFTER_FIRST_FINISH_MS ||= '2500';
process.env.HUMANS_DONE_GRACE_MS ||= '1200';
process.env.BOARD_PUSH_MS ||= '500';
const assert = require('assert');
const WebSocket = require('ws');
const { server, accounts, boards } = require('../server/index.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(url, name, country, creds = {}) {
    this.ws = new WebSocket(url); this.name = name; this.msgs = []; this.room = null; this.account = null; this.result = null; this.board = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'welcome') this.id = m.id;
      if (m.type === 'account') this.account = m;
      if (m.type === 'room') this.room = m;
      if (m.type === 'race_result') this.result = m;
      if (m.type === 'board') this.board = m;
    });
    this.ready.then(() => this.send({ type: 'hello', name, country, skin: 'bolt', ...creds }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 20000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(25); } throw new Error('timeout: ' + label + ' (' + this.name + ')'); }
  close() { this.ws.close(); }
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const url = `ws://localhost:${server.address().port}`;

  // ---------- ranked public race ----------
  const a = new C(url, 'Umair', 'PK');
  const b = new C(url, 'Sara', 'PK');
  await Promise.all([a.ready, b.ready]);
  await a.until((c) => c.account, 4000, 'account minted');
  await b.until((c) => c.account, 4000, 'account minted');
  assert.ok(a.account.token && a.account.created, 'new account gets a token');
  const creds = { accountId: a.account.id, token: a.account.token };
  console.log('✓ accounts minted:', a.account.id, b.account.id);

  a.send({ type: 'quick' }); b.send({ type: 'quick' });
  await a.until((c) => c.room && c.room.state === 'racing', 20000, 'racing');
  assert.strictEqual(a.room.ranked, true, 'public rooms are ranked');
  const len = a.room.passage.length;
  const type = (c, chars, extra = {}) => c.send({ type: 'progress', c: chars, t: chars, k: chars, e: 0, s: chars * 12, x: chars, g: 2, z: 3, ...extra });
  // stay under the server's typing-rate ceiling (MAX_CPS): 12 chars per 500 ms
  for (let i = 12; i <= len; i += 12) { type(a, Math.min(i, len)); type(b, Math.min(i, Math.round(len * 0.6))); await wait(500); }
  type(a, len);
  await a.until((c) => c.result, 60000, 'race_result for Umair');
  await b.until((c) => c.result, 60000, 'race_result for Sara');
  console.log('✓ ranked result:', { points: a.result.points, ranked: a.result.ranked, streak: a.result.streak, ach: a.result.unlocked.length });
  assert.ok(a.result.points > 0 && a.result.ranked, 'ranked points awarded');
  assert.strictEqual(a.result.streak, 1, 'streak starts at 1');
  assert.ok(a.result.profile.points >= a.result.points, 'profile carries points');
  assert.ok(a.result.unlocked.includes('first_race'), 'achievements unlocked server-side');
  assert.ok(a.result.profile.rivals.some((r) => r.name === 'Sara'), 'head-to-head recorded');
  assert.ok(a.result.points > b.result.points, 'the winner scores more');
  assert.ok(a.result.standings.find((s) => s.category === 'points' && s.scope === 'global').rank >= 1, 'world rank present');

  // ---------- boards ----------
  a.send({ type: 'board', category: 'points', window: 'all', scope: 'global' });
  await a.until((c) => c.board, 4000, 'board reply');
  assert.strictEqual(a.board.entries[0].name, 'Umair', 'winner tops the points board');
  assert.strictEqual(a.board.me.id, a.account.id, 'my row is included');
  a.board = null;
  a.send({ type: 'board', category: 'wpm', window: 'all', scope: 'PK' });
  await a.until((c) => c.board && c.board.category === 'wpm', 4000, 'country board');
  assert.ok(a.board.entries.every((e) => e.country === 'PK'), 'country scope filters');
  console.log('✓ boards:', a.board.category, a.board.scope, a.board.entries.map((e) => `${e.rank}.${e.name}:${e.value}`).join(' '));
  a.board = null;
  a.send({ type: 'board', category: 'streak', window: 'all', scope: 'global' });
  await a.until((c) => c.board && c.board.category === 'streak', 4000, 'streak board');
  assert.ok(a.board.entries.length >= 2, 'streak board populated');
  console.log('✓ streak board:', a.board.entries.map((e) => `${e.name}:${e.value}`).join(' '));

  a.send({ type: 'leave' }); b.send({ type: 'leave' });
  await wait(200);

  // ---------- friendly (private) race: unranked, but streak + rivals still count ----------
  const pointsBefore = accounts.accounts[a.account.id].points;
  a.send({ type: 'create' });
  await a.until((c) => c.room && c.room.isPrivate, 4000, 'private room');
  assert.strictEqual(a.room.ranked, false, 'private rooms are friendlies');
  const code = a.room.code;
  b.result = null; a.result = null;
  b.send({ type: 'join', code });
  await b.until((c) => c.room && c.room.code === code, 4000, 'friend joined');
  a.send({ type: 'start', bots: false });
  await a.until((c) => c.room.state === 'racing', 20000, 'friendly racing');
  const len2 = a.room.passage.length;
  for (let i = 12; i <= len2; i += 12) { type(a, Math.min(i, len2)); await wait(500); }
  type(a, len2);
  await a.until((c) => c.result, 60000, 'friendly result');
  console.log('✓ friendly result:', { points: a.result.points, ranked: a.result.ranked, series: a.result.series.map((s) => s.name + ':' + s.wins).join(' ') });
  assert.strictEqual(a.result.ranked, false, 'friendly race is unranked');
  assert.strictEqual(a.result.points, 0, 'no ranked points from a friendly');
  assert.strictEqual(accounts.accounts[a.account.id].points, pointsBefore, 'global points untouched');
  assert.strictEqual(a.result.streak, 1, 'streak still alive');
  assert.ok(a.result.profile.friendlies >= 1, 'friendly counted');
  assert.ok(a.result.series.find((s) => s.id === a.id).wins >= 1, 'room series tracks wins');

  // ---------- identity survives a reconnect ----------
  a.close(); b.close();
  await wait(200);
  const back = new C(url, 'Umair', 'PK', creds);
  await back.until((c) => c.account, 4000, 're-login');
  assert.strictEqual(back.account.created, false, 'existing account resumed');
  assert.strictEqual(back.account.id, creds.accountId, 'same id');
  assert.ok(back.account.profile.points === pointsBefore, 'points survived the reconnect');
  console.log('✓ reconnect resumed account with', back.account.profile.points, 'points,', back.account.profile.races, 'races');

  // ---------- streak maths ----------
  const acc = accounts.accounts[creds.accountId];
  acc.lastPlayDay = '2020-01-01';
  accounts.rollWindows(acc, new Date('2020-01-03T10:00:00Z'));
  assert.strictEqual(acc.streak, 0, 'a missed day breaks the streak');
  acc.lastPlayDay = '2020-01-02';
  acc.streak = 4;
  const r = accounts.recordRace(acc, { rank: 1, wpm: 80, accuracy: 100, errors: 0, finished: true, chars: 200, golden: 1, goldenTotal: 3, bestCombo: 90, nitros: 1, score: 5000, lane: 1, racers: 3, humans: 1, ranked: true }, new Date('2020-01-03T10:00:00Z'));
  assert.strictEqual(r.streak, 5, 'consecutive day extends the streak');
  assert.strictEqual(r.streakEvent, 'extended');
  console.log('✓ streak: 4 -> 5 on the next day, points with bonus =', r.points);

  back.close();
  await wait(150);
  console.log('\nALL RANKING TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
