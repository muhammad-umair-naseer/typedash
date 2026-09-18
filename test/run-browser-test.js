'use strict';
/**
 * Real-browser test of practice mode, driven through the locally installed
 * Chrome (puppeteer-core, no download). It proves the "load on the client"
 * property directly: the page's WebSocket is instrumented and a practice run
 * must send exactly one `solo_start` and one `solo_done` and no `progress`.
 *
 *   CHROME=/path/to/chrome node test/run-browser-test.js
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/browser.json';
const assert = require('assert');
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start: records and accounts from earlier runs would skew the assertions */ }
const path = require('path');
const puppeteer = require('puppeteer-core');
const { server, teams } = require('../server/index.js');

const CHROME = process.env.CHROME || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
const SHOTS = process.env.SHOTS || '';   // directory for screenshots (optional)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.log('SKIPPED: no Chrome found (set CHROME=/path/to/chrome)'); process.exit(0); }
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write']);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  // count every message the page sends, by type; capture clipboard writes (headless Chrome cannot read them back)
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('td_onboarded', '1'); } catch (_) { /* seed: skip the first-run wizard in tests */ }
    window.__sent = {};
    window.__copied = null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (t) => { window.__copied = t; return write(t).catch(() => {}); };
    }
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try { const t = JSON.parse(data).type; window.__sent[t] = (window.__sent[t] || 0) + 1; } catch (_) { /* ignore */ }
      return send.call(this, data);
    };
  });
  const sent = () => page.evaluate(() => ({ ...window.__sent }));
  const state = (expr) => page.evaluate(`(() => { const S = window.TypeDash.state; return ${expr}; })()`);

  /* ---------------- first run: nothing to fill in before playing ---------------- */
  {
    const fresh = await browser.createBrowserContext();       // its own empty localStorage
    const fp = await fresh.newPage();
    await fp.goto(`${base}/app`, { waitUntil: 'networkidle0' });
    await fp.waitForFunction(() => window.TypeDash && window.TypeDash.solo.catalogue);
    const firstRun = await fp.evaluate(() => ({
      blocking: [...document.querySelectorAll('.modal')].filter((m) => !m.hidden).map((m) => m.id),
      playable: !!document.getElementById('btn-quick').offsetParent && !!document.getElementById('btn-solo').offsetParent,
      lang: document.getElementById('lang').value,
      folded: document.getElementById('options-wrap').dataset.open === 'false' && document.getElementById('friends-wrap').dataset.open === 'false',
    }));
    assert.deepStrictEqual(firstRun.blocking, [], 'a first-time visitor is not stopped by a setup dialog');
    assert.ok(firstRun.playable && firstRun.folded, 'both play buttons are ready and the extras are folded away');
    assert.ok(firstRun.lang, `a passage language is picked without asking (${firstRun.lang})`);
    await fresh.close();
    console.log(`✓ first run: no setup wizard — home is playable on the first paint (language ${firstRun.lang})`);
  }

  /* ---------------- home -> practice run ---------------- */
  await page.goto(`${base}/app`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#btn-solo');
  await page.click('#btn-options');                         // the identity form is folded away by default
  await page.type('#name', 'Tester');
  await page.select('#pacer', 'medium');
  await page.click('#btn-options');
  assert.ok(/Racing as Tester/.test(await page.$eval('#identity-text', (el) => el.textContent)), 'identity line reflects the name');
  await page.waitForFunction(() => window.TypeDash && window.TypeDash.solo.catalogue);
  const before = await sent();
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.TypeDash.state.room && window.TypeDash.state.room.solo && window.TypeDash.state.room.state === 'countdown');
  assert.ok(await page.$eval('#screen-race', (el) => el.classList.contains('active')), 'race screen shown');
  assert.strictEqual(await page.$eval('#room-type', (el) => el.textContent), 'Practice');
  assert.strictEqual(await page.$eval('.lane.pacer .tag.bot', (el) => el.textContent), 'ROBOT', 'the robot lane is labelled in plain words');
  assert.strictEqual(await page.$$eval('.lane', (ls) => ls.length), 2, 'two lanes: you and the pacer');
  console.log('✓ practice run started from the home page (countdown, pacer lane)');
  await shot('01-countdown');

  await page.waitForFunction(() => window.TypeDash.state.room.state === 'racing', { timeout: 5000 });
  const passage = await state('S.passage');
  assert.ok(passage.length > 100, 'passage loaded locally');
  assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'hidden-input', 'typing input focused at GO');
  const t0 = Date.now();
  await page.keyboard.type(passage, { delay: 34 });            // ~29 cps: fast but under the server ceiling
  await page.waitForFunction(() => window.TypeDash.state.myFinish, { timeout: 5000 });
  const myFinish = await state('S.myFinish');
  assert.strictEqual(myFinish.rank, 1, 'beat the 55 WPM pacer');
  assert.ok(myFinish.wpm > 200, `local wpm computed (${myFinish.wpm})`);
  console.log(`✓ typed ${passage.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${myFinish.wpm} WPM, rank ${myFinish.rank}`);
  await shot('02-finish-banner');

  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 5000 });
  assert.ok(!(await page.$eval('#solo-results', (el) => el.hidden)), 'practice results block visible');
  assert.ok(await page.$eval('#podium', (el) => el.hidden), 'podium hidden for practice');
  await page.waitForFunction(() => !document.documentElement.dataset.counting, { timeout: 3000 });   // the headline number counts up
  assert.strictEqual(await page.$eval('#sr-wpm', (el) => el.textContent), String(myFinish.wpm));
  assert.ok(/beat the robot \(55 words a min\)/i.test(await page.$eval('#sr-lines', (el) => el.textContent)), 'result says who won, in plain words');
  await page.waitForFunction(() => /faster|your best yet|fastest on your own/i.test(document.getElementById('sr-lines').textContent), { timeout: 5000 });
  assert.ok(/nobody on typedash has typed this paragraph faster/i.test(await page.$eval('#sr-lines', (el) => el.textContent)), 'first verified run on a paragraph sets its record');
  await page.waitForFunction(() => /Warm-up lap/.test(document.getElementById('mr-unlocks').textContent), { timeout: 5000 });
  assert.ok(/no points for typing on your own/i.test(await page.$eval('#mr-xp', (el) => el.textContent)), 'says plainly that this one earns no points');
  assert.ok(/1 go on your own so far/.test(await page.$eval('#sr-lines', (el) => el.textContent)));
  console.log('✓ results modal: local numbers, then server verdict (personal best + achievement chips)');
  await shot('03-results');

  const after = await sent();
  const delta = (t) => (after[t] || 0) - (before[t] || 0);
  assert.strictEqual(delta('progress'), 0, 'no progress messages during a practice run');
  assert.strictEqual(delta('solo_start'), 1, 'exactly one solo_start');
  assert.strictEqual(delta('solo_done'), 1, 'exactly one solo_done');
  assert.strictEqual(delta('rev'), 0, 'no rev traffic in practice');
  console.log('✓ socket traffic for the whole run:', JSON.stringify(Object.fromEntries(Object.keys(after).filter((k) => delta(k)).map((k) => [k, delta(k)]))));

  /* ---------------- share the result ---------------- */
  await page.waitForFunction(() => !document.getElementById('btn-share').hidden, { timeout: 5000 });
  await page.click('#btn-share');
  await page.waitForFunction(() => !document.getElementById('share-dialog').hidden, { timeout: 5000 });
  const shareText = await page.$eval('#share-text', (el) => el.textContent);
  assert.ok(/\/r\/[a-z0-9]{8}/.test(shareText) && /WPM/.test(shareText), `share text (${shareText})`);
  await page.waitForFunction(() => { const i = document.getElementById('share-img'); return i.complete && i.naturalWidth === 1200; }, { timeout: 10000 });
  await page.click('#share-copy-link');
  await page.waitForFunction(() => window.__copied !== null, { timeout: 3000 });
  assert.strictEqual(await page.evaluate(() => window.__copied), shareText, 'link copied to the clipboard');
  const shareUrl = shareText.match(/https?:\/\/\S+\/r\/[a-z0-9]+/)[0];
  const sharePage = await (await fetch(shareUrl)).text();
  assert.ok(sharePage.includes('og:image') && sharePage.includes('Tester typed'), 'share page live');
  await shot('03b-share');
  await page.click('#share-close');
  await page.waitForFunction(() => document.getElementById('share-dialog').hidden);
  console.log('✓ share: card rendered (1200px), link copied, /r/ page live');

  // profile on the home page reflects the run once we go back
  const profile = await page.evaluate(() => window.TypeDash.account.stats);
  assert.strictEqual(profile.solo.finished, 1);
  assert.strictEqual(profile.races, 0, 'races untouched');
  assert.strictEqual(profile.streak, 1, 'streak started by a practice run');

  /* ---------------- practice again ---------------- */
  const firstId = await state('S.room.passageId');
  await page.click('#btn-solo-again');
  await page.waitForFunction(() => window.TypeDash.state.room.state === 'countdown' && window.TypeDash.state.room.raceNo === 2);
  assert.notStrictEqual(await state('S.room.passageId'), firstId, 'a different passage the second time');
  assert.ok(await page.$eval('#results', (el) => el.hidden), 'results closed');
  console.log('✓ practice again -> new run with a different passage');

  /* ---------------- leave to home ---------------- */
  await page.click('#btn-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  assert.strictEqual(await state('S.room'), null);
  assert.strictEqual(await page.$eval('#st-races', (el) => el.textContent), '0');
  console.log('✓ leave mid-run returns home, nothing recorded');

  /* ---------------- ghost: race the world record set by the first run ---------------- */
  await page.select('#pacer', 'wr');                              // persisted; the deep link below uses it
  await page.goto('about:blank');
  await page.goto(`${base}/app#practice/${firstId}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.TypeDash && window.TypeDash.state.room && window.TypeDash.state.room.state === 'racing', { timeout: 6000 });
  assert.strictEqual(await page.$eval('.lane.ghost .tag.bot', (el) => el.textContent), 'REPLAY', 'the replay lane is labelled in plain words');
  assert.strictEqual(await page.$eval('.lane.ghost .name', (el) => el.textContent), 'Tester', "the ghost is the record holder's replay");
  const ghostPassage = await state('S.passage');
  await page.keyboard.type(ghostPassage, { delay: 60 });          // slower than the ~300 WPM record: the ghost wins
  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 8000 });
  assert.ok(/they were faster/i.test(await page.$eval('#results-title', (el) => el.textContent)));
  assert.ok(/Tester's run \(\d+ words a min\) was [\d.]+ s faster/.test(await page.$eval('#sr-lines', (el) => el.textContent)), 'replay verdict line');
  assert.ok(await page.$eval('.lane.ghost', (el) => el.classList.contains('finished')), 'replay lane finished');
  console.log('✓ replay: the record holder\'s car ran its timeline and won');
  await shot('07-ghost-results');
  await page.click('#btn-results-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  await page.select('#pacer', 'medium');

  // "beat my ghost" share links: /#practice/<id>/ghost/<accountId> races that account's personal best
  const accountId = await page.evaluate(() => window.TypeDash.account.id);
  await page.goto('about:blank');
  await page.goto(`${base}/app#practice/${firstId}/ghost/${accountId}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.TypeDash && window.TypeDash.state.room && window.TypeDash.state.room.state === 'racing', { timeout: 6000 });
  assert.strictEqual(await page.$eval('.lane.ghost .name', (el) => el.textContent), 'Tester', 'ghost-of-account deep link');
  await page.click('#btn-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  console.log('✓ /#practice/<id>/ghost/<account> races that player\'s ghost');

  /* ---------------- deep link: /#practice/<id> (a cold load, as from a /practice page) ---------------- */
  await page.goto('about:blank');
  await page.goto(`${base}/app#practice/trains`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.TypeDash && window.TypeDash.state.room && window.TypeDash.state.room.solo, { timeout: 5000 });
  assert.strictEqual(await state('S.room.passageId'), 'trains', 'deep link picked the requested passage');
  assert.ok(/Trains have a rhythm/.test(await page.$eval('#status', (el) => el.textContent)), 'status shows the passage title');
  console.log('✓ /#practice/trains auto-starts that passage');

  /* ---------------- race the world from practice results ---------------- */
  await page.waitForFunction(() => window.TypeDash.state.room.state === 'racing', { timeout: 5000 });
  const p2 = await state('S.passage');
  await page.keyboard.type(p2, { delay: 34 });
  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 6000 });
  await page.click('#btn-solo-world');
  await page.waitForFunction(() => window.TypeDash.state.room && !window.TypeDash.state.room.solo && window.TypeDash.state.room.state === 'waiting', { timeout: 6000 });
  assert.strictEqual(await page.$eval('#room-type', (el) => el.textContent), 'Ranked');
  console.log('✓ "Race the world" drops straight into public matchmaking');
  await shot('04-lobby');

  /* ---------------- daily challenge ---------------- */
  await page.click('#btn-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  await page.waitForFunction(() => /^#\d+/.test((document.querySelector('#daily-card .daily-head b') || {}).textContent || ''));
  const dailyTitle = await page.$eval('#daily-card .daily-head b', (el) => el.textContent);
  assert.ok(await page.$('.tab[data-cat="daily"]'), 'Daily tab on the world rankings');
  assert.ok(/Have a go/.test(await page.$eval('#btn-daily', (el) => el.textContent)));
  const beforeDaily = await sent();
  await page.click('#btn-daily');
  await page.waitForFunction(() => window.TypeDash.state.room && window.TypeDash.state.room.mode === 'daily' && window.TypeDash.state.room.state === 'racing', { timeout: 6000 });
  assert.strictEqual(await page.$eval('#room-type', (el) => el.textContent), 'Daily');
  const dailyPassage = await state('S.passage');
  const apiDaily = await (await fetch(`${base}/api/daily`)).json();
  assert.strictEqual(dailyPassage, apiDaily.passage.text, "the run uses today's passage");
  assert.deepStrictEqual(await state('S.room.bonusWords'), apiDaily.bonusWords, "and today's golden words");
  await page.keyboard.type(dailyPassage, { delay: 34 });
  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 6000 });
  await page.waitForFunction(() => /this one counted/i.test(document.getElementById('sr-lines').textContent), { timeout: 5000 });
  assert.ok(/#1 of 1 today/.test(await page.$eval('#sr-lines', (el) => el.textContent)), 'ranked #1 of 1');
  assert.ok(/Today's paragraph · #\d+/.test(await page.$eval('#results-title', (el) => el.textContent)));
  await page.waitForFunction(() => /Daily driver/.test(document.getElementById('mr-unlocks').textContent), { timeout: 5000 });
  const afterDaily = await sent();
  assert.strictEqual((afterDaily.progress || 0) - (beforeDaily.progress || 0), 0, 'daily run streamed nothing');
  assert.strictEqual((afterDaily.solo_done || 0) - (beforeDaily.solo_done || 0), 1);
  await shot('05-daily-results');
  await page.click('#btn-results-leave');
  await page.waitForFunction(() => /You:/.test(document.getElementById('daily-card').textContent), { timeout: 5000 });
  assert.ok(/Have another go/.test(await page.$eval('#btn-daily', (el) => el.textContent)), 'card knows today is done');
  assert.ok(/#1/.test(await page.$eval('#daily-card .daily-stats', (el) => el.textContent)), 'card shows my rank');
  console.log(`✓ daily challenge (${dailyTitle}): played from the strip, counted #1, card updated`);
  await shot('06-home-after-daily');

  /* ---------------- language + mode selectors ---------------- */
  await page.waitForFunction(() => document.querySelectorAll('#lang option').length >= 7);
  await page.select('#lang', 'es');
  await page.select('#mode', 'prose');
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.TypeDash.state.room && window.TypeDash.state.room.solo);
  assert.strictEqual(await state('S.room.passageLang'), 'es', 'practice honours the language selector');
  await page.click('#btn-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  await page.select('#mode', 'code');
  await page.select('#lang', 'en');
  await page.click('#btn-solo');
  await page.waitForFunction(() => window.TypeDash.state.room && window.TypeDash.state.room.solo);
  assert.strictEqual(await state('S.room.category'), 'code', 'and the mode selector');
  await page.click('#btn-leave');
  await page.waitForFunction(() => document.getElementById('screen-home').classList.contains('active'));
  await page.select('#mode', 'prose');
  console.log('✓ language and mode selectors drive practice (es prose, en code)');

  /* ---------------- teams: create, then a friend joins from the invite link ---------------- */
  await page.evaluate(() => { location.hash = '#/team'; });
  await page.waitForFunction(() => document.getElementById('screen-team').classList.contains('active'));
  await page.waitForSelector('#team-create-form');
  assert.ok(await page.$eval('#screen-rankings', (el) => !el.classList.contains('active')) && await page.$eval('#screen-team', (el) => el.classList.contains('active')), 'module pages show one at a time');
  await page.type('#team-create-form input[name=name]', 'Speed Demons');
  await page.type('#team-create-form input[name=tag]', 'spd');
  await page.click('#team-create-form button[type=submit]');
  await page.waitForFunction(() => /\[SPD\]/.test(document.getElementById('team-card').textContent), { timeout: 5000 });
  assert.ok(/1\/\d+ members/.test(await page.$eval('#team-card', (el) => el.textContent)), 'team card shows the new team');
  const invite = Object.values(teams.data)[0].invite;
  const friend = await browser.createBrowserContext();       // a different browser = a different account
  const friendPage = await friend.newPage();
  await friendPage.goto(`${base}/app#team/${invite}`, { waitUntil: 'networkidle0' });
  await friendPage.waitForFunction(() => /\[SPD\]/.test(document.getElementById('team-card').textContent), { timeout: 6000 });
  assert.ok(/2\/\d+ members/.test(await friendPage.$eval('#team-card', (el) => el.textContent)), 'friend joined from the invite link');
  await friend.close();
  console.log('✓ teams: created from the profile card; a friend joined through /#team/<code>');

  assert.deepStrictEqual(pageErrors, [], 'no console/page errors');
  await browser.close();
  console.log('\nALL BROWSER TESTS PASSED');
  process.exit(0);
})().catch(async (e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
