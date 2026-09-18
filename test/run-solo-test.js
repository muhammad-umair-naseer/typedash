'use strict';
/**
 * Practice-mode protocol test. Practice runs are computed in the browser; the
 * server only stamps the start and validates one submitted result. This test
 * drives that submit path directly: plausible runs are accepted and recorded,
 * impossible ones are refused, and nothing about a practice run leaks into
 * the racing stats or the ranked boards.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/solo.json';
process.env.LOBBY_WAIT_MS ||= '1500';
process.env.COUNTDOWN_MS ||= '800';
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts } = require('../server/index.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const get = (url, headers = {}) => new Promise((res, rej) => {
  http.get(url, { headers }, (r) => {
    let body = '';
    r.on('data', (d) => (body += d));
    r.on('end', () => res({ status: r.statusCode, headers: r.headers, body }));
  }).on('error', rej);
});

class C {
  constructor(url, name, country = 'PK') {
    this.ws = new WebSocket(url); this.name = name; this.msgs = []; this.account = null; this.result = null; this.errors = []; this.room = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'welcome') this.id = m.id;
      if (m.type === 'account') this.account = m;
      if (m.type === 'race_result') this.result = m;
      if (m.type === 'error') this.errors.push(m);
      if (m.type === 'room') this.room = m;
    });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 10000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + ' (' + this.name + ')' + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  close() { this.ws.close(); }
}

/** A plausible finished run: `chars` typed evenly over `time` ms, sampled every 250 ms. */
function runFor(passage, time, extra = {}) {
  const len = passage.text.length;
  const timeline = [];
  for (let t = 250; t < time; t += 250) timeline.push([t, Math.min(len, Math.floor((len * t) / time))]);
  timeline.push([time, len]);
  return {
    type: 'solo_done', passageId: passage.id, chars: len, finished: true, time, keystrokes: len + 3, errors: 3,
    golden: 2, goldenTotal: 3, bestCombo: 120, nitros: 1, score: 4000, pacerWpm: 55, timeline, ...extra,
  };
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const url = `ws://localhost:${port}`;
  const base = `http://localhost:${port}`;

  /* ---------------- passage catalogue over HTTP (cached) ---------------- */
  const cat = await get(`${base}/api/passages`);
  assert.strictEqual(cat.status, 200);
  const catalogue = JSON.parse(cat.body);
  assert.ok(catalogue.passages.length >= 20, 'catalogue lists the passages');
  assert.ok(catalogue.passages.every((p) => p.id && p.title && p.text && p.lang && p.category), 'passages carry id/title/text/lang/category');
  assert.ok(/max-age=3600/.test(cat.headers['cache-control']) && cat.headers.etag, 'catalogue is cacheable');
  const again = await get(`${base}/api/passages`, { 'if-none-match': cat.headers.etag });
  assert.strictEqual(again.status, 304, 'ETag revalidation returns 304');
  console.log(`✓ /api/passages: ${catalogue.passages.length} passages, cacheable (etag ${cat.headers.etag})`);
  const passage = catalogue.passages[0];
  const len = passage.text.length;
  const minTime = Math.ceil((len / 30) * 1000);   // MAX_CPS = 30: nothing faster is accepted
  const time = minTime + 400;                     // just under the ceiling (~350 WPM)

  /* ---------------- a verified practice run ---------------- */
  const a = new C(url, 'Umair', 'PK');
  await a.ready;
  await a.until((c) => c.account, 4000, 'account');
  const before = JSON.parse(JSON.stringify(accounts.accounts[a.account.id]));

  a.send({ type: 'solo_start', passageId: passage.id, mode: 'practice' });
  await wait(time - 2200);               // stamp check: reported time must not exceed elapsed + 2500 ms slack
  a.send(runFor(passage, time));
  await a.until((c) => c.result, 4000, 'practice result');
  const r = a.result;
  assert.ok(r.solo, 'result is flagged as a practice run');
  assert.strictEqual(r.points, 0, 'no ranked points');
  assert.strictEqual(r.ranked, false);
  assert.strictEqual(r.solo.verified, true, 'stamped run with a timeline is verified');
  assert.strictEqual(r.solo.chars, len);
  assert.ok(r.solo.wpm > 300 && r.solo.wpm < 360, `server recomputed wpm (${r.solo.wpm})`);
  assert.strictEqual(r.solo.accuracy, Math.floor(((len + 3 - 3) / (len + 3)) * 100), 'server recomputed accuracy');
  assert.strictEqual(r.solo.beatPacer, true, 'faster than the pacer');
  assert.strictEqual(r.solo.improved, true, 'first run is a personal best');
  assert.strictEqual(r.streak, 1, 'practice keeps the daily streak alive');
  assert.strictEqual(r.streakEvent, 'started');
  assert.ok(r.unlocked.includes('solo_first') && r.unlocked.includes('pacer_beat'), `practice achievements (${r.unlocked})`);
  assert.ok(!r.unlocked.includes('first_race') && !r.unlocked.includes('first_win'), 'racing achievements untouched');
  assert.strictEqual(r.profile.solo.finished, 1);
  assert.strictEqual(r.profile.solo.bestWpm, r.solo.wpm);
  const acc = accounts.accounts[a.account.id];
  assert.strictEqual(acc.races, before.races, 'races count untouched');
  assert.strictEqual(acc.bestWpm, before.bestWpm, 'racing best WPM untouched');
  assert.strictEqual(acc.points, before.points, 'points untouched');
  assert.strictEqual(acc.chars, before.chars + len, 'typing volume counted');
  console.log(`✓ practice run recorded: ${r.solo.wpm} WPM, ${r.solo.accuracy}% acc, verified, streak ${r.streak}, unlocked ${r.unlocked.join(',')}`);

  /* ---------------- board isolation ---------------- */
  const board = JSON.parse((await get(`${base}/api/board?category=wpm&window=all&scope=global`)).body);
  assert.ok(!board.entries.some((e) => e.id === a.account.id), 'practice never reaches the Speed board');
  console.log('✓ Speed board untouched by practice');

  /* ---------------- rejections ---------------- */
  const expectError = async (c, msg, re, label) => {
    const n = c.errors.length; c.result = null;
    c.send(msg);
    await c.until((x) => x.errors.length > n, 3000, label);
    assert.ok(re.test(c.errors[n].message), `${label}: ${c.errors[n].message}`);
    assert.strictEqual(c.result, null, `${label}: nothing recorded`);
    console.log(`✓ rejected — ${label}: "${c.errors[n].message}"`);
  };
  await expectError(a, runFor(passage, minTime - 1500), /faster than a person can type/i, 'run faster than MAX_CPS');
  a.send({ type: 'solo_start', passageId: passage.id });
  await expectError(a, runFor(passage, time), /longer than the time/i, 'submitted before the stamped time elapsed');
  const jumpy = runFor(passage, time);
  jumpy.timeline[3][1] = len;            // teleport mid-run
  await expectError(a, jumpy, /monotonic|faster than a person can type/i, 'timeline with a teleport');
  await expectError(a, { type: 'solo_done', passageId: 'nope', chars: 10, time: 5000 }, /unknown passage/i, 'unknown passage');
  const mismatch = runFor(passage, time, { chars: len - 5 });
  await expectError(a, mismatch, /match/i, 'timeline disagrees with the result');

  /* ---------------- unstamped run: accepted, but unverified ---------------- */
  a.result = null;
  a.send(runFor(passage, 60000));        // no solo_start beforehand
  await a.until((c) => c.result, 3000, 'unstamped result');
  assert.strictEqual(a.result.solo.verified, false, 'no start stamp -> unverified');
  assert.strictEqual(a.result.solo.improved, false, 'slower run is not a new best');
  assert.strictEqual(a.result.streakEvent, null, 'today already banked');
  assert.strictEqual(a.result.profile.solo.finished, 2);
  console.log(`✓ unstamped run accepted as unverified practice (${a.result.solo.wpm} WPM, best stays ${a.result.solo.best})`);

  /* ---------------- practice does not interfere with matchmaking ---------------- */
  a.send({ type: 'quick' });
  await a.until((c) => c.room && c.room.state === 'waiting', 4000, 'quick match after practice');
  assert.ok(!a.room.solo, 'a real room, not a practice one');
  a.send({ type: 'leave' });
  console.log('✓ quick match still works after practice');

  /* ---------------- pure validation unit checks ---------------- */
  const solo = require('../server/solo.js');
  const v = solo.validate({ passageId: passage.id, chars: 50, time: 5000, keystrokes: 50, errors: 0 }, null);
  assert.ok(v.ok && !v.r.finished && v.r.wpm === Math.round((50 / 5) / (5000 / 60000)), 'partial run normalised');
  assert.ok(!solo.validate({ passageId: passage.id, chars: 50, time: 100, keystrokes: 50 }, null).ok, 'impossible pace rejected');
  const late = solo.validate(runFor(passage, time), { passageId: passage.id, mode: 'practice', at: Date.now() - time - 200000 });
  assert.ok(late.ok && late.r.verified === false, 'a stamp far older than the run -> accepted but unverified');
  console.log('✓ validate(): partial runs, impossible pace, stale stamps');

  a.close();
  await wait(150);
  console.log('\nALL PRACTICE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
