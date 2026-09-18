'use strict';
/** Seasons: monthly counters, a season board window, archiving with badges on rollover. */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/seasons.json';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts, boards, seasons, store, _pageCache } = require('../server/index.js');
const { seasonKey } = require('../server/accounts.js');
const { seasonNumber, seasonEnd } = require('../server/seasons.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej); });
const race = (rank, wpm = 70) => ({ rank, wpm, accuracy: 97, errors: 3, finished: true, chars: 200, golden: 1, goldenTotal: 3, bestCombo: 60, nitros: 1, score: 3000, lane: 1, racers: 4, humans: 2, ranked: true });

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const url = `ws://localhost:${server.address().port}`;

  /* ---------------- keys and numbers ---------------- */
  assert.strictEqual(seasonKey(new Date('2026-09-18T10:00:00Z')), '2026-09');
  assert.strictEqual(seasonNumber('2026-09'), 1);
  assert.strictEqual(seasonNumber('2027-01'), 5);
  assert.strictEqual(seasonEnd('2026-09'), Date.UTC(2026, 9, 1));
  assert.strictEqual(seasons.current, seasonKey(), 'current season set at boot');
  console.log(`✓ season keys: now = ${seasons.current} (Season ${seasonNumber(seasons.current)})`);

  /* ---------------- counters roll with the month ---------------- */
  const mint = (name, country) => new Promise((res) => {
    const ws = new WebSocket(url);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', name, country })));
    ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'account') { ws.close(); res(accounts.accounts[m.id]); } });
  });
  const A = await mint('Umair', 'PK');
  const B = await mint('Sara', 'SA');
  const C = await mint('Kenji', 'JP');
  const aug = new Date('2026-08-20T10:00:00Z');
  const r1 = accounts.recordRace(A, race(1), aug);
  accounts.recordRace(A, race(2), aug);
  accounts.recordRace(B, race(1), aug);
  accounts.recordRace(C, race(3), aug);
  assert.strictEqual(A.season.key, '2026-08');
  assert.ok(A.season.points > B.season.points && B.season.points > C.season.points, 'season points accumulate');
  assert.strictEqual(A.season.races, 2);
  assert.strictEqual(A.season.wins, 1);
  assert.strictEqual(A.points, A.season.points, 'all-time and season agree in the first month');
  console.log(`✓ season counters: A ${A.season.points} pts / ${A.season.races} races, B ${B.season.points}, C ${C.season.points} (${r1.points} for a win)`);

  /* ---------------- rollover archives the old season ---------------- */
  store.data.seasonCurrent = '2026-08';                 // pretend the server has been running since August
  const sep = new Date('2026-09-02T09:00:00Z');
  accounts.rollWindows(A, sep);                          // an account touching the new month triggers the archive first
  const arch = seasons.data['2026-08'];
  assert.ok(arch, 'August archived');
  assert.strictEqual(arch.number, 0 + seasonNumber('2026-08'));
  assert.deepStrictEqual(arch.top.map((t) => t.name), ['Umair', 'Sara', 'Kenji'], 'ranked by season points');
  assert.strictEqual(arch.top[0].rank, 1);
  assert.strictEqual(arch.players, 3);
  assert.deepStrictEqual(A.season, { key: '2026-09', points: 0, races: 0, wins: 0 }, 'A starts September at zero');
  assert.ok(A.points > 0, 'all-time points untouched');
  assert.deepStrictEqual(A.badges, [{ season: '2026-08', number: arch.number, rank: 1 }], 'winner badge');
  assert.strictEqual(C.badges[0].rank, 3);
  assert.ok(A.achievements.includes('season_win') && A.achievements.includes('season_top10') && A.achievements.includes('season_top100'), `season achievements (${A.achievements})`);
  assert.ok(!C.achievements.includes('season_win') && C.achievements.includes('season_top10'));
  assert.strictEqual(seasons.current, '2026-09');
  assert.strictEqual(seasons.check(sep), null, 'idempotent');
  accounts.rollWindows(B, sep);
  assert.strictEqual(B.season.points, 0);
  assert.strictEqual(arch.top[1].points > 0, true, "B's August points survived in the archive even though B rolled later");
  console.log('✓ rollover: archive with ranks, badges + achievements, all-time points kept, idempotent');

  /* ---------------- the season board window ---------------- */
  const now = new Date();
  accounts.recordRace(B, race(1), now);
  accounts.recordRace(A, race(4), now);
  boards.invalidate();
  const rows = boards.rows('points', 'season', 'global');
  assert.deepStrictEqual(rows.map((r) => r.name), ['Sara', 'Umair'], 'season board reflects this month only');
  assert.ok(boards.rows('points', 'all', 'global')[0].name === 'Umair', 'all-time board still led by Umair');
  const st = boards.standings(B).find((s) => s.window === 'season');
  assert.ok(st && st.rank === 1, 'standings carry a season rank');
  assert.ok(boards.meta().windows.season === 'This season' && boards.meta().categories.find((c) => c.id === 'points').windows.includes('season'));
  const api = JSON.parse((await get(`${base}/api/season?me=${B.id}`)).body);
  assert.strictEqual(api.number, seasonNumber(seasonKey()));
  assert.strictEqual(api.top[0].name, 'Sara');
  assert.strictEqual(api.me.rank, 1);
  assert.strictEqual(api.past[0].key, '2026-08');
  assert.strictEqual(api.past[0].top[0].name, 'Umair');
  assert.ok(api.endsAt > Date.now(), 'endsAt in the future');
  console.log('✓ season board window, standings, /api/season with past seasons');

  _pageCache.clear();
  const lb = (await get(`${base}/leaderboard`)).body;
  assert.ok(lb.includes(`Season ${api.number}`) && lb.includes('Past seasons') && lb.includes('>Umair<'), 'leaderboard page shows this season and past seasons');
  assert.ok(lb.indexOf('this month') < lb.indexOf('all time'), 'season table first');
  console.log('✓ /leaderboard page: current season + hall of past seasons');

  /* ---------------- bounded archive ---------------- */
  for (let i = 0; i < cfg.SEASON_KEEP + 3; i++) seasons.data[`2000-${String((i % 12) + 1).padStart(2, '0')}-${i}`] = { key: 'x', top: [] };
  seasons.archive('2001-01');
  assert.ok(Object.keys(seasons.data).length <= cfg.SEASON_KEEP, 'archive pruned');
  console.log('✓ archive bounded to', cfg.SEASON_KEEP, 'seasons');

  await wait(100);
  console.log('\nALL SEASON TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
