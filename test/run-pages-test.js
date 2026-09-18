'use strict';
/**
 * Search-engine facing pages: /leaderboard[/:country], /practice[/:id],
 * /daily, robots.txt, sitemap.xml, and the absolute OG/canonical/JSON-LD
 * tags on the home page. All plain HTML, all cached briefly.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/pages.json';
process.env.SOLO_START_SLACK_MS = '60000';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, accounts, boards, _pageCache, _resetCaches } = require("../server/index.js");
const countries = require('../server/countries.js');
const { PASSAGES } = require('../server/passages.js');
const { challengeFor } = require('../server/daily.js');
const { dayKey } = require('../server/accounts.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b })); }).on('error', rej);
});
class C {
  constructor(url, name, country) {
    this.ws = new WebSocket(url); this.name = name; this.account = null; this.result = null; this.errors = [];
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'account') this.account = m; if (m.type === 'race_result') this.result = m; if (m.type === 'error') this.errors.push(m); });
    this.ready.then(() => this.send({ type: 'hello', name, country }));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async until(p, t = 8000, label = '?') { const t0 = Date.now(); while (Date.now() - t0 < t) { if (p(this)) return; await wait(20); } throw new Error('timeout: ' + label + (this.errors.length ? ' last error: ' + this.errors[this.errors.length - 1].message : '')); }
  close() { this.ws.close(); }
}
function runFor(passage, time, extra = {}) {
  const len = passage.text.length; const timeline = [];
  for (let t = 250; t < time; t += 250) timeline.push([t, Math.min(len, Math.floor((len * t) / time))]);
  timeline.push([time, len]);
  return { type: 'solo_done', mode: 'practice', passageId: passage.id, chars: len, finished: true, time, keystrokes: len, errors: 0, golden: 0, goldenTotal: 3, bestCombo: len, nitros: 0, score: 1000, timeline, ...extra };
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const url = `ws://localhost:${server.address().port}`;

  /* ---------------- country list parity ---------------- */
  const client = await import('../public/js/countries.js');
  assert.deepStrictEqual(countries.COUNTRIES, client.COUNTRIES, 'server/countries.js matches public/js/countries.js');
  console.log('✓ country list parity with the client');

  /* ---------------- home page: absolute tags ---------------- */
  const home = await get(`${base}/`);
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes(`<link rel="canonical" href="${base}/">`), 'canonical');
  assert.ok(home.body.includes(`<meta property="og:image" content="${base}/og/site.png">`), 'absolute og:image');
  assert.ok(home.body.includes('"@type":"VideoGame"') && home.body.includes(`"url":"${base}/"`), 'JSON-LD');
  assert.ok(!home.body.includes('__ORIGIN__'), 'no template tokens leak');
  assert.ok(/href="\/practice"/.test(home.body) && /href="\/daily"/.test(home.body) && /href="\/leaderboard"/.test(home.body), 'crawlable links to the pages');
  const spa = await get(`${base}/some/unknown/path`);
  assert.ok(spa.status === 404 && spa.body.includes('id="btn-quick"'), 'unknown paths load the app but answer 404 (no soft-404s)');
  console.log('✓ home page: canonical, OG image, JSON-LD, internal links (unknown paths: app + 404)');

  /* ---------------- robots + sitemap ---------------- */
  const robots = await get(`${base}/robots.txt`);
  assert.ok(robots.body.includes(`Sitemap: ${base}/sitemap.xml`) && robots.body.includes('Disallow: /api/'), 'robots.txt');
  let sm = await get(`${base}/sitemap.xml`);
  assert.ok(/application\/xml/.test(sm.headers['content-type']));
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  let urls = locs(sm.body);
  for (const p of ['/', '/daily', '/practice', '/leaderboard', ...PASSAGES.map((p) => `/practice/${p.id}`)]) assert.ok(urls.includes(base + p), `sitemap has ${p}`);
  assert.ok(!urls.some((u) => /\/leaderboard\/[A-Z]{2}$/.test(u)), 'no country pages before anyone has points');
  console.log(`✓ robots.txt + sitemap.xml (${urls.length} urls, every passage page listed)`);

  /* ---------------- seed two ranked players ---------------- */
  const a = new C(url, 'Umair & Co', 'PK');
  const b = new C(url, 'Sara', 'SA');
  await Promise.all([a.ready, b.ready]);
  await a.until((c) => c.account, 4000, 'account'); await b.until((c) => c.account, 4000, 'account');
  Object.assign(accounts.accounts[a.account.id], { points: 900, bestWpm: 88, streak: 4, wins: 3, races: 5 });
  Object.assign(accounts.accounts[b.account.id], { points: 500, bestWpm: 95, streak: 2, wins: 1, races: 4 });
  _resetCaches();

  const lb = await get(`${base}/leaderboard`);
  assert.strictEqual(lb.status, 200);
  assert.ok(lb.body.includes('Umair &amp; Co') && lb.body.includes('Sara'), 'both players listed');
  const outsideJsonLd = (html) => html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  assert.ok(!outsideJsonLd(lb.body).includes('Umair & Co'), 'names escaped in the markup');
  assert.ok(lb.body.indexOf('Umair &amp; Co') < lb.body.indexOf('>Sara<'), 'points order: Umair first');
  assert.ok(lb.body.includes('95 a min'), 'speed board');
  assert.ok(lb.body.includes('"@type":"ItemList"') && lb.body.includes(`/u/${a.account.id}`), 'ItemList JSON-LD with profile urls');
  assert.ok(lb.body.includes('href="/leaderboard/PK"') && lb.body.includes('href="/leaderboard/SA"'), 'links to country boards');
  assert.ok(lb.body.includes(`<link rel="canonical" href="${base}/leaderboard">`));
  const pk = await get(`${base}/leaderboard/pk`);
  assert.strictEqual(pk.status, 200, 'lowercase country code works');
  assert.ok(pk.body.includes('Umair &amp; Co') && !pk.body.includes('>Sara<'), 'country page filters to PK');
  assert.ok(pk.body.includes('Fastest typists in Pakistan'), 'country name in title');
  assert.strictEqual((await get(`${base}/leaderboard/ZZ`)).status, 404, 'unknown country 404');
  assert.strictEqual((await get(`${base}/leaderboard/XYZ`)).status, 404);
  console.log('✓ /leaderboard + /leaderboard/:country: rows, escaping, JSON-LD, country links, 404s');

  sm = await get(`${base}/sitemap.xml`);
  urls = locs(sm.body);
  assert.ok(urls.includes(`${base}/sitemap.xml`) === false && urls.includes(`${base}/leaderboard`), 'sitemap sane');
  _pageCache.clear();
  sm = await get(`${base}/sitemap.xml`);
  urls = locs(sm.body);
  assert.ok(urls.includes(`${base}/leaderboard/PK`) && urls.includes(`${base}/leaderboard/SA`), 'country pages appear once players have points');
  assert.ok(urls.includes(`${base}/u/${a.account.id}`), 'top profiles listed');
  console.log('✓ sitemap grows with country boards and top profiles');

  /* ---------------- practice pages, with a record ---------------- */
  const p = PASSAGES[5];
  let idx = await get(`${base}/practice`);
  assert.strictEqual(idx.status, 200);
  assert.ok(idx.body.includes('href="/practice/lang/en"') && idx.body.includes('class="set-card card"'), 'the chooser is a card per language');
  // each set is its own page: stages in order, every stage its own card
  const { STAGES } = require('../server/passages.js');
  assert.ok(PASSAGES.every((x) => x.stage >= 1 && x.stage <= STAGES.length), 'every paragraph has a stage');
  const set = await get(`${base}/practice/lang/en`);
  assert.ok(set.body.includes(`href="/practice/${p.id}"`) && set.body.includes('nobody has raced it yet'), 'the English set lists its paragraphs');
  const stageOrder = [...set.body.matchAll(/Stage (\d)<\/span>\s*<b>([^<]+)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.ok(stageOrder.length >= 4 && stageOrder[0] === '1:New', `stages listed easiest first (${stageOrder.slice(0, 4)})`);
  assert.ok(/class="stage card s1"/.test(set.body) && /class="stage card s4"/.test(set.body), 'every stage is its own card');
  const withStage = PASSAGES.find((x) => x.stage > 1);
  const sp = await get(`${base}/practice/${withStage.id}`);
  assert.ok(sp.body.includes(`Stage ${withStage.stage}`), 'a paragraph page names its stage');
  console.log(`✓ practice: a card per language, then ${STAGES.map((s) => s.name).join(' → ')} as stage cards`);
  a.send({ type: 'solo_start', passageId: p.id, mode: 'practice' });
  await wait(30);
  a.send(runFor(p, Math.ceil((p.text.length / cfg.MAX_CPS) * 1000) + 1500));
  await a.until((c) => c.result, 5000, 'practice result');
  _pageCache.clear();
  idx = await get(`${base}/practice/lang/${p.lang}`);
  assert.ok(idx.body.includes(`fastest so far ${a.result.solo.wpm} a min by`) && idx.body.includes('Umair &amp; Co'), 'the set page shows the new record');
  const pp = await get(`${base}/practice/${p.id}`);
  assert.strictEqual(pp.status, 200);
  assert.ok(pp.body.includes(p.text.replace(/'/g, '&#39;').replace(/"/g, '&quot;')), 'full passage text on the page');
  assert.ok(pp.body.includes(`href="/app#practice/${p.id}"`) && pp.body.includes(`href="/app#practice/${p.id}/ghost/wr"`), 'practice + ghost CTAs');
  assert.ok(pp.body.includes('"@type":"CreativeWork"') && pp.body.includes(`"wordCount":${p.words}`), 'CreativeWork JSON-LD');
  assert.ok(pp.body.includes(`href="/practice/${PASSAGES[4].id}"`) && pp.body.includes(`href="/practice/${PASSAGES[6].id}"`), 'prev/next links');
  assert.ok(pp.body.includes(`<title>Typing practice: “${p.title}”`));
  assert.strictEqual((await get(`${base}/practice/nope`)).status, 404);
  console.log(`✓ /practice + /practice/${p.id}: text, record, CTAs, JSON-LD, prev/next, 404`);

  /* ---------------- daily page ---------------- */
  const today = challengeFor(dayKey());
  const dp = await get(`${base}/daily`);
  assert.strictEqual(dp.status, 200);
  assert.ok(dp.body.includes(`Daily #${today.number}`) && dp.body.includes(today.passage.title.replace(/'/g, '&#39;')), 'today on the page');
  assert.ok(dp.body.includes('href="/app#daily"') && dp.body.includes(`og:image" content="${base}/og/daily.png"`), 'CTA + daily card');
  b.result = null;
  b.send({ type: 'solo_start', passageId: today.passage.id, mode: 'daily' });
  await wait(30);
  b.send(runFor(today.passage, Math.ceil((today.passage.text.length / cfg.MAX_CPS) * 1000) + 3000, { mode: 'daily' }));
  await b.until((c) => c.result, 5000, 'daily result');
  _pageCache.clear();
  const dp2 = await get(`${base}/daily`);
  assert.ok(dp2.body.includes('>Sara<') && dp2.body.includes(`${b.result.solo.wpm} a min`), "today's top list");
  console.log('✓ /daily: number, title, CTA, card, top list after a run');

  /* ---------------- page cache ---------------- */
  const before = (await get(`${base}/leaderboard`)).body;
  accounts.accounts[b.account.id].name = 'Renamed';
  boards.invalidate();
  const during = (await get(`${base}/leaderboard`)).body;
  assert.strictEqual(during, before, 'within the TTL the cached page is served');
  _pageCache.clear();
  const after = (await get(`${base}/leaderboard`)).body;
  assert.ok(after.includes('Renamed'), 'fresh render after the cache expires');
  assert.ok(/max-age=30/.test((await get(`${base}/leaderboard`)).headers['cache-control']));
  console.log('✓ rendered pages cached briefly, served with cache headers');

  a.close(); b.close();
  await wait(150);
  console.log('\nALL PAGE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
