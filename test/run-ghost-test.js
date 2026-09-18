'use strict';
/**
 * Ghost replays: verified runs (multiplayer, practice, daily) leave a progress
 * timeline; the fastest per passage is the world record, each account keeps a
 * bounded set of personal bests, and the daily's leader replay is exposed.
 * Playback is client-side, so here we only check what is stored and served.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/ghost.json';
process.env.SOLO_START_SLACK_MS = '60000';
process.env.COUNTDOWN_MS ||= '800';
process.env.HUMANS_DONE_GRACE_MS ||= '800';
process.env.RESULTS_MS ||= '1000';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, ghosts } = require('../server/index.js');
const { thin, PB_PASSAGES } = require('../server/ghosts.js');
const { PASSAGES } = require('../server/passages.js');
const { challengeFor } = require('../server/daily.js');
const { dayKey } = require('../server/accounts.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b, json: () => JSON.parse(b) })); }).on('error', rej);
});

class C {
  constructor(url, name, country = 'PK') {
    this.ws = new WebSocket(url); this.name = name; this.msgs = []; this.account = null; this.result = null; this.errors = []; this.room = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'account') this.account = m;
      if (m.type === 'race_result') this.result = m;
      if (m.type === 'error') this.errors.push(m);
      if (m.type === 'room') this.room = m;
    });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 15000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + ' (' + this.name + ')' + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  close() { this.ws.close(); }
}

function runFor(passage, time, extra = {}) {
  const len = passage.text.length;
  const timeline = [];
  for (let t = 250; t < time; t += 250) timeline.push([t, Math.min(len, Math.floor((len * t) / time))]);
  timeline.push([time, len]);
  return { type: 'solo_done', mode: 'practice', passageId: passage.id, chars: len, finished: true, time, keystrokes: len, errors: 0, golden: 0, goldenTotal: 3, bestCombo: len, nitros: 0, score: 2000, timeline, ...extra };
}
async function play(c, passage, time, extra = {}) {
  c.result = null;
  c.send({ type: 'solo_start', passageId: passage.id, mode: extra.mode || 'practice' });
  await wait(30);
  c.send(runFor(passage, time, extra));
  await c.until((x) => x.result, 5000, 'result');
  return c.result;
}
const minTimeOf = (p) => Math.ceil((p.text.length / cfg.MAX_CPS) * 1000);

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const url = `ws://localhost:${port}`;
  const base = `http://localhost:${port}`;
  const a = new C(url, 'Umair', 'PK');
  const b = new C(url, 'Sara', 'SA');
  await Promise.all([a.ready, b.ready]);
  await a.until((c) => c.account, 4000, 'account');
  await b.until((c) => c.account, 4000, 'account');

  /* ---------------- a multiplayer race leaves a ghost ---------------- */
  a.send({ type: 'create' });
  await a.until((c) => c.room && c.room.isPrivate, 4000, 'private room');
  a.send({ type: 'start', bots: false });
  await a.until((c) => c.room.state === 'racing', 6000, 'racing');
  const racePassage = a.room.passageId;
  const len = a.room.passage.length;
  for (let i = 14; i <= len + 13; i += 14) { a.send({ type: 'progress', c: Math.min(i, len), t: Math.min(i, len), k: Math.min(i, len), e: 0 }); await wait(500); }
  await a.until((c) => c.result, 20000, 'race result');
  assert.ok(a.result.ghost && a.result.ghost.wr === true && a.result.ghost.pb === true, 'first finished race sets the world record and a personal best');
  assert.ok(a.result.unlocked.includes('wr_set'), 'record holder achievement');
  const wr0 = ghosts.wr(racePassage);
  assert.ok(wr0.timeline.length >= 3 && wr0.timeline[wr0.timeline.length - 1][1] === len, `server sampled the race into a timeline (${wr0.timeline.length} samples)`);
  assert.strictEqual(wr0.name, 'Umair');
  console.log(`✓ multiplayer race on "${racePassage}" recorded as world record: ${wr0.wpm} WPM, ${wr0.timeline.length} samples`);
  a.send({ type: 'leave' });
  await wait(100);

  /* ---------------- practice runs: records and personal bests ---------------- */
  const X = PASSAGES.find((p) => p.id !== racePassage);
  const r1 = await play(a, X, minTimeOf(X) + 2000);
  assert.deepStrictEqual([r1.solo.ghost.wr, r1.solo.ghost.pb, r1.solo.ghost.beat], [true, true, false]);
  let api = (await get(`${base}/api/ghost?passage=${X.id}&me=${a.account.id}`)).json();
  assert.strictEqual(api.wr.name, 'Umair');
  assert.strictEqual(api.wr.mine, true);
  assert.ok(api.wr.timeline.length >= 2 && api.wr.timeline[api.wr.timeline.length - 1][1] === X.text.length, 'record ghost served with its timeline');
  assert.strictEqual(api.pb.wpm, r1.solo.wpm);
  console.log(`✓ practice run set the record on "${X.id}" (${r1.solo.wpm} WPM); /api/ghost serves wr + pb`);

  const r2 = await play(b, X, minTimeOf(X) + 6000);               // slower than the record
  assert.deepStrictEqual([r2.solo.ghost.wr, r2.solo.ghost.pb], [false, true], 'slower run: personal best only');
  api = (await get(`${base}/api/ghost?passage=${X.id}&me=${b.account.id}`)).json();
  assert.strictEqual(api.wr.name, 'Umair');
  assert.strictEqual(api.wr.mine, false);
  assert.strictEqual(api.pb.wpm, r2.solo.wpm);

  const r3 = await play(b, X, minTimeOf(X) + 300, { pacerKind: 'wr', pacerWpm: r1.solo.wpm });   // beats the record while racing its ghost
  assert.deepStrictEqual([r3.solo.ghost.wr, r3.solo.ghost.pb, r3.solo.ghost.beat, r3.solo.ghost.kind], [true, true, true, 'wr']);
  assert.strictEqual(r3.solo.ghost.prevWr.name, 'Umair', 'the reply names the record that fell');
  assert.ok(r3.unlocked.includes('ghost_beat') && r3.unlocked.includes('wr_set'), `ghost achievements (${r3.unlocked})`);
  api = (await get(`${base}/api/ghost?passage=${X.id}`)).json();
  assert.strictEqual(api.wr.name, 'Sara');
  assert.strictEqual(api.pb, null, 'no pb without ?me=');
  const records = (await get(`${base}/api/records`)).json().records;
  assert.ok(records.find((r) => r.passageId === X.id && r.name === 'Sara') && records.find((r) => r.passageId === racePassage && r.name === 'Umair'), '/api/records lists both records');
  console.log(`✓ Sara beat Umair's ghost and took the record (${r3.solo.wpm} WPM); /api/records updated`);

  const r4 = await play(b, X, minTimeOf(X) + 8000, { pacerKind: 'pb', pacerWpm: r3.solo.wpm });
  assert.deepStrictEqual([r4.solo.ghost.wr, r4.solo.ghost.pb, r4.solo.ghost.beat], [false, false, false], 'a slower run changes nothing and beats nothing');

  /* ---------------- unverified runs never become ghosts ---------------- */
  b.result = null;
  b.send(runFor(X, minTimeOf(X) + 100));                           // no stamp -> unverified
  await b.until((c) => c.result, 4000, 'unverified');
  assert.strictEqual(b.result.solo.verified, false);
  assert.strictEqual(b.result.solo.ghost.wr, false);
  assert.strictEqual(ghosts.wr(X.id).wpm, r3.solo.wpm, 'record untouched by an unverified run');
  console.log('✓ unverified runs are never stored as ghosts');

  /* ---------------- personal bests are bounded per account ---------------- */
  const others = PASSAGES.filter((p) => p.id !== X.id && p.id !== racePassage).slice(0, PB_PASSAGES);
  for (const p of others) await play(a, p, minTimeOf(p) + 3000);
  const mine = Object.keys(ghosts.data.pb[a.account.id]);
  assert.strictEqual(mine.length, PB_PASSAGES, `at most ${PB_PASSAGES} personal bests kept`);
  assert.ok(!mine.includes(racePassage), 'the oldest personal best was dropped');
  assert.ok(ghosts.wr(racePassage), 'world records are never dropped');
  console.log(`✓ personal bests capped at ${PB_PASSAGES} passages per account (oldest dropped), records kept`);

  /* ---------------- daily: the leader's replay ---------------- */
  const today = challengeFor(dayKey()).passage;
  const d1 = await play(a, today, minTimeOf(today) + 1500, { mode: 'daily' });
  assert.strictEqual(d1.daily.counted, true);
  let daily = (await get(`${base}/api/daily`)).json();
  assert.ok(daily.leaderGhost && daily.leaderGhost.name === 'Umair' && daily.leaderGhost.timeline.length >= 2, 'leader ghost exposed');
  await play(b, today, minTimeOf(today) + 5000, { mode: 'daily' });
  daily = (await get(`${base}/api/daily`)).json();
  assert.strictEqual(daily.leaderGhost.name, 'Umair', 'a slower entry does not replace the leader ghost');
  console.log(`✓ /api/daily carries the leader's ghost (${daily.leaderGhost.wpm} WPM, ${daily.leaderGhost.timeline.length} samples)`);

  /* ---------------- helpers ---------------- */
  const big = Array.from({ length: 400 }, (_, i) => [i * 100, i]);
  const small = thin(big, 120);
  assert.strictEqual(small.length, 120);
  assert.deepStrictEqual([small[0], small[119]], [[0, 0], [39900, 399]], 'thin() keeps the first and last samples');
  assert.strictEqual((await get(`${base}/api/ghost?passage=nope`)).status, 404);
  console.log('✓ thin() downsampling, unknown passage -> 404');

  a.close(); b.close();
  await wait(150);
  console.log('\nALL GHOST TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
