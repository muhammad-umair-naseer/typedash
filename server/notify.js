'use strict';
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const cfg = require('./config');
const { dayKey, daysBetween } = require('./accounts');

/**
 * Web Push reminders with no dependency: VAPID (RFC 8292) and the aes128gcm
 * message encryption (RFC 8291 / RFC 8188) are done with Node's crypto.
 *
 * Two reminders, both cheap and both bounded to one per account per day:
 *   - streak at risk: the player has a streak, played yesterday, not yet
 *     today, and it is evening where they are;
 *   - daily challenge (opt-in): mid-morning local time, if not yet played.
 *
 * The scheduler walks the account table once every PUSH_TICK_MS; delivery is
 * a single HTTPS POST per subscription. Dead endpoints (404/410) are dropped.
 */
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

/* --------------------------------------------------------------- VAPID */

function generateVapid() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

/** A private key object for signing from the raw 32-byte scalar + 65-byte point. */
function privateKeyObject(privateKey, publicKey) {
  const pub = fromB64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: privateKey };
  return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
}

/** RFC 8292: a short-lived ES256 JWT for one push service origin. */
function vapidHeaders(endpoint, keys, subject = cfg.VAPID_SUBJECT, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const data = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(keys.privateKey, keys.publicKey), dsaEncoding: 'ieee-p1363' });
  return { Authorization: `vapid t=${data}.${b64u(sig)}, k=${keys.publicKey}` };
}

/* ------------------------------------------------------------ encryption */

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/**
 * RFC 8291 aes128gcm encryption of `payload` for a subscription's keys.
 * `opts.salt` / `opts.serverKey` may be injected to reproduce the RFC vector.
 */
function encrypt(payload, subscription, opts = {}) {
  const uaPub = fromB64u(subscription.keys.p256dh);
  const auth = fromB64u(subscription.keys.auth);
  if (uaPub.length !== 65 || auth.length !== 16) throw new Error('bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.serverKey) ecdh.setPrivateKey(fromB64u(opts.serverKey)); else ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const salt = opts.salt ? fromB64u(opts.salt) : crypto.randomBytes(16);

  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, serverPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);   // 0x02: last record
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = serverPub.length;
  return Buffer.concat([header, serverPub, body]);
}

/** The receiving side (what a browser does) — used by the tests to prove round trips. */
function decrypt(message, uaPrivateKey, auth) {
  const salt = message.subarray(0, 16);
  const idlen = message[20];
  const serverPub = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(fromB64u(uaPrivateKey));
  const uaPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(serverPub);
  const ikm = hkdf(fromB64u(auth), shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, serverPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.length - 1).toString();   // strip the 0x02 delimiter
}

/* ---------------------------------------------------------------- class */

class Notify {
  constructor(store, accounts, { daily = null } = {}) {
    this.store = store;
    this.accounts = accounts;
    this.daily = daily;
    if (cfg.VAPID_PUBLIC && cfg.VAPID_PRIVATE) this.keys = { publicKey: cfg.VAPID_PUBLIC, privateKey: cfg.VAPID_PRIVATE };
    else {
      if (!store.data.vapid) { store.data.vapid = generateVapid(); store.touch(); }
      this.keys = store.data.vapid;
    }
    this.sent = 0;
    this.transport = null;   // test hook: (url, options, body) => Promise<status>
  }

  get publicKey() { return this.keys.publicKey; }

  subscribe(acc, subscription, prefs = null, tzOffset = null) {
    if (!subscription || typeof subscription.endpoint !== 'string' || !/^https?:\/\//.test(subscription.endpoint)) throw new Error('Invalid subscription.');
    if (!subscription.keys || fromB64u(subscription.keys.p256dh).length !== 65 || fromB64u(subscription.keys.auth).length !== 16) throw new Error('Invalid subscription keys.');
    acc.push = (acc.push || []).filter((s) => s.endpoint !== subscription.endpoint);
    acc.push.push({ endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }, at: Date.now() });
    while (acc.push.length > cfg.PUSH_MAX_SUBS) acc.push.shift();
    // another device subscribing without saying anything keeps the account's settings
    if (prefs) acc.pushPrefs = { streak: prefs.streak !== false, daily: !!prefs.daily };
    else if (!acc.pushPrefs) acc.pushPrefs = { streak: true, daily: false };
    if (tzOffset != null) acc.tzOffset = Math.max(-840, Math.min(840, Number(tzOffset) | 0));   // minutes east of UTC
    this.store.touch();
    return acc.push.length;
  }

  unsubscribe(acc, endpoint) {
    acc.push = (acc.push || []).filter((s) => !endpoint || s.endpoint !== endpoint);
    this.store.touch();
    return acc.push.length;
  }

  /** Deliver one payload to every subscription of an account. Resolves with the number delivered. */
  async send(acc, payload, { ttl = 86400, urgency = 'normal' } = {}) {
    if (!acc.push || !acc.push.length) return 0;
    const json = JSON.stringify(payload);
    let delivered = 0;
    for (const sub of [...acc.push]) {
      let status;
      try {
        const body = encrypt(json, sub);
        const headers = {
          ...vapidHeaders(sub.endpoint, this.keys),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
          TTL: ttl,
          Urgency: urgency,
        };
        status = await this.post(sub.endpoint, headers, body);
      } catch (err) {
        status = 0;
      }
      if (status >= 200 && status < 300) { delivered += 1; this.sent += 1; }
      else if (status === 404 || status === 410) this.unsubscribe(acc, sub.endpoint);
    }
    return delivered;
  }

  post(url, headers, body) {
    if (this.transport) return this.transport(url, headers, body);
    return new Promise((resolve) => {
      const u = new URL(url);
      const lib = u.protocol === 'http:' ? http : https;
      const req = lib.request(u, { method: 'POST', headers, timeout: 10000 }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
      req.on('timeout', () => { req.destroy(); resolve(0); });
      req.end(body);
    });
  }

  /** Local hour for an account (from the offset its browser reported). */
  localHour(acc, now) {
    return new Date(now.getTime() + (acc.tzOffset || 0) * 60000).getUTCHours();
  }

  /**
   * One scheduler pass. Returns how many reminders went out. Idempotent per
   * account per day thanks to pushLast / pushDailyLast.
   */
  async tick(now = new Date()) {
    const today = dayKey(now);
    const yesterday = dayKey(new Date(now.getTime() - 86400000));
    let out = 0;
    for (const acc of this.accounts.all) {
      if (!acc.push || !acc.push.length) continue;
      const prefs = acc.pushPrefs || { streak: true, daily: false };
      const hour = this.localHour(acc, now);

      if (prefs.streak && acc.streak > 0 && acc.lastPlayDay === yesterday && acc.pushLast !== today && hour >= cfg.PUSH_STREAK_HOUR) {
        const localMidnightIn = Math.round(((24 - hour) % 24 || 24));
        const n = await this.send(acc, {
          title: `🔥 ${acc.streak}-day streak at risk`,
          body: `One race or practice run today keeps it alive — about ${localMidnightIn}h left (streaks roll over at midnight UTC).`,
          url: '/app#practice', tag: 'streak',
        });
        acc.pushLast = today;
        this.store.touch();
        out += n;
      }

      if (prefs.daily && this.daily && acc.pushDailyLast !== today && hour >= cfg.PUSH_DAILY_HOUR && !(acc.daily && acc.daily.last === today)) {
        const ch = this.daily.today(now);
        const n = await this.send(acc, {
          title: `⚡ Daily #${ch.number} is up`,
          body: `“${ch.passage.title}” — ${ch.passage.words} words, same passage for everyone, one scored attempt.`,
          url: '/app#daily', tag: 'daily',
        });
        acc.pushDailyLast = today;
        this.store.touch();
        out += n;
      }
    }
    return out;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => console.error('[notify]', e.message)), cfg.PUSH_TICK_MS);
    this.timer.unref?.();
  }
}

module.exports = { Notify, encrypt, decrypt, vapidHeaders, generateVapid, daysBetween };
