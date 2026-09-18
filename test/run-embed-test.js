'use strict';
/**
 * Embed widget: /embed is a self-contained typing race (no socket, no
 * account) that any site can drop in with one script tag. Checks the page,
 * the loader, referral counting, and a real run inside an iframe in Chrome.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/embed.json';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const puppeteer = require('puppeteer-core');
const { server, store } = require('../server/index.js');
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;

  /* ---------------- the documents ---------------- */
  const e = await fetch(`${base}/embed?passage=trains&ref=Example.COM`);
  assert.strictEqual(e.status, 200);
  assert.strictEqual(e.headers.get('x-frame-options'), null, 'framing allowed');
  assert.ok(/frame-ancestors \*/.test(e.headers.get('content-security-policy')), 'frame-ancestors *');
  const html = await e.text();
  assert.ok(html.includes('/js/embed.js') && html.includes('noindex') && html.includes('Trains have a rhythm'), 'embed page with the requested passage');
  assert.ok(html.includes(`${base}/?ref=embed`), 'links back into the game');
  assert.strictEqual(store.data.embedRefs['example.com'], 1, 'referrer counted (normalised)');
  await fetch(`${base}/embed?ref=example.com`);
  assert.strictEqual(store.data.embedRefs['example.com'], 2);
  const stats = await (await fetch(`${base}/api/stats`)).json();
  assert.strictEqual(stats.embeds['example.com'], 2, '/api/stats reports embeds');
  const loader = await fetch(`${base}/embed.js`);
  assert.ok(loader.status === 200 && /javascript/.test(loader.headers.get('content-type')) && loader.headers.get('access-control-allow-origin') === '*');
  const loaderSrc = await loader.text();
  assert.ok(loaderSrc.includes("'/embed?'") && loaderSrc.includes('typedash:height'), 'loader injects the iframe and listens for height');
  const practice = await (await fetch(`${base}/practice`)).text();
  assert.ok(practice.includes(`${base}/embed.js`), '/practice advertises the snippet');
  console.log('✓ /embed page (framable, noindex, passage), /embed.js loader, referral counting, snippet on /practice');

  if (!CHROME) { console.log('SKIPPED browser part: no Chrome found'); process.exit(0); }

  /* ---------------- a real run inside an iframe ---------------- */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (er) => errors.push(String(er)));
  // a "third-party" host page: same origin here, but it goes through the loader exactly like a blog would
  await page.goto(`${base}/robots.txt`);
  await page.setContent(`<!doctype html><html><body><h1>My blog</h1><script src="${base}/embed.js" data-passage="trains" data-pacer="40"></script></body></html>`, { waitUntil: 'load' });
  await page.waitForSelector('iframe[title="TypeDash typing race"]');
  const frameEl = await page.$('iframe');
  const frame = await frameEl.contentFrame();
  await frame.waitForFunction(() => document.getElementById('passage').textContent.includes('Trains have a rhythm'));
  assert.ok(await frameEl.evaluate((f) => f.src.includes('passage=trains') && f.src.includes('pacer=40') && f.src.includes('ref=')), 'loader passed the data attributes and ref');
  const text = await frame.evaluate(() => document.getElementById('passage').textContent);
  await frame.click('#passage-wrap');
  await page.keyboard.type(text, { delay: 12 });          // typing goes to the focused frame input
  await frame.waitForFunction(() => !document.getElementById('result').hidden, { timeout: 10000 });
  const wpm = Number(await frame.$eval('#r-wpm', (n) => n.textContent));
  assert.ok(wpm > 100, `finished with a result (${wpm} WPM)`);
  assert.ok(/beat the robot \(40 words a min\)/.test(await frame.$eval('#r-line', (n) => n.textContent)), 'result says who won, in plain words');
  const href = await frame.$eval('#btn-play', (a) => a.href);
  assert.ok(href.startsWith(`${base}/app?ref=embed`) && href.includes('#practice/trains'), 'CTA deep-links into the game with the same passage');
  const h = await frameEl.evaluate((f) => parseInt(f.style.height, 10));
  assert.ok(h >= 240 && h !== 420, `iframe resized to its content (${h}px)`);
  await frame.click('#btn-again');
  assert.ok(await frame.$eval('#result', (n) => n.hidden), 'try again resets');
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log(`✓ run inside the iframe: ${wpm} WPM, pacer verdict, CTA deep link, auto-resized to ${h}px`);
  console.log('\nALL EMBED TESTS PASSED');
  process.exit(0);
})().catch((err) => { console.error('\nTEST FAILED:', err); process.exit(1); });
