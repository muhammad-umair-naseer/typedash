'use strict';
/**
 * Phone-emulation test (iPhone 13 profile in the local Chrome): the keyboard
 * readiness flow, a full practice run, the layout at 390px, and the PWA
 * surface (manifest, icons, service worker).
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/mobile.json';
const assert = require('assert');
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const path = require('path');
const puppeteer = require('puppeteer-core');
const { server } = require('../server/index.js');

const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
const SHOTS = process.env.SHOTS || '';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

(async () => {
  if (!CHROME) { console.log('SKIPPED: no Chrome found (set CHROME=/path/to/chrome)'); process.exit(0); }
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;

  /* ---------------- PWA surface over plain HTTP ---------------- */
  const manifestRes = await fetch(`${base}/manifest.webmanifest`);
  assert.strictEqual(manifestRes.status, 200);
  assert.ok(/application\/manifest\+json/.test(manifestRes.headers.get('content-type')), 'manifest MIME type');
  const manifest = await manifestRes.json();
  assert.strictEqual(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512') && manifest.icons.some((i) => i.purpose === 'maskable'), 'icons incl. maskable');
  for (const icon of manifest.icons) {
    const r = await fetch(base + icon.src);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(r.status === 200 && buf.subarray(0, 8).equals(PNG_MAGIC), `${icon.src} is a PNG`);
    const size = buf.readUInt32BE(16);
    assert.strictEqual(String(size), icon.sizes.split('x')[0], `${icon.src} is ${icon.sizes}`);
  }
  const sw = await fetch(`${base}/sw.js`);
  assert.ok(sw.status === 200 && /javascript/.test(sw.headers.get('content-type')), 'service worker served');
  // a deploy has to be visible on the next load: code revalidates, art may sit in the cache
  for (const asset of ['/css/style.css', '/js/main.js']) {
    const r = await fetch(base + asset);
    const tag = r.headers.get('etag');
    assert.strictEqual(r.headers.get('cache-control'), 'no-cache', `${asset} is revalidated, never served stale`);
    assert.ok(tag, `${asset} has an ETag`);
    const again = await fetch(base + asset, { headers: { 'If-None-Match': tag } });
    assert.strictEqual(again.status, 304, `${asset} answers a conditional request with 304`);
  }
  const icon = await fetch(`${base}/icons/icon-192.png`);
  assert.ok(/immutable/.test(icon.headers.get('cache-control')), 'icons may stay cached');
  const swBody = await (await fetch(`${base}/sw.js`)).text();
  assert.ok(/network first|fetch\(req\)/.test(swBody) && /\(css\|js\)/.test(swBody), 'the worker fetches the app code from the network first');
  console.log('✓ caching: css/js revalidate (304), icons immutable, worker takes code from the network first');
  const home = await (await fetch(`${base}/app`)).text();
  assert.ok(home.includes('rel="manifest"') && home.includes('apple-touch-icon'), 'manifest + apple icon linked');
  console.log('✓ PWA: manifest, 4 icons (PNG, right sizes), service worker, links in the page');

  /* ---------------- phone emulation ---------------- */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.emulate(puppeteer.KnownDevices['iPhone 13']);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
  // puppeteer taps at the element's centre without scrolling when it is only partly visible; centre it first
  const tap = async (sel) => { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.tap(sel); };
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('td_onboarded', '1'); } catch (_) { /* seed: skip the first-run wizard in tests */ } });

  await page.goto(`${base}/app`, { waitUntil: 'networkidle0' });
  assert.ok(await page.evaluate(() => document.body.classList.contains('touch')), 'touch mode detected');
  const vp = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth, visual: window.visualViewport.width }));
  assert.ok(vp.inner <= 391 && vp.scroll <= 391, `nothing wider than the screen (layout ${vp.inner}px, content ${vp.scroll}px, visual ${vp.visual}px)`);
  assert.ok(await page.evaluate(() => document.getElementById('daily-card').getBoundingClientRect().width <= window.innerWidth), 'daily strip fits the phone');
  // the canvases carry a device-pixel backing store; their layout box must still be the viewport (dpr 3 here)
  const canvases = await page.evaluate(() => ['bg', 'confetti'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { id, w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
  }));
  for (const c of canvases) assert.ok(c.w === c.vw && c.h === c.vh, `#${c.id} covers the viewport, not ${c.w}x${c.h} for ${c.vw}x${c.vh}`);
  // the identity form now stays in the DOM and grows open, so "folded" means zero height and out of the tab order
  const folded = await page.evaluate(() => {
    const wrap = document.getElementById('options-wrap');
    return { open: wrap.dataset.open, h: Math.round(wrap.getBoundingClientRect().height), vis: getComputedStyle(wrap.firstElementChild).visibility };
  });
  assert.ok(folded.open === 'false' && folded.h === 0 && folded.vis === 'hidden', `identity form folded away by default (${JSON.stringify(folded)})`);
  const btnH = await page.$eval('#btn-solo', (el) => el.getBoundingClientRect().height);
  assert.ok(btnH >= 40, `tap targets are big enough (${btnH}px)`);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller || (navigator.serviceWorker && navigator.serviceWorker.getRegistrations && true));
  const swState = await page.evaluate(async () => { const regs = await navigator.serviceWorker.getRegistrations(); return regs.length; });
  assert.ok(swState >= 1, 'service worker registered');
  await shot('m1-home');
  console.log('✓ phone layout: touch mode, no overflow, stacked daily strip, full-viewport canvases, SW registered');

  await page.waitForFunction(() => window.TypeDash && window.TypeDash.solo.catalogue);
  await tap('#btn-solo');
  await page.waitForFunction(() => window.TypeDash.state.room && window.TypeDash.state.room.state === 'countdown');
  assert.ok(!(await page.$eval('#focus-overlay', (el) => el.hidden)), 'keyboard-ready overlay shown during the countdown');
  assert.ok(/keyboard/.test(await page.$eval('#focus-overlay', (el) => el.textContent)));
  await tap('#focus-overlay');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'hidden-input', 'tap focuses the input before GO');
  assert.ok(await page.$eval('#focus-overlay', (el) => el.hidden), 'overlay gone once focused');
  await shot('m2-countdown');
  await page.waitForFunction(() => window.TypeDash.state.room.state === 'racing', { timeout: 5000 });
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'hidden-input', 'still focused at GO');
  const passage = await page.evaluate(() => window.TypeDash.state.passage);
  await page.keyboard.type(passage, { delay: 34 });
  await page.waitForFunction(() => !document.getElementById('results').hidden, { timeout: 8000 });
  await page.waitForFunction(() => !document.documentElement.dataset.counting, { timeout: 3000 });   // the headline number counts up
  assert.ok((await page.$eval('#sr-wpm', (el) => Number(el.textContent))) > 100, 'run finished with a result');
  await shot('m3-results');
  console.log('✓ full practice run on a phone: overlay tap -> keyboard focus -> typed -> results');

  // losing focus mid-race brings the tap prompt back
  await tap('#btn-solo-again');
  await page.waitForFunction(() => window.TypeDash.state.room.state === 'racing', { timeout: 6000 });
  await page.evaluate(() => document.getElementById('hidden-input').blur());
  await page.waitForFunction(() => !document.getElementById('focus-overlay').hidden, { timeout: 2000 });
  assert.ok(/keep typing/.test(await page.$eval('#focus-overlay', (el) => el.textContent)));
  await tap('#focus-overlay');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'hidden-input');
  console.log('✓ blur mid-race shows the tap prompt; tapping refocuses');

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('\nALL MOBILE TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
