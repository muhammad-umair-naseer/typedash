'use strict';
/**
 * Share cards: settled results get a result id; sharing one publishes a
 * page (/r/:id) with Open Graph / Twitter tags and a rendered card
 * (/og/r/:id.png). Profiles have pages and cards too, and the site and daily
 * have generic cards. Cards are rendered once and cached.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/share.json';
process.env.SOLO_START_SLACK_MS = '60000';
process.env.COUNTDOWN_MS ||= '800';
process.env.HUMANS_DONE_GRACE_MS ||= '800';
process.env.RESULTS_MS ||= '1000';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { server, shares, accounts } = require('../server/index.js');
const { Shares } = require('../server/share.js');
const og = require('../server/og.js');
const progression = require('../server/progression.js');
const { PASSAGES } = require('../server/passages.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (url, headers = {}) => new Promise((res, rej) => {
  http.get(url, { headers }, (r) => { const chunks = []; r.on('data', (d) => chunks.push(d)); r.on('end', () => { const buf = Buffer.concat(chunks); res({ status: r.statusCode, headers: r.headers, buf, body: buf.toString('utf8') }); }); }).on('error', rej);
});
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class C {
  constructor(url, name, country = 'PK') {
    this.ws = new WebSocket(url); this.name = name; this.msgs = []; this.account = null; this.result = null; this.errors = []; this.room = null; this.share = null;
    this.ready = new Promise((res) => this.ws.on('open', res));
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw); this.msgs.push(m);
      if (m.type === 'account') this.account = m;
      if (m.type === 'race_result') this.result = m;
      if (m.type === 'error') this.errors.push(m);
      if (m.type === 'room') this.room = m;
      if (m.type === 'share') this.share = m;
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
  return { type: 'solo_done', mode: 'practice', passageId: passage.id, chars: len, finished: true, time, keystrokes: len + 1, errors: 1, golden: 0, goldenTotal: 3, bestCombo: len, nitros: 0, score: 2000, timeline, ...extra };
}

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const port = server.address().port;
  const url = `ws://localhost:${port}`;
  const base = `http://localhost:${port}`;

  /* ---------------- level curve parity with the client ---------------- */
  const client = await import('../public/js/account.js');
  for (const lvl of [1, 2, 5, 12, 35, 40]) assert.strictEqual(progression.pointsForLevel(lvl), client.pointsForLevel(lvl), `pointsForLevel(${lvl})`);
  for (const pts of [0, 399, 400, 5000, 123456]) assert.strictEqual(progression.levelForPoints(pts), client.levelForPoints(pts), `levelForPoints(${pts})`);
  for (const lvl of [1, 3, 11, 27, 35]) assert.strictEqual(progression.titleFor(lvl), client.titleFor(lvl), `titleFor(${lvl})`);
  console.log('✓ server level curve matches public/js/account.js');

  /* ---------------- practice result -> share ---------------- */
  const a = new C(url, 'Umair & "Co"', 'PK');    // angle brackets are stripped at hello; & and quotes must be escaped on every page
  await a.ready;
  await a.until((c) => c.account, 4000, 'account');
  const p = PASSAGES[3];
  const time = Math.ceil((p.text.length / cfg.MAX_CPS) * 1000) + 2000;
  a.send({ type: 'solo_start', passageId: p.id, mode: 'practice' });
  await wait(30);
  a.send(runFor(p, time, { pacerWpm: 55, pacerKind: 'wpm', pacerName: null }));
  await a.until((c) => c.result, 5000, 'result');
  assert.ok(a.result.resultId && a.result.resultId.length >= 10, 'settled result carries a result id');

  a.send({ type: 'share', resultId: a.result.resultId });
  await a.until((c) => c.share, 4000, 'share reply');
  const sh = a.share;
  assert.ok(/^[a-z0-9]{8}$/.test(sh.id), `short share id (${sh.id})`);
  assert.strictEqual(sh.url, `${base}/r/${sh.id}`);
  assert.strictEqual(sh.image, `${base}/og/r/${sh.id}.png`);
  assert.ok(sh.text.includes(`${a.result.solo.wpm} WPM`) && sh.text.includes(sh.url), 'share text carries the numbers and the link');
  assert.strictEqual(sh.kind, 'practice');
  console.log(`✓ practice result shared: ${sh.url} — "${sh.text}"`);

  a.share = null;
  a.send({ type: 'share', resultId: a.result.resultId });
  await a.until((c) => c.share, 4000, 'share again');
  assert.strictEqual(a.share.id, sh.id, 'sharing twice returns the same link');

  /* ---------------- the share page ---------------- */
  const page = await get(sh.url);
  assert.strictEqual(page.status, 200);
  assert.ok(/text\/html/.test(page.headers['content-type']));
  assert.ok(page.body.includes(`<meta property="og:image" content="${base}/og/r/${sh.id}.png">`), 'absolute og:image');
  assert.ok(page.body.includes('<meta name="twitter:card" content="summary_large_image">'));
  assert.ok(page.body.includes(`<link rel="canonical" href="${base}/r/${sh.id}">`), 'canonical');
  assert.ok(new RegExp(`og:title" content="Umair &amp; &quot;Co&quot; typed ${a.result.solo.wpm} WPM`).test(page.body), 'title with escaped name');
  assert.ok(!page.body.includes('Umair & "Co"'), 'name never lands unescaped');
  assert.ok(page.body.includes(`/app#practice/${p.id}/ghost/${a.account.id}`), 'CTA links to racing the sharer\'s ghost');
  assert.ok(page.body.includes('/css/style.css'), 'uses the app stylesheet');
  console.log('✓ /r/:id share page: OG + Twitter tags, canonical, escaped, ghost CTA');

  /* ---------------- the card image ---------------- */
  const card = await get(sh.image);
  assert.strictEqual(card.status, 200);
  if (og.available) {
    assert.strictEqual(card.headers['content-type'], 'image/png');
    assert.ok(card.buf.subarray(0, 8).equals(PNG_MAGIC), 'a real PNG');
    assert.ok(card.buf.length > 8000, `rendered card is substantial (${card.buf.length} bytes)`);
    assert.ok(/immutable/.test(card.headers['cache-control']), 'result cards are immutable');
    const t0 = Date.now();
    await get(sh.image);
    assert.ok(Date.now() - t0 < 200, 'second fetch served from cache');
    assert.ok(og._cache.has(`r:${sh.id}`), 'card cached by share id');
  } else {
    assert.ok(/svg/.test(card.headers['content-type']), 'SVG fallback without the rasteriser');
  }
  console.log(`✓ /og/r/:id.png card: ${card.headers['content-type']}, ${card.buf.length} bytes${og.available ? ', cached' : ''}`);

  /* ---------------- profile page + card, site + daily cards ---------------- */
  const prof = await get(`${base}/u/${a.account.id}`);
  assert.strictEqual(prof.status, 200);
  assert.ok(prof.body.includes('Umair &amp; &quot;Co&quot;') && prof.body.includes('Level 1'), 'profile page renders the account');
  assert.ok(prof.body.includes(`/og/u/${a.account.id}.png`) && prof.body.includes('"@type":"ProfilePage"'), 'profile card + JSON-LD');
  assert.ok(prof.body.includes('Warm-up lap'), 'achievements listed');
  for (const path of [`/og/u/${a.account.id}.png`, '/og/site.png', '/og/daily.png']) {
    const r = await get(base + path);
    assert.strictEqual(r.status, 200, path);
    if (og.available) assert.ok(r.buf.subarray(0, 8).equals(PNG_MAGIC), `${path} is a PNG`);
  }
  console.log('✓ /u/:id profile page + /og/u, /og/site.png, /og/daily.png cards');

  /* ---------------- 404s and bad shares ---------------- */
  assert.strictEqual((await get(`${base}/r/nope1234`)).status, 404);
  assert.ok((await get(`${base}/r/nope1234`)).body.includes('noindex'), '404 page is noindex');
  assert.strictEqual((await get(`${base}/og/r/nope1234.png`)).status, 404);
  assert.strictEqual((await get(`${base}/u/p_doesnotexist`)).status, 404);
  assert.strictEqual((await get(`${base}/og/u/p_doesnotexist.png`)).status, 404);
  const n = a.errors.length;
  a.send({ type: 'share', resultId: 'bogus' });
  await a.until((c) => c.errors.length > n, 3000, 'bad share');
  assert.ok(/expired/i.test(a.errors[n].message));
  console.log('✓ unknown pages/cards 404, unknown result ids are refused');

  /* ---------------- a multiplayer race result shares too ---------------- */
  const b = new C(url, 'Sara', 'SA');
  await b.ready;
  await b.until((c) => c.account, 4000, 'account');
  b.send({ type: 'create' });
  await b.until((c) => c.room && c.room.isPrivate, 4000, 'room');
  b.send({ type: 'start', bots: true });
  await b.until((c) => c.room.state === 'racing', 6000, 'racing');
  const len = b.room.passage.length;
  for (let i = 14; i <= len + 13; i += 14) { b.send({ type: 'progress', c: Math.min(i, len), t: Math.min(i, len), k: Math.min(i, len), e: 0 }); await wait(500); }
  await b.until((c) => c.result, 20000, 'race result');
  assert.ok(b.result.resultId, 'race result carries a result id');
  b.send({ type: 'share', resultId: b.result.resultId });
  await b.until((c) => c.share, 4000, 'race share');
  assert.strictEqual(b.share.kind, 'race');
  assert.ok(/came 1st of \d+ with \d+ WPM/.test(b.share.text), b.share.text);
  const rp = await get(b.share.url);
  assert.ok(rp.body.includes('Sara came 1st of') && rp.body.includes('href="/"'), 'race share page');
  console.log(`✓ race result shared: "${b.share.text}"`);

  /* ---------------- bounded storage ---------------- */
  const s2 = new Shares({ data: {}, touch() {} }, { keep: 3 });
  for (let i = 0; i < 5; i++) { const rid = s2.remember('acc', { kind: 'practice', wpm: i }); s2.create('acc', rid); }
  assert.strictEqual(Object.keys(s2.data).length, 3, 'only the newest SHARE_KEEP shares are kept');
  assert.strictEqual(s2.create('other', s2.remember('acc', { kind: 'practice' })), null, 'cannot share somebody else\'s result');
  await get(sh.url);
  assert.ok(shares.get(sh.id).views >= 2, 'views counted');
  console.log('✓ shares bounded, ownership enforced, views counted');

  a.close(); b.close();
  await wait(150);
  console.log('\nALL SHARE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
