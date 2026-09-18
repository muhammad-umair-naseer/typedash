'use strict';
/**
 * Daily challenge test: one passage per UTC day for everyone, one scored
 * attempt per account, a board of today's results, and a daily streak.
 * Runs are submitted the way the browser does (practice mode, one message).
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/daily.json';
process.env.SOLO_START_SLACK_MS = '60000';   // no need to sleep through the stamp check here
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts, daily } = require('../server/index.js');
const { challengeFor, numberFor } = require('../server/daily.js');
const { dayKey } = require('../server/accounts.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej);
});

class C {
  constructor(url, name, country = 'PK') {
    this.ws = new WebSocket(url); this.name = name; this.msgs = []; this.account = null; this.result = null; this.errors = []; this.board = null; this.welcome = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'welcome') this.welcome = m;
      if (m.type === 'account') this.account = m;
      if (m.type === 'race_result') this.result = m;
      if (m.type === 'error') this.errors.push(m);
      if (m.type === 'board') this.board = m;
    });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 8000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + ' (' + this.name + ')' + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  close() { this.ws.close(); }
}

function runFor(passage, time, extra = {}) {
  const len = passage.text.length;
  const timeline = [];
  for (let t = 250; t < time; t += 250) timeline.push([t, Math.min(len, Math.floor((len * t) / time))]);
  timeline.push([time, len]);
  return { type: 'solo_done', mode: 'daily', passageId: passage.id, chars: len, finished: true, time, keystrokes: len + 2, errors: 2, golden: 1, goldenTotal: 3, bestCombo: 50, nitros: 0, score: 3000, timeline, ...extra };
}

/** Play today's daily the way the browser does: stamp, then one result. */
async function play(c, passage, time, stamped = true) {
  c.result = null;
  if (stamped) c.send({ type: 'solo_start', passageId: passage.id, mode: 'daily' });
  await wait(30);
  c.send(runFor(passage, time));
  await c.until((x) => x.result, 5000, 'daily result');
  return c.result;
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const url = `ws://localhost:${port}`;
  const base = `http://localhost:${port}`;

  /* ---------------- the challenge itself ---------------- */
  const today = dayKey();
  const ch = challengeFor(today);
  assert.deepStrictEqual(challengeFor(today), ch, 'deterministic for the day');
  assert.strictEqual(ch.number, numberFor(today));
  assert.ok(ch.bonusWords.length === cfg.BONUS_WORDS && ch.bonusWords.every((i) => i > 0), 'seeded golden words');
  let repeats = 0;
  let prev = null;
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(2027, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    const id = challengeFor(d).passage.id;
    if (id === prev) repeats++;
    prev = id;
  }
  assert.ok(repeats <= 1, `consecutive days (almost) never share a passage (${repeats} repeats in 200 days)`);
  const api = JSON.parse((await get(`${base}/api/daily`)).body);
  assert.strictEqual(api.number, ch.number);
  assert.strictEqual(api.passage.id, ch.passage.id);
  assert.deepStrictEqual(api.bonusWords, ch.bonusWords);
  assert.strictEqual(api.players, 0);
  assert.strictEqual(api.me, null);
  assert.ok(api.endsAt > Date.now() && api.endsAt - Date.now() <= 86400000, 'endsAt is the next UTC midnight');
  console.log(`✓ Daily #${ch.number} = "${ch.passage.title}" (${ch.passage.id}), golden ${JSON.stringify(ch.bonusWords)}, deterministic, served by /api/daily`);
  const passage = ch.passage;
  const len = passage.text.length;
  const minTime = Math.ceil((len / cfg.MAX_CPS) * 1000);

  /* ---------------- two players, one attempt each ---------------- */
  const a = new C(url, 'Umair', 'PK');
  const b = new C(url, 'Sara', 'SA');
  await Promise.all([a.ready, b.ready]);
  await a.until((c) => c.account && c.welcome, 4000, 'account');
  await b.until((c) => c.account, 4000, 'account');
  assert.ok(a.welcome.boards.categories.some((c) => c.id === 'daily' && c.windows.includes('today') && c.format === 'wpm'), 'daily board advertised in welcome');

  const ra = await play(a, passage, minTime + 500);
  assert.ok(ra.daily && ra.daily.counted === true, 'first verified run counts');
  assert.strictEqual(ra.daily.first, true);
  assert.strictEqual(ra.daily.rank, 1);
  assert.strictEqual(ra.daily.of, 1);
  assert.strictEqual(ra.daily.streak, 1);
  assert.strictEqual(ra.daily.number, ch.number);
  assert.strictEqual(ra.solo.mode, 'daily');
  assert.ok(ra.unlocked.includes('daily_first'), `daily achievement (${ra.unlocked})`);
  assert.strictEqual(ra.profile.daily.count, 1);
  assert.strictEqual(ra.profile.daily.playedToday, true);
  assert.strictEqual(ra.points, 0, 'no ranked points from the daily');
  console.log(`✓ Umair: ${ra.solo.wpm} WPM counted, rank #${ra.daily.rank} of ${ra.daily.of}, daily streak ${ra.daily.streak}`);

  const rb = await play(b, passage, minTime * 2);
  assert.strictEqual(rb.daily.counted, true);
  assert.strictEqual(rb.daily.rank, 2, 'slower run ranks second');
  assert.strictEqual(rb.daily.of, 2);
  console.log(`✓ Sara: ${rb.solo.wpm} WPM counted, rank #${rb.daily.rank} of ${rb.daily.of}`);

  const ra2 = await play(a, passage, minTime + 100);       // even faster, but the first attempt stands
  assert.strictEqual(ra2.daily.counted, false, 'second attempt does not count');
  assert.strictEqual(ra2.daily.reason, 'already-played');
  assert.strictEqual(ra2.daily.entry.wpm, ra.solo.wpm, 'scored entry unchanged');
  assert.strictEqual(ra2.daily.entry.attempts, 2);
  assert.strictEqual(ra2.daily.rank, 1);
  assert.strictEqual(ra2.profile.daily.count, 1, 'still one daily completed');
  assert.strictEqual(ra2.solo.improved, true, 'it still counts as practice (new practice best)');
  console.log('✓ a second attempt is practice only; the first stays on the board');

  /* ---------------- the board ---------------- */
  a.board = null;
  a.send({ type: 'board', category: 'daily', window: 'today', scope: 'global' });
  await a.until((c) => c.board && c.board.category === 'daily', 4000, 'daily board');
  assert.deepStrictEqual(a.board.entries.map((e) => e.name), ['Umair', 'Sara']);
  assert.strictEqual(a.board.entries[0].value, ra.solo.wpm);
  assert.strictEqual(a.board.me.rank, 1);
  a.board = null;
  a.send({ type: 'board', category: 'daily', window: 'today', scope: 'SA' });
  await a.until((c) => c.board && c.board.scope === 'SA', 4000, 'daily board (SA)');
  assert.deepStrictEqual(a.board.entries.map((e) => e.name), ['Sara'], 'country scope applies to the daily board');
  const mine = JSON.parse((await get(`${base}/api/daily?me=${a.account.id}`)).body);
  assert.strictEqual(mine.me.rank, 1);
  assert.strictEqual(mine.players, 2);
  assert.strictEqual(mine.plays, 3);
  assert.deepStrictEqual(mine.top.map((t) => t.name), ['Umair', 'Sara']);
  console.log('✓ daily board: global + country scope, /api/daily?me= carries my rank');

  /* ---------------- runs that must not count ---------------- */
  const c3 = new C(url, 'Ghost', 'IN');
  await c3.ready;
  await c3.until((c) => c.account, 4000, 'account');
  const unverified = await play(c3, passage, minTime * 3, false);   // no start stamp
  assert.strictEqual(unverified.daily.counted, false);
  assert.strictEqual(unverified.daily.reason, 'unverified');
  const other = require('../server/passages.js').PASSAGES.find((p) => p.id !== passage.id);
  const wrong = await play(c3, other, minTime * 3);
  assert.strictEqual(wrong.daily.counted, false);
  assert.strictEqual(wrong.daily.reason, 'not-today');
  assert.strictEqual(daily.rows().length, 2, 'neither reached the board');
  console.log('✓ unverified runs and other passages never count');

  /* ---------------- daily streak maths (direct) ---------------- */
  const acc = accounts.accounts[c3.account.id];
  const run = (day) => ({ passageId: challengeFor(day).passage.id, finished: true, verified: true, wpm: 60, accuracy: 97, time: 30000, errors: 3 });
  const d1 = daily.record(acc, run('2027-03-01'), new Date('2027-03-01T10:00:00Z'));
  const d2 = daily.record(acc, run('2027-03-02'), new Date('2027-03-02T10:00:00Z'));
  const d3 = daily.record(acc, run('2027-03-04'), new Date('2027-03-04T10:00:00Z'));
  assert.deepStrictEqual([d1.streak, d2.streak, d3.streak], [1, 2, 1], 'consecutive days extend, a gap resets');
  assert.strictEqual(acc.daily.bestStreak, 2);
  assert.strictEqual(acc.daily.count, 3);
  assert.ok(daily.data['2027-03-01'] && daily.data['2027-03-04'], 'per-day records kept');
  daily.dayRecord('2027-05-20', 'x');                             // 80 days on: 03-01 is stale, 03-04 too, 05-20 is new
  assert.ok(!daily.data['2027-03-01'] && !daily.data['2027-03-04'], 'days older than DAILY_KEEP_DAYS are swept');
  assert.ok(daily.data['2027-05-20'], 'the day being recorded survives the sweep');
  console.log('✓ daily streak: 1 -> 2 -> reset; old days swept after', cfg.DAILY_KEEP_DAYS, 'days');

  for (const c of [a, b, c3]) c.close();
  await wait(150);
  console.log('\nALL DAILY TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
