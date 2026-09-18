'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const cfg = require('./config');
const { randomId, sanitizeText, sanitizeCountry, sanitizeSkin } = require('./util');
const Player = require('./Player');
const RoomManager = require('./RoomManager');
const Store = require('./store');
const { Accounts } = require('./accounts');
const { Leaderboards } = require('./leaderboards');
const { CATALOGUE } = require('./achievements');
const passages = require('./passages');
const solo = require('./solo');
const { Daily } = require('./daily');
const { Ghosts } = require('./ghosts');
const { Shares } = require('./share');
const { Seasons } = require('./seasons');
const { Teams } = require('./teams');
const { Notify } = require('./notify');
const og = require('./og');
const pages = require('./pages');
const progression = require('./progression');
const countries = require('./countries');
const { dayKey } = require('./accounts');

// Must match public/js/skins.js. Skins are cosmetic; the server only validates the id.
const SKINS = ['dash', 'bolt', 'hatch', 'muscle', 'flame', 'pickup', 'rocket', 'checker', 'nova'];

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const store = new Store(path.resolve(__dirname, '..', cfg.DATA_FILE));
const accounts = new Accounts(store);
const boards = new Leaderboards(accounts);
const manager = new RoomManager({ accounts, boards });
const daily = new Daily(store, accounts);
const ghosts = new Ghosts(store);
manager.ghosts = ghosts;
const shares = new Shares(store, { keep: cfg.SHARE_KEEP });
manager.shares = shares;
const teams = new Teams(store, accounts);
boards.register('teams', { label: 'Teams', windows: ['season', 'week', 'all'], format: 'points', rows: (win, live) => teams.rows(win, live) });
boards.register('countries', { label: 'Countries', windows: ['week', 'season', 'today'], format: 'points', rows: (win, live) => teams.countryRows(win, live) });
const notify = new Notify(store, accounts, { daily });
notify.start();
const seasons = new Seasons(store, accounts);
seasons.check();
seasons.onArchived = (s) => { teams.archiveSeason(s.key, s.number, boards.live.bind(boards)); boards.invalidate(); pageCache.clear(); };
const seasonTimer = setInterval(() => seasons.check(), 60000);
seasonTimer.unref?.();
const clients = new Map();

/** Public origin for absolute URLs: configured, else what the proxy / client asked for. */
function originOf(req) {
  if (cfg.PUBLIC_ORIGIN) return cfg.PUBLIC_ORIGIN;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** Everything a profile page or card needs, from the account record. */
function profileView(acc) {
  const level = progression.levelForPoints(acc.points);
  const row = boards.rows('points', 'all', 'global').find((r) => r.id === acc.id);
  return {
    id: acc.id, name: acc.name, country: acc.country, skin: acc.skin, level, title: progression.titleFor(level),
    points: acc.points, bestWpm: acc.bestWpm, bestCombo: acc.bestCombo, wins: acc.wins, races: acc.races, streak: acc.streak,
    worldRank: row ? row.rank : null, achievements: acc.achievements || [], solo: acc.solo || { finished: 0 },
  };
}

function sendHtml(res, status, html, cacheControl = 'no-cache') {
  res.writeHead(status, { 'Content-Type': MIME['.html'], 'Cache-Control': cacheControl });
  res.end(html);
}

/** A social card: PNG when the rasteriser is installed (cached), else the SVG itself. */
function sendCard(res, key, svg, ttlMs, cacheControl) {
  const buf = og.png(key, svg, ttlMs);
  if (buf) {
    res.writeHead(200, { 'Content-Type': MIME['.png'], 'Content-Length': buf.length, 'Cache-Control': cacheControl });
    return res.end(buf);
  }
  res.writeHead(200, { 'Content-Type': MIME['.svg'], 'Cache-Control': cacheControl });
  res.end(svg);
}

// Today's daily challenge is a board like any other; its rows come from daily.js.
boards.register('daily', { label: 'Today', windows: ['today'], format: 'wpm', rows: () => daily.rows() });
daily.onChange = () => manager.onRaceSettled && manager.onRaceSettled();

// The passage catalogue is static for the life of the process: build the
// response once so practice mode can pull it over plain HTTP with caching.
const PASSAGES_BODY = JSON.stringify({
  bonusWords: cfg.BONUS_WORDS,
  langs: passages.LANGS,
  categories: passages.CATEGORIES,
  stages: passages.STAGES,
  passages: passages.PASSAGES.map(({ id, title, lang, category, words, text, stage }) => ({ id, title, lang, category, words, text, stage })),
});

/** Room options a client may ask for (language + mode), validated. */
const roomOpts = (msg) => ({
  lang: passages.isLang(msg && msg.lang) ? msg.lang : 'en',
  category: passages.isCategory(msg && msg.category) ? msg.category : 'prose',
});
const PASSAGES_ETAG = `"${require('crypto').createHash('sha1').update(PASSAGES_BODY).digest('hex').slice(0, 16)}"`;

// index.html is static except for the absolute URLs search engines and link
// unfurlers need; substitute the origin once per host and keep the result.
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');
let indexSrc = { mtime: 0, text: '' };
const indexCache = new Map();
function indexHtml(origin) {
  const mtime = fs.statSync(INDEX_PATH).mtimeMs;   // re-read when the file changes (dev loop, hot deploys)
  if (mtime !== indexSrc.mtime) {
    indexSrc = { mtime, text: fs.readFileSync(INDEX_PATH, 'utf8') };
    indexCache.clear();
  }
  let html = indexCache.get(origin);
  if (!html) {
    html = indexSrc.text.replace(/__ORIGIN__/g, origin);
    indexCache.set(origin, html);
    if (indexCache.size > 20) indexCache.delete(indexCache.keys().next().value);
  }
  return html;
}

// The marketing/landing page lives at /; the game itself at /app. Both are
// static except for the origin substitution, and both are cached per host.
const SPLASH_PATH = path.join(PUBLIC_DIR, 'splash.html');
let splashSrc = { mtime: 0, text: '' };
const splashCache = new Map();
function splashHtml(origin) {
  const mtime = fs.statSync(SPLASH_PATH).mtimeMs;
  if (mtime !== splashSrc.mtime) {
    splashSrc = { mtime, text: fs.readFileSync(SPLASH_PATH, 'utf8') };
    splashCache.clear();
  }
  let html = splashCache.get(origin);
  if (!html) {
    html = splashSrc.text
      .replace(/__ORIGIN__/g, origin)
      .replace(/__PASSAGES__/g, String(passages.PASSAGES.length))
      .replace(/__LANGS__/g, String(Object.keys(passages.LANGS).length))
      .replace(/__RACERS__/g, String(cfg.MAX_PLAYERS));
    splashCache.set(origin, html);
    if (splashCache.size > 20) splashCache.delete(splashCache.keys().next().value);
  }
  return html;
}

// Server-rendered pages are cheap string assembly, but crawlers arrive in
// bursts: keep each rendered page for a short while.
const pageCache = new Map();
function cachedPage(key, ttlMs, render) {
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.html;
  const html = render();
  pageCache.set(key, { at: Date.now(), html });
  if (pageCache.size > 500) pageCache.delete(pageCache.keys().next().value);
  return html;
}

/** Countries that have at least one ranked player (drives country pages and the sitemap). */
let countriesCache = { at: 0, list: [] };
function countriesWithPlayers() {
  if (Date.now() - countriesCache.at > 300000) {
    const set = new Set();
    for (const a of accounts.all) if (a.points > 0 && countries.isCountry(a.country)) set.add(a.country);
    countriesCache = { at: Date.now(), list: [...set].sort() };
  }
  return countriesCache.list;
}

function sitemapUrls() {
  const urls = [
    { path: '/', changefreq: 'daily', priority: 1 },
    { path: '/daily', changefreq: 'daily', priority: 0.9 },
    { path: '/practice', changefreq: 'weekly', priority: 0.8 },
    { path: '/leaderboard', changefreq: 'hourly', priority: 0.8 },
  ];
  for (const c of countriesWithPlayers()) urls.push({ path: `/leaderboard/${c}`, changefreq: 'daily', priority: 0.6 });
  for (const set of pages.practiceSets(passages.PASSAGES, passages.LANGS, passages.CATEGORIES)) urls.push({ path: set.path, changefreq: 'weekly', priority: 0.75 });
  for (const p of passages.PASSAGES) urls.push({ path: `/practice/${p.id}`, changefreq: 'weekly', priority: 0.7 });
  for (const r of boards.rows('points', 'all', 'global').slice(0, 100)) urls.push({ path: `/u/${r.id}`, changefreq: 'weekly', priority: 0.4 });
  return urls;
}

/* ------------------------------------------------------------- HTTP */

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (urlPath === '/api/stats') {
    const body = JSON.stringify({
      online: clients.size, ...manager.stats(), accounts: accounts.size, uptime: Math.round(process.uptime()),
      embeds: store.data.embedRefs || {},
    });
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (urlPath.startsWith('/api/board')) {
    const q = new URLSearchParams((req.url.split('?')[1] || ''));
    const body = JSON.stringify(boards.board(q.get('category') || 'points', q.get('window') || 'all', (q.get('scope') || 'global').toUpperCase(), null));
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  /* ---- pages search engines can read (leaderboard, practice, daily, robots, sitemap) ---- */
  const origin = originOf(req);
  let m;
  if (urlPath === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    return res.end(pages.robots(origin));
  }
  if (urlPath === '/sitemap.xml') {
    const xml = cachedPage(`sitemap:${origin}`, 600000, () => pages.sitemap(origin, sitemapUrls()));
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
    return res.end(xml);
  }
  if (urlPath === '/leaderboard' || urlPath === '/leaderboard/' || (m = urlPath.match(/^\/leaderboard\/([A-Za-z]{2})\/?$/))) {
    const scope = m ? m[1].toUpperCase() : 'global';
    if (scope !== 'global' && !countries.isCountry(scope)) return sendHtml(res, 404, pages.notFoundPage(origin, urlPath));
    const html = cachedPage(`lb:${origin}:${scope}`, 30000, () => pages.leaderboardPage({
      origin, scope,
      top: { points: boards.rows('points', 'all', scope).slice(0, 25), season: boards.rows('points', 'season', scope).slice(0, 25), wpm: boards.rows('wpm', 'all', scope).slice(0, 10), streak: boards.rows('streak', 'all', scope).slice(0, 10) },
      teams: scope === 'global' ? boards.rows('teams', 'season', 'global').slice(0, 10) : null,
      countryRows: scope === 'global' ? boards.rows('countries', 'week', 'global').slice(0, 10) : null,
      countries: countriesWithPlayers(),
      dailyRows: scope === 'global' ? boards.rows('daily', 'today', 'global').slice(0, 10) : null,
      season: seasons.summary(boards),
    }));
    return sendHtml(res, 200, html, 'public, max-age=30');
  }
  if (urlPath === '/practice' || urlPath === '/practice/') {
    const html = cachedPage(`practice:${origin}`, 60000, () => pages.practiceIndexPage({ origin, passages: passages.PASSAGES, records: ghosts.records(), langs: passages.LANGS, categories: passages.CATEGORIES }));
    return sendHtml(res, 200, html, 'public, max-age=60');
  }
  if ((m = urlPath.match(/^\/practice\/(lang|drill)\/([a-z0-9-]+)\/?$/))) {
    const sets = pages.practiceSets(passages.PASSAGES, passages.LANGS, passages.CATEGORIES);
    const wanted = m[1] === 'lang' ? m[2] : m[2];
    const set = sets.find((x) => x.key === wanted && x.kind === (m[1] === 'lang' ? 'language' : 'drill'));
    if (!set) return sendHtml(res, 404, pages.notFoundPage(origin, urlPath));
    const html = cachedPage(`practice-set:${origin}:${set.key}`, 60000, () => pages.practiceSetPage({ origin, set, records: ghosts.records(), allSets: sets }));
    return sendHtml(res, 200, html, 'public, max-age=60');
  }
  if ((m = urlPath.match(/^\/practice\/([a-z0-9-]+)\/?$/))) {
    const p = passages.byId(m[1]);
    if (!p) return sendHtml(res, 404, pages.notFoundPage(origin, urlPath));
    const i = passages.PASSAGES.indexOf(p);
    const html = cachedPage(`practice:${origin}:${p.id}`, 60000, () => pages.practicePage({
      origin, passage: p, record: ghosts.wr(p.id), prev: passages.PASSAGES[i - 1] || null, next: passages.PASSAGES[i + 1] || null,
      langs: passages.LANGS, categories: passages.CATEGORIES,
    }));
    return sendHtml(res, 200, html, 'public, max-age=60');
  }
  if (urlPath === '/embed' || urlPath === '/embed/') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const ref = sanitizeText(q.get('ref'), 80).toLowerCase().replace(/[^a-z0-9.\-:]/g, '');
    if (ref) {
      const refs = store.data.embedRefs || (store.data.embedRefs = {});
      if (refs[ref] != null || Object.keys(refs).length < 200) { refs[ref] = (refs[ref] || 0) + 1; store.touch(); }
    }
    const html = cachedPage(`embed:${origin}:${q.get('passage') || ''}`, 60000, () => pages.embedPage({ origin, passage: passages.byId(q.get('passage')) }));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Content-Security-Policy': 'frame-ancestors *' });
    return res.end(html);
  }
  if (urlPath === '/embed.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
    return fs.createReadStream(path.join(PUBLIC_DIR, 'embed-loader.js')).pipe(res);
  }
  if (urlPath === '/daily' || urlPath === '/daily/') {
    const html = cachedPage(`daily:${origin}:${dayKey()}`, 30000, () => {
      const today = daily.summary();
      const y = new Date(Date.now() - 86400000);
      const yRows = daily.rows(dayKey(y)).slice(0, 10);
      const yc = require('./daily').challengeFor(dayKey(y));
      return pages.dailyPage({ origin, today, yesterday: { number: yc.number, title: yc.passage.title, top: yRows.map((r) => ({ ...r, wpm: r.value })) } });
    });
    return sendHtml(res, 200, html, 'public, max-age=30');
  }

  /* ---- share pages, profiles and social cards ---- */
  if ((m = urlPath.match(/^\/r\/([a-z0-9]{6,12})\/?$/))) {
    const s = shares.get(m[1]);
    if (!s) return sendHtml(res, 404, pages.notFoundPage(originOf(req), urlPath));
    shares.viewed(m[1]);
    return sendHtml(res, 200, pages.sharePage(s, m[1], originOf(req)));
  }
  if ((m = urlPath.match(/^\/u\/(p_[A-Za-z0-9_-]{6,24})\/?$/))) {
    const acc = accounts.accounts[m[1]];
    if (!acc) return sendHtml(res, 404, pages.notFoundPage(originOf(req), urlPath));
    return sendHtml(res, 200, pages.profilePage(profileView(acc), originOf(req)));
  }
  if ((m = urlPath.match(/^\/og\/r\/([a-z0-9]{6,12})\.png$/))) {
    const s = shares.get(m[1]);
    if (!s) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    return sendCard(res, `r:${m[1]}`, og.resultCard(s, originOf(req)), 365 * 86400000, 'public, max-age=31536000, immutable');
  }
  if ((m = urlPath.match(/^\/og\/u\/(p_[A-Za-z0-9_-]{6,24})\.png$/))) {
    const acc = accounts.accounts[m[1]];
    if (!acc) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    const p = profileView(acc);
    return sendCard(res, `u:${acc.id}:${acc.points}:${acc.races}:${acc.name}:${acc.skin}`, og.profileCard(p, originOf(req)), 600000, 'public, max-age=600');
  }
  if (urlPath === '/og/site.png') {
    const o = originOf(req);
    return sendCard(res, `site:${o}`, og.siteCard(o), 365 * 86400000, 'public, max-age=86400');
  }
  if (urlPath === '/og/daily.png') {
    const d = daily.summary();
    return sendCard(res, `daily:${d.day}:${d.players}:${d.top[0] ? d.top[0].wpm : 0}`, og.dailyCard(d, originOf(req)), 300000, 'public, max-age=300');
  }
  if ((m = urlPath.match(/^\/api\/team\/(t_[a-z0-9]{6})$/))) {
    const t = teams.get(m[1]);
    res.writeHead(t ? 200 : 404, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(t ? teams.view(t, boards) : { error: 'Unknown team' }));
  }
  if ((m = urlPath.match(/^\/t\/(t_[a-z0-9]{6})\/?$/))) {
    const t = teams.get(m[1]);
    if (!t) return sendHtml(res, 404, pages.notFoundPage(origin, urlPath));
    return sendHtml(res, 200, cachedPage(`team:${origin}:${t.id}`, 30000, () => pages.teamPage(teams.view(t, boards), origin)), 'public, max-age=30');
  }
  if (urlPath === '/api/push/key') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=3600' });
    return res.end(JSON.stringify({ key: notify.publicKey }));
  }
  if (urlPath === '/api/season') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=60' });
    return res.end(JSON.stringify(seasons.summary(boards, new URLSearchParams(req.url.split('?')[1] || '').get('me') || null)));
  }
  if (urlPath === '/api/ghost') {
    const q = new URLSearchParams(req.url.split('?')[1] || '');
    const id = q.get('passage') || '';
    const me = q.get('me') || null;
    const body = passages.byId(id)
      ? { passageId: id, wr: ghosts.pub(ghosts.wr(id), me), pb: me ? ghosts.pub(ghosts.pb(me, id), me) : null }
      : { error: 'Unknown passage' };
    res.writeHead(passages.byId(id) ? 200 : 404, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(body));
  }
  if (urlPath === '/api/records') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=30' });
    return res.end(JSON.stringify({ records: ghosts.records() }));
  }
  if (urlPath === '/api/daily') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(daily.summary(new URLSearchParams(req.url.split('?')[1] || '').get('me') || null)));
  }
  if (urlPath === '/api/passages') {
    if (req.headers['if-none-match'] === PASSAGES_ETAG) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=3600', ETag: PASSAGES_ETAG });
    return res.end(PASSAGES_BODY);
  }
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/splash') return sendHtml(res, 200, splashHtml(origin));
  if (urlPath === '/app' || urlPath === '/app/') return sendHtml(res, 200, indexHtml(origin));
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // Unknown path: still load the app (so nothing dead-ends), but say 404 so
      // search engines never index junk URLs as pages.
      return sendHtml(res, 404, indexHtml(origin));
    }
    const ext = path.extname(filePath).toLowerCase();
    // Code (css/js/manifest) must never be served stale: the browser revalidates
    // every time and gets a cheap 304 while nothing has changed. Only art that
    // rarely changes is allowed to sit in the cache.
    const longLived = /^\/(icons|fonts)\//.test(urlPath);
    const tag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(36)}"`;
    const lastModified = stat.mtime.toUTCString();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': longLived ? 'public, max-age=31536000, immutable' : 'no-cache',
      ETag: tag,
      'Last-Modified': lastModified,
    };
    if (req.headers['if-none-match'] === tag || req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server, maxPayload: cfg.MAX_PAYLOAD });

/* -------------------------------------------------------- WebSocket */

function broadcastAll(msg) {
  const str = JSON.stringify(msg);
  for (const p of clients.values()) p.sendRaw(str);
}

/**
 * After a race settles, boards are stale. Invalidate the cache and push a
 * refreshed copy of whichever board each client is currently looking at,
 * throttled so a busy server isn't re-sorting for every finished race.
 */
let boardPushTimer = null;
manager.onRaceSettled = () => {
  boards.invalidate();
  if (boardPushTimer) return;
  boardPushTimer = setTimeout(() => {
    boardPushTimer = null;
    boards.invalidate();
    for (const p of clients.values()) {
      if (!p.watching) continue;
      const { category, window: win, scope } = p.watching;
      p.send(boards.board(category, win, scope, p.account ? p.account.id : null));
    }
  }, cfg.BOARD_PUSH_MS);
  boardPushTimer.unref?.();
};

function handle(player, msg) {
  switch (msg.type) {
    case 'ping':
      return player.send({ type: 'pong', t: msg.t, st: Date.now() });

    case 'hello': {
      player.name = sanitizeText(msg.name, cfg.MAX_NAME_LEN) || 'Guest-' + player.id.slice(0, 3);
      player.country = sanitizeCountry(msg.country);
      player.skin = sanitizeSkin(msg.skin, SKINS);

      // resolve (or mint) the persistent account behind this browser
      if (!player.account) {
        const { account, token, created } = accounts.login(msg.accountId, msg.token);
        player.account = account;
        player.send({
          type: 'account',
          id: account.id,
          token,                       // only sent when the account is minted
          created,
          profile: accounts.profile(account),
          standings: boards.standings(account),
        });
      }
      accounts.setIdentity(player.account, { name: player.name, country: player.country, skin: player.skin });
      const team = teams.of(player.account);
      player.tag = team ? team.tag : null;

      player.send({ type: 'hello_ok', player: player.info() });
      if (team) player.send({ type: 'team', team: teams.view(team, boards) });
      if (player.room) player.room.broadcastState();
      return;
    }

    case 'board': {
      const category = typeof msg.category === 'string' ? msg.category : 'points';
      const win = typeof msg.window === 'string' ? msg.window : 'all';
      const scope = String(msg.scope || 'global').toUpperCase();
      player.watching = { category, window: win, scope };
      return player.send(boards.board(category, win, scope, player.account ? player.account.id : null));
    }

    case 'quick':
      manager.quickMatch(player, roomOpts(msg));
      return;

    case 'create':
      manager.createPrivate(player, roomOpts(msg));
      return;

    case 'join':
      try {
        manager.join(player, msg.code);
      } catch (err) {
        player.send({ type: 'error', message: err.message });
      }
      return;

    case 'leave':
      manager.leave(player);
      player.send({ type: 'left' });
      return;

    case 'start':
      if (player.room) player.room.hostStart(player, !!msg.bots);
      return;

    case 'progress':
      if (player.room) player.room.handleProgress(player, msg);
      return;

    case 'chat':
      if (player.room) player.room.handleChat(player, msg.text);
      return;

    case 'emote':
      if (player.room) player.room.handleEmote(player, msg.e);
      return;

    case 'rev':
      if (player.room) player.room.handleRev(player);
      return;

    /* Practice runs are computed in the browser; see server/solo.js. */
    case 'solo_start':
      if (!solo.stamp(player, msg)) player.send({ type: 'error', message: 'Unknown passage.' });
      return;

    case 'solo_done': {
      if (!player.account) return player.send({ type: 'error', message: 'Say hello first.' });
      const v = solo.validate(msg, solo.takeStamp(player));
      if (!v.ok) return player.send({ type: 'error', message: v.reason, solo: true });
      // ghosts first: "beat the record" is judged against what stood before this run
      const g = ghosts.consider(player.account, v.r);
      const kind = ['wr', 'pb', 'leader', 'rival'].includes(msg.pacerKind) ? msg.pacerKind : 'wpm';
      v.r.beatGhost = v.r.finished && ((kind === 'wr' && !!g.prevWr && v.r.wpm > g.prevWr.wpm) || (kind === 'pb' && !!g.prevPb && v.r.wpm > g.prevPb.wpm) || ((kind === 'leader' || kind === 'rival') && v.r.beatPacer));
      v.r.setWr = g.wr;
      const out = accounts.recordSolo(player.account, v.r);
      if (out.streakEvent && manager.onRaceSettled) manager.onRaceSettled();
      let dailyOut = null;
      if (v.r.mode === 'daily') {
        dailyOut = daily.record(player.account, v.r);
        out.unlocked.push(...accounts.unlock(player.account, { ...v.r, solo: true, daily: dailyOut }, ['daily']));
      }
      const resultId = v.r.finished ? shares.remember(player.account.id, {
        kind: v.r.mode === 'daily' ? 'daily' : 'practice', name: player.name, country: player.country, skin: player.skin, color: '#4cc9f0',
        wpm: v.r.wpm, accuracy: v.r.accuracy, time: v.r.time, passageId: v.r.passageId, passageTitle: v.r.passageTitle,
        dailyNumber: dailyOut ? dailyOut.number : null, rank: dailyOut && dailyOut.counted ? dailyOut.rank : null, of: dailyOut && dailyOut.counted ? dailyOut.of : null,
        pacer: v.r.pacerWpm ? { kind: kind === 'wpm' ? 'wpm' : 'ghost', wpm: v.r.pacerWpm, won: v.r.beatPacer, name: sanitizeText(msg.pacerName, 24) || null } : null,
      }) : null;
      player.send({
        type: 'race_result',
        resultId,
        daily: dailyOut,
        solo: {
          mode: v.r.mode, passageId: v.r.passageId, passageTitle: v.r.passageTitle,
          wpm: v.r.wpm, accuracy: v.r.accuracy, time: v.r.time, chars: v.r.chars, finished: v.r.finished,
          verified: v.r.verified, improved: out.improved, best: out.best, runs: out.runs,
          pacerWpm: v.r.pacerWpm, beatPacer: v.r.beatPacer,
          ghost: { wr: g.wr, pb: g.pb, beat: v.r.beatGhost, prevWr: g.prevWr, kind },
        },
        points: 0,
        ranked: false,
        streak: out.streak,
        bestStreak: out.bestStreak,
        streakEvent: out.streakEvent,
        unlocked: out.unlocked,
        profile: accounts.profile(player.account),
        standings: boards.standings(player.account),
        series: [],
      });
      return;
    }

    /* Push reminders: the browser hands us its subscription; we keep at most a few per account. */
    case 'push_subscribe': {
      if (!player.account) return player.send({ type: 'error', message: 'Say hello first.' });
      try {
        const n = notify.subscribe(player.account, msg.subscription, msg.prefs || {}, msg.tzOffset);
        player.send({ type: 'push', subscribed: true, devices: n, prefs: player.account.pushPrefs });
      } catch (err) {
        player.send({ type: 'error', message: err.message });
      }
      return;
    }
    case 'push_unsubscribe': {
      if (!player.account) return;
      const n = notify.unsubscribe(player.account, typeof msg.endpoint === 'string' ? msg.endpoint : null);
      player.send({ type: 'push', subscribed: n > 0, devices: n, prefs: player.account.pushPrefs || null });
      return;
    }

    /* Teams: create / join by invite / leave / refresh. Tags show in every lobby. */
    case 'team_create':
    case 'team_join':
    case 'team_leave':
    case 'team_info':
    case 'team_rotate': {
      if (!player.account) return player.send({ type: 'error', message: 'Say hello first.' });
      try {
        let team = null;
        if (msg.type === 'team_create') team = teams.create(player.account, { name: msg.name, tag: msg.tag });
        else if (msg.type === 'team_join') team = teams.join(player.account, msg.code);
        else if (msg.type === 'team_leave') team = (teams.leave(player.account), null);
        else if (msg.type === 'team_rotate') team = teams.rotateInvite(player.account);
        else team = teams.of(player.account);
        const unlocked = msg.type === 'team_create' || msg.type === 'team_join' ? accounts.unlock(player.account, {}, ['team']) : [];
        player.tag = team ? team.tag : null;
        boards.invalidate();
        player.send({ type: 'team', team: team ? teams.view(team, boards) : null, unlocked, profile: accounts.profile(player.account) });
        if (player.room) player.room.broadcastState();
      } catch (err) {
        player.send({ type: 'error', message: err.message, team: true });
      }
      return;
    }

    /* Turn a settled result into a public share page + card. */
    case 'share': {
      if (!player.account) return player.send({ type: 'error', message: 'Say hello first.' });
      const id = shares.create(player.account.id, msg.resultId);
      if (!id) return player.send({ type: 'error', message: 'Nothing to share — that result has expired. Race again!' });
      const s = shares.get(id);
      const url = `${player.origin}/r/${id}`;
      return player.send({ type: 'share', id, url, image: `${player.origin}/og/r/${id}.png`, text: Shares.text(s, url), kind: s.kind });
    }

    default:
      return;
  }
}

wss.on('connection', (ws, req) => {
  const player = new Player({ id: randomId(10), ws });
  player.origin = originOf(req);
  clients.set(player.id, player);
  ws.isAlive = true;

  player.send({
    type: 'welcome',
    id: player.id,
    serverTime: Date.now(),
    online: clients.size,
    achievements: CATALOGUE,
    boards: boards.meta(),
    config: { maxPlayers: cfg.MAX_PLAYERS, tickMs: cfg.TICK_MS, rankedPrivate: cfg.RANKED_PRIVATE },
  });
  broadcastAll({ type: 'online', n: clients.size });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (_) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try {
      handle(player, msg);
    } catch (err) {
      console.error('[handle]', err);
      player.send({ type: 'error', message: 'Something went wrong on the server.' });
    }
  });

  ws.on('close', () => {
    manager.leave(player);
    clients.delete(player.id);
    broadcastAll({ type: 'online', n: clients.size });
  });

  ws.on('error', () => { /* handled by close */ });
});

// Liveness: drop sockets that stop answering pings (mobile sleep, dead NAT, ...)
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
heartbeat.unref();

server.listen(cfg.PORT, () => {
  console.log(`TypeDash listening on http://localhost:${cfg.PORT}  (tick ${cfg.TICK_MS} ms, ${cfg.MAX_PLAYERS} racers/room)`);
});

/** Test hook: forget every rendered page and derived list. */
function resetCaches() {
  pageCache.clear();
  countriesCache = { at: 0, list: [] };
  boards.invalidate();
}

module.exports = { server, wss, manager, accounts, boards, store, daily, ghosts, shares, seasons, teams, notify, _pageCache: pageCache, _resetCaches: resetCaches };
