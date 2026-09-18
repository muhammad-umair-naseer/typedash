'use strict';
/** Languages and modes: the catalogue, language-aware matchmaking, per-language counters and achievements, practice pages. */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/lang.json';
process.env.SOLO_START_SLACK_MS = '60000';
process.env.COUNTDOWN_MS ||= '800';
process.env.HUMANS_DONE_GRACE_MS ||= '800';
process.env.RESULTS_MS ||= '1000';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts, _resetCaches } = require('../server/index.js');
const passages = require('../server/passages.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => { http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej); });
class C {
  constructor(url, name, country = 'PK') {
    this.ws = new WebSocket(url); this.name = name; this.account = null; this.result = null; this.errors = []; this.room = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'account') this.account = m; if (m.type === 'race_result') this.result = m; if (m.type === 'error') this.errors.push(m); if (m.type === 'room') this.room = m; });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 15000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + ' (' + this.name + ')' + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  close() { this.ws.close(); }
}
function runFor(passage, time) {
  const len = passage.text.length; const timeline = [];
  for (let t = 250; t < time; t += 250) timeline.push([t, Math.min(len, Math.floor((len * t) / time))]);
  timeline.push([time, len]);
  return { type: 'solo_done', mode: 'practice', passageId: passage.id, chars: len, finished: true, time, keystrokes: len, errors: 0, golden: 0, goldenTotal: 3, bestCombo: len, nitros: 0, score: 1000, timeline };
}
async function play(c, passage) {
  c.result = null;
  c.send({ type: 'solo_start', passageId: passage.id, mode: 'practice' });
  await wait(30);
  c.send(runFor(passage, Math.ceil((passage.text.length / cfg.MAX_CPS) * 1000) + 2000));
  await c.until((x) => x.result, 5000, `run ${passage.id}`);
  return c.result;
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const url = `ws://localhost:${server.address().port}`;

  /* ---------------- catalogue ---------------- */
  const langs = Object.keys(passages.LANGS);
  assert.ok(langs.length >= 7 && Object.keys(passages.CATEGORIES).length === 3, `${langs.length} languages, 3 modes`);
  for (const l of langs) assert.ok(passages.list({ lang: l, category: 'prose' }).length >= 8, `${l} has at least 8 prose passages`);
  assert.ok(passages.list({ category: 'code' }).length >= 8 && passages.list({ category: 'numbers' }).length >= 6, 'code + numbers modes');
  assert.ok(passages.list({ lang: 'en', category: 'prose' }).every((p) => /^[\x20-\x7e]+$/.test(p.text)), 'English prose stays ASCII');
  assert.ok(passages.list({ lang: 'de' }).some((p) => /[äöüß]/.test(p.text)), 'German uses its real orthography');
  assert.strictEqual(passages.pick({ lang: 'es' }).lang, 'es');
  assert.strictEqual(passages.pick({ lang: 'fr', category: 'code' }).lang, 'en', 'empty combination falls back to English prose');
  const api = JSON.parse((await get(`${base}/api/passages`)).body);
  assert.ok(api.langs.tr.native === 'Türkçe' && api.categories.code && api.passages.length === passages.PASSAGES.length, '/api/passages carries langs + categories');
  console.log(`✓ catalogue: ${passages.PASSAGES.length} passages, languages ${langs.join(' ')}, modes ${Object.keys(passages.CATEGORIES).join(' ')}`);

  /* ---------------- matchmaking by language ---------------- */
  const a = new C(url, 'Umair', 'PK');
  const b = new C(url, 'Sara', 'SA');
  const c = new C(url, 'Kenji', 'JP');
  await Promise.all([a.ready, b.ready, c.ready]);
  for (const x of [a, b, c]) await x.until((y) => y.account, 4000, 'account');
  a.send({ type: 'quick', lang: 'fr' });
  await a.until((x) => x.room && x.room.lang === 'fr', 4000, 'fr room');
  b.send({ type: 'quick', lang: 'fr' });
  await b.until((x) => x.room && x.room.code === a.room.code, 4000, 'same fr room');
  c.send({ type: 'quick', lang: 'de' });
  await c.until((x) => x.room, 4000, 'de room');
  assert.notStrictEqual(c.room.code, a.room.code, 'German player gets a German room');
  assert.strictEqual(c.room.lang, 'de');
  for (const x of [a, b, c]) x.send({ type: 'leave' });
  await wait(100);
  c.send({ type: 'create', lang: 'de', category: 'nope' });
  await c.until((x) => x.room && x.room.isPrivate, 4000, 'private de');
  assert.strictEqual(c.room.category, 'prose', 'unknown mode falls back');
  c.send({ type: 'start', bots: false });
  await c.until((x) => x.room.state === 'racing', 6000, 'racing');
  assert.strictEqual(c.room.passageLang, 'de');
  assert.ok(passages.byId(c.room.passageId).lang === 'de', 'race passage is German');
  const len = c.room.passage.length;
  for (let i = 14; i <= len + 13; i += 14) { c.send({ type: 'progress', c: Math.min(i, len), t: Math.min(i, len), k: Math.min(i, len), e: 0 }); await wait(500); }
  await c.until((x) => x.result, 20000, 'race result');
  assert.strictEqual(c.result.profile.langs.de, 1, 'a finished race counts for its language');
  c.send({ type: 'leave' });
  console.log(`✓ matchmaking groups by language; German room raced "${c.room.passageId}" and counted langs.de`);

  /* ---------------- practice in several languages ---------------- */
  const es = passages.pick({ lang: 'es' });
  const pt = passages.pick({ lang: 'pt' });
  const tr = passages.pick({ lang: 'tr' });
  await play(a, es);
  const r2 = await play(a, pt);
  assert.deepStrictEqual(r2.profile.langs, { es: 1, pt: 1 });
  const r3 = await play(a, tr);
  assert.ok(r3.unlocked.includes('polyglot'), `Polyglot after 3 languages (${r3.unlocked})`);
  const code = await play(a, passages.pick({ category: 'code' }));
  assert.ok(code.unlocked.includes('coder'), 'Syntax highlighter for a code passage');
  const nums = await play(a, passages.pick({ category: 'numbers' }));
  assert.ok(nums.unlocked.includes('numbers'), 'Number cruncher');
  console.log('✓ practice runs count per language; Polyglot, Syntax highlighter, Number cruncher unlocked');

  /* ---------------- pages ---------------- */
  _resetCaches();
  const idx = (await get(`${base}/practice`)).body;
  assert.ok(idx.includes('Español') && idx.includes('Türkçe') && idx.includes('Code') && idx.includes('href="/practice/lang/es"'), '/practice offers a card per language and drill');
  assert.ok(!idx.includes(`href="/practice/${es.id}"`), 'the chooser links to the sets, not to every paragraph');
  const esSet = await get(`${base}/practice/lang/es`);
  assert.ok(esSet.status === 200 && esSet.body.includes(`href="/practice/${es.id}"`) && !esSet.body.includes(`href="/practice/${tr.id}"`), 'the Spanish set lists only Spanish paragraphs');
  const drill = await get(`${base}/practice/drill/code`);
  assert.ok(drill.status === 200 && drill.body.includes('/practice/code-js-reduce'), 'the code drill has its own page');
  assert.strictEqual((await get(`${base}/practice/lang/zz`)).status, 404, 'an unknown language is a 404');
  const pg = await get(`${base}/practice/${es.id}`);
  assert.ok(pg.status === 200 && pg.body.includes('Español') && pg.body.includes('"inLanguage":"es"'), 'Spanish practice page');
  const sm = (await get(`${base}/sitemap.xml`)).body;
  assert.ok(sm.includes(`/practice/${tr.id}`) && sm.includes('/practice/code-js-reduce'), 'sitemap lists every language and mode');
  assert.ok(sm.includes('/practice/lang/tr') && sm.includes('/practice/drill/numbers'), 'sitemap lists the language and drill pages');
  console.log('✓ /practice: a card per language, each set on its own page, sitemap');

  for (const x of [a, b, c]) x.close();
  await wait(150);
  console.log('\nALL LANGUAGE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
