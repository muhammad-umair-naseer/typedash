'use strict';
/**
 * Web Push without a dependency: VAPID signatures, RFC 8291 encryption
 * (checked against the RFC's own test vector and by decrypting as a browser
 * would), subscription handling over the socket, real deliveries to a fake
 * push service, and the reminder scheduler's rules.
 */
process.env.PORT = '0';
process.env.DATA_FILE = process.env.DATA_FILE || '/tmp/typedash-test/push.json';
const fs = require('fs');
try { fs.unlinkSync(process.env.DATA_FILE); } catch (_) { /* fresh start */ }
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { server, accounts, notify } = require('../server/index.js');
const { encrypt, decrypt, vapidHeaders, generateVapid } = require('../server/notify.js');
const { dayKey } = require('../server/accounts.js');
const cfg = require('../server/config.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');

(async () => {
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://localhost:${server.address().port}`;
  const url = `ws://localhost:${server.address().port}`;

  /* ---------------- RFC 8291 section 5 test vector ---------------- */
  const vector = {
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    serverPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    plaintext: 'When I grow up, I want to be a watermelon',
    expected: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  const sub = { endpoint: 'https://push.example/x', keys: { p256dh: vector.uaPublic, auth: vector.auth } };
  const out = encrypt(vector.plaintext, sub, { salt: vector.salt, serverKey: vector.serverPrivate });
  assert.strictEqual(b64u(out), vector.expected, 'encryption matches RFC 8291 byte for byte');
  assert.strictEqual(decrypt(out, vector.uaPrivate, vector.auth), vector.plaintext, 'and decrypts as a browser would');
  console.log('✓ RFC 8291 test vector: encrypt matches, decrypt round-trips');

  /* ---------------- VAPID ---------------- */
  const keys = generateVapid();
  assert.strictEqual(Buffer.from(keys.publicKey, 'base64url').length, 65);
  const h = vapidHeaders('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:test@example.com');
  const m = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m && m[2] === keys.publicKey, 'authorization header shape');
  const [hdr, pl, sig] = m[1].split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(hdr, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const payload = JSON.parse(Buffer.from(pl, 'base64url'));
  assert.strictEqual(payload.aud, 'https://fcm.googleapis.com');
  assert.strictEqual(payload.sub, 'mailto:test@example.com');
  assert.ok(payload.exp > Date.now() / 1000 && payload.exp <= Date.now() / 1000 + 12 * 3600 + 5);
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${hdr}.${pl}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'JWT signature verifies with the public key');
  const apiKey = await (await fetch(`${base}/api/push/key`)).json();
  assert.strictEqual(apiKey.key, notify.publicKey);
  assert.strictEqual(Buffer.from(apiKey.key, 'base64url').length, 65, 'server key generated and published');
  console.log('✓ VAPID: ES256 JWT verifies, audience = push origin, /api/push/key');

  /* ---------------- a fake push service ---------------- */
  const received = [];
  let respondWith = 201;
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(respondWith); res.end(); });
  });
  await new Promise((r) => fake.listen(0, r));
  const pushBase = `http://localhost:${fake.address().port}`;

  // a "browser": its own P-256 key pair + auth secret
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const subscription = { endpoint: `${pushBase}/send/device-1`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };

  /* ---------------- subscribe over the socket ---------------- */
  const msgs = [];
  const ws = new WebSocket(url);
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
  ws.send(JSON.stringify({ type: 'hello', name: 'Umair', country: 'PK' }));
  await wait(150);
  const accountId = msgs.find((x) => x.type === 'account').id;
  const acc = accounts.accounts[accountId];
  ws.send(JSON.stringify({ type: 'push_subscribe', subscription, prefs: { streak: true, daily: true }, tzOffset: 300 }));
  await wait(150);
  const ack = msgs.find((x) => x.type === 'push');
  assert.ok(ack && ack.subscribed && ack.devices === 1, 'subscription acknowledged');
  assert.strictEqual(acc.push.length, 1);
  assert.deepStrictEqual(acc.pushPrefs, { streak: true, daily: true });
  assert.strictEqual(acc.tzOffset, 300);
  ws.send(JSON.stringify({ type: 'push_subscribe', subscription: { endpoint: 'javascript:alert(1)', keys: subscription.keys } }));
  await wait(120);
  assert.ok(msgs.some((x) => x.type === 'error' && /Invalid subscription/.test(x.message)), 'bad endpoint refused');
  for (let i = 0; i < cfg.PUSH_MAX_SUBS + 2; i++) notify.subscribe(acc, { ...subscription, endpoint: `${pushBase}/send/extra-${i}` });
  assert.strictEqual(acc.push.length, cfg.PUSH_MAX_SUBS, 'devices per account bounded');
  acc.push = [{ endpoint: subscription.endpoint, keys: subscription.keys, at: Date.now() }];
  console.log('✓ push_subscribe / validation / device cap; profile carries device count');

  /* ---------------- delivery: encrypted, signed, decryptable by the device ---------------- */
  const n = await notify.send(acc, { title: 'Hello', body: 'world', url: '/app#practice' });
  assert.strictEqual(n, 1, 'delivered');
  const req = received[0];
  assert.strictEqual(req.url, '/send/device-1');
  assert.strictEqual(req.headers['content-encoding'], 'aes128gcm');
  assert.strictEqual(req.headers['content-type'], 'application/octet-stream');
  assert.strictEqual(req.headers.ttl, '86400');
  assert.ok(/^vapid t=.+, k=/.test(req.headers.authorization), 'VAPID authorization sent');
  assert.strictEqual(Number(req.headers['content-length']), req.body.length);
  const decrypted = JSON.parse(decrypt(req.body, b64u(ua.getPrivateKey()), b64u(auth)));
  assert.deepStrictEqual(decrypted, { title: 'Hello', body: 'world', url: '/app#practice' }, 'the device can decrypt the payload');
  console.log(`✓ delivery: ${req.body.length}-byte aes128gcm message, decrypted on the "device"`);

  /* ---------------- scheduler rules ---------------- */
  received.length = 0;
  const now = new Date('2026-09-18T15:00:00Z');       // 20:00 local at +300 min
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  Object.assign(acc, { streak: 3, lastPlayDay: yesterday, pushLast: null, pushDailyLast: null, daily: { last: null } });
  let sent = await notify.tick(now);
  assert.strictEqual(sent, 2, 'streak reminder + daily reminder (evening, both due)');
  const bodies = received.map((r) => JSON.parse(decrypt(r.body, b64u(ua.getPrivateKey()), b64u(auth))));
  assert.ok(bodies.some((b) => /3-day streak at risk/.test(b.title)) && bodies.some((b) => /Daily #\d+ is up/.test(b.title)), JSON.stringify(bodies));
  assert.strictEqual(acc.pushLast, today);
  assert.strictEqual(await notify.tick(now), 0, 'nothing twice in a day');
  Object.assign(acc, { pushLast: null, pushDailyLast: null, lastPlayDay: today, daily: { last: today } });
  assert.strictEqual(await notify.tick(now), 0, 'already played today: no reminders');
  Object.assign(acc, { lastPlayDay: yesterday, daily: { last: null }, pushPrefs: { streak: true, daily: false } });
  assert.strictEqual(await notify.tick(new Date('2026-09-18T08:00:00Z')), 0, '13:00 local: too early for the evening nudge');
  assert.strictEqual(await notify.tick(now), 1, 'daily opted out: only the streak reminder');
  Object.assign(acc, { pushLast: null, streak: 0 });
  assert.strictEqual(await notify.tick(now), 0, 'no streak, nothing to save');
  console.log('✓ scheduler: evening streak nudge, morning daily (opt-in), once per day, skips players who already played');

  /* ---------------- dead endpoints are dropped ---------------- */
  respondWith = 410;
  Object.assign(acc, { pushLast: null, streak: 2, lastPlayDay: yesterday });
  await notify.tick(now);
  assert.strictEqual(acc.push.length, 0, '410 Gone removes the subscription');
  ws.send(JSON.stringify({ type: 'push_unsubscribe' }));
  await wait(120);
  assert.ok(msgs.filter((x) => x.type === 'push').pop().subscribed === false);
  console.log('✓ 410 from the push service drops the device; push_unsubscribe acknowledged');

  ws.close();
  fake.close();
  await wait(150);
  console.log('\nALL PUSH TESTS PASSED');
  process.exit(0);
})().catch((e) => { console.error('\nTEST FAILED:', e); process.exit(1); });
