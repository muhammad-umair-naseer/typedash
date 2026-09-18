import { Net } from './net.js';
import { ServerClock } from './clock.js';
import { Interpolator } from './interp.js';
import { Track } from './track.js';
import { TypingArea } from './typing.js';
import { Background } from './background.js';
import { Confetti } from './confetti.js';
import { Sound } from './audio.js';
import { RaceGame } from './game.js';
import { Account, pointsForLevel } from './account.js';
import { Boards } from './boards.js';
import { SKINS } from './skins.js';
import { carSvg } from './cars.js';
import { COUNTRIES, flag, detectCountry } from './countries.js';
import { $, escapeHtml, fmtTime, toast, medal } from './ui.js';
import { Solo, PACERS } from './solo.js';
import { DailyCard } from './daily.js';
import { ShareDialog } from './share.js';
import { TeamCard } from './team.js';
import { PushReminders } from './push.js';

/* ------------------------------------------------------------------ tuning */

const INTERP_DELAY_MS = 150; // render remote racers this far behind server time (1.5 ticks)
const SEND_INTERVAL_MS = 40; // max progress upload rate (25 Hz)
const GO_FLASH_MS = 800;

/* ---------------------------------------------------------------- modules */

const net = new Net();
const clock = new ServerClock(net);
const sound = new Sound();
const bg = new Background($('#bg'));
const confetti = new Confetti($('#confetti'));
const track = new Track($('#track'));
const typing = new TypingArea($('#passage'), $('#hidden-input'));
const game = new RaceGame();
const account = new Account();

/* ------------------------------------------------------------------ state */

const S = {
  myId: null,
  room: null,
  passage: '',
  players: new Map(),
  interp: new Map(),
  local: { correct: 0, typed: 0, keystrokes: 0, errors: 0, done: false, vis: 0 },
  myFinish: null,
  lastSendAt: 0,
  sendTimer: null,
  lastCd: null,
  goUntil: 0,
  lastFrame: performance.now(),
  pending: null,       // action to run once the socket is open
  hadSession: false,   // were we in a room when the socket dropped?
  unreadChat: 0,
  nitroShown: false,   // local nitro state currently reflected on the track
  lastScoreShown: -1,
  lastComboShown: -1,
  emotesRendered: false,
  lastRevAt: 0,
  lastResultId: null,  // the settled result the Share button publishes
};

/** Touch devices need the keyboard raised inside a tap, and a layout that survives the keyboard. */
const IS_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
if (IS_TOUCH) document.body.classList.add('touch');

/** The local racer's id: the socket id in a room, or the id a practice run was started with. */
const myId = () => (S.room && S.room.solo ? S.room.meId : S.myId);

const el = {
  home: $('#screen-home'),
  race: $('#screen-race'),
  name: $('#name'),
  country: $('#country'),
  flagPrev: $('#flag-preview'),
  code: $('#code'),
  online: $('#online'),
  ping: $('#ping'),
  pingPill: $('#ping-pill'),
  boards: $('#boards'),
  rivals: $('#rivals'),
  rankChips: $('#rank-chips'),
  streakBox: $('#streak-box'),
  streakFlame: $('#streak-flame'),
  streakDays: $('#streak-days'),
  streakSub: $('#streak-sub'),
  streakWeek: $('#streak-week'),
  series: $('#series'),
  roomCode: $('#room-code'),
  roomType: $('#room-type'),
  status: $('#status'),
  seats: $('#seats'),
  hostBar: $('#host-bar'),
  botsCheck: $('#bots-check'),
  trackWrap: $('#track-wrap'),
  hudWpm: $('#hud-wpm'),
  hudAcc: $('#hud-acc'),
  hudCombo: $('#hud-combo'),
  hudMult: $('#hud-mult'),
  comboStat: $('#combo-stat'),
  hudScore: $('#hud-score'),
  nitroStat: $('#nitro-stat'),
  nitroFill: $('#nitro-fill'),
  nitroLabel: $('#nitro-label'),
  countdown: $('#countdown'),
  cdNum: $('#cd-num'),
  cdSub: $('#cd-sub'),
  passageWrap: $('#passage-wrap'),
  focusOverlay: $('#focus-overlay'),
  finishBanner: $('#finish-banner'),
  callouts: $('#callouts'),
  emoteBar: $('#emote-bar'),
  results: $('#results'),
  resultsTitle: $('#results-title'),
  podium: $('#podium'),
  resultsBody: $('#results-body'),
  nextRace: $('#next-race'),
  myRace: $('#my-race'),
  mrScore: $('#mr-score'),
  mrCombo: $('#mr-combo'),
  mrNitro: $('#mr-nitro'),
  mrGolden: $('#mr-golden'),
  mrXp: $('#mr-xp'),
  mrLevel: $('#mr-level'),
  mrXpFill: $('#mr-xp-fill'),
  mrXpText: $('#mr-xp-text'),
  mrUnlocks: $('#mr-unlocks'),
  levelup: $('#levelup'),
  levelupNum: $('#levelup-num'),
  levelupTitle: $('#levelup-title'),
  levelupSkins: $('#levelup-skins'),
  chat: $('#chat'),
  chatToggle: $('#chat-toggle'),
  chatLog: $('#chat-log'),
  chatInput: $('#chat-input'),
  connBanner: $('#conn-banner'),
  soundBtn: $('#sound-btn'),
  topLevel: $('#top-level'),
  topTitle: $('#top-title'),
  profLevel: $('#prof-level'),
  profTitle: $('#prof-title'),
  levelRing: $('#level-ring'),
  xpFill: $('#xp-fill'),
  xpText: $('#xp-text'),
  stPoints: $('#st-points'),
  stRaces: $('#st-races'),
  stWins: $('#st-wins'),
  stWpm: $('#st-wpm'),
  mrRanks: $('#mr-ranks'),
  mrSeries: $('#mr-series'),
  garage: $('#garage'),
  garageHint: $('#garage-hint'),
  achGrid: $('#ach-grid'),
  achCount: $('#ach-count'),
  pacer: $('#pacer'),
  lang: $('#lang'),
  mode: $('#mode'),
  btnSolo: $('#btn-solo'),
  resultsTable: $('#results-table'),
  soloResults: $('#solo-results'),
  btnResultsStay: $('#btn-results-stay'),
  btnResultsLeave: $('#btn-results-leave'),
  btnSoloAgain: $('#btn-solo-again'),
  btnSoloWorld: $('#btn-solo-world'),
  dailyCard: $('#daily-card'),
  btnShare: $('#btn-share'),
  btnShareProfile: $('#btn-share-profile'),
};

/* ------------------------------------------------------------- home setup */

for (const [code, name] of COUNTRIES) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name;   // the flag lives in #flag-preview beside the select
  el.country.appendChild(opt);
}
el.name.value = localStorage.getItem('td_name') || '';
el.country.value = localStorage.getItem('td_country') || detectCountry();
if (!el.country.value) el.country.value = 'UN';
el.flagPrev.textContent = flag(el.country.value);
el.country.addEventListener('change', () => { el.flagPrev.textContent = flag(el.country.value); });
el.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-quick').click(); });
el.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
el.code.addEventListener('input', () => { el.code.value = el.code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

const hashCode = location.hash.replace('#', '').trim().toUpperCase();
if (/^[A-Z0-9]{4,6}$/.test(hashCode)) {
  el.code.value = hashCode;
  el.code.classList.add('pulse');
  toast(`Room code ${hashCode} filled in — pick a name and hit Join`, 'info', 5000);
}

const soundLabel = (on) => `<svg class="i" aria-hidden="true"><use href="#i-${on ? 'volume' : 'volume-x'}"/></svg> Sound ${on ? 'on' : 'off'}`;
el.soundBtn.innerHTML = soundLabel(sound.enabled);
el.soundBtn.addEventListener('click', () => { el.soundBtn.innerHTML = soundLabel(sound.toggle()); });

/* ------------------------------------------------------- home: identity & module pages */

// Each section below the play card is its own page with its own screen; the home
// page stays clean. A tiny hash router (#/rankings, #/profile, …) shows them one
// at a time and keeps the URL deep-linkable.
const SECTION_PAGES = ['rankings', 'profile', 'garage', 'team', 'badges', 'how'];
const screenEl = (p) => document.getElementById(`screen-${p}`);

/* ----------------------------------------------------------------- flow
 * One journey: home -> a page or the race -> back. Every screen change says
 * which way it went, and the CSS moves the arriving screen accordingly
 * (deeper comes up from below, back settles down from above). The race
 * launch is the one orchestrated sequence; everything else is quiet. */
const DEPTH = { home: 0, rankings: 1, profile: 1, garage: 1, team: 1, badges: 1, how: 1, race: 2 };
let flowAt = 'home';
function flowTo(name) {
  const back = (DEPTH[name] ?? 1) < (DEPTH[flowAt] ?? 0);
  document.body.dataset.nav = back ? 'back' : 'forward';
  flowAt = name;
}
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Count a number up to its final value — only for the figure the player cares
 * about. While any number is counting, <html data-counting> is set, so anything
 * reading the page (a test, a screenshot run) can wait for the settled value.
 */
let counting = 0;
function countTo(node, value, format = (v) => String(v)) {
  const end = Number(value) || 0;
  if (reducedMotion.matches || end <= 0) { node.textContent = format(end); return; }
  const dur = 700;            // --dur-hero
  const t0 = performance.now();
  counting++;
  document.documentElement.dataset.counting = '1';
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 4);   // matches --ease-out-expo closely enough
    node.textContent = format(k < 1 ? Math.round(end * eased) : end);
    if (k < 1) { requestAnimationFrame(step); return; }
    if (--counting === 0) delete document.documentElement.dataset.counting;
  };
  node.textContent = format(0);
  requestAnimationFrame(step);
}
function pageFromHash() {
  const m = location.hash.match(/^#\/([a-zA-Z0-9-]+)\/?$/);
  if (!m) return 'home';
  const p = m[1].toLowerCase();
  return SECTION_PAGES.includes(p) ? p : 'home';
}
function switchPage(page) {
  flowTo(page);
  for (const p of SECTION_PAGES) screenEl(p).classList.toggle('active', p === page);
  el.home.classList.toggle('active', page === 'home');
  el.race.classList.toggle('active', false);
  document.body.classList.toggle('in-race', false);
  for (const a of document.querySelectorAll('#home-links .home-link')) a.classList.toggle('on', a.dataset.page === page);
  window.scrollTo(0, 0);
}
$('#level-pill').addEventListener('click', () => { if (el.home.classList.contains('active') || screenEl('profile').classList.contains('active')) { if (location.hash !== '#/profile') location.hash = '#/profile'; } });

// "Racing as Guest 🇬🇧 · English" — the form behind it only opens on request.
const btnOptions = $('#btn-options');
function renderIdentity() {
  const name = el.name.value.trim() || 'Guest';
  const lang = el.lang.selectedOptions[0] ? el.lang.selectedOptions[0].textContent : 'English';
  const mode = el.mode.selectedOptions[0] ? el.mode.selectedOptions[0].textContent : 'Prose';
  $('#identity-text').innerHTML = `Racing as <b>${escapeHtml(name)}</b> ${flag(el.country.value || 'UN')} · ${escapeHtml(lang)}${el.mode.value !== 'prose' ? ` · ${escapeHtml(mode)}` : ''}`;
}
// Progressive disclosure: both panels stay in the DOM and grow open, so nothing
// on the home page jumps when they appear. `openPanel` drives the CSS.
const optionsWrap = $('#options-wrap');
const isOpen = (wrap) => wrap.dataset.open === 'true';
function openPanel(wrap, open) {
  wrap.dataset.open = String(open);
  return open;
}
btnOptions.addEventListener('click', () => {
  const open = openPanel(optionsWrap, !isOpen(optionsWrap));
  btnOptions.setAttribute('aria-expanded', String(open));
  btnOptions.textContent = open ? 'Done' : 'Change';
  if (open) el.name.focus();
});

const friendsWrap = $('#friends-wrap');
const btnFriends = $('#btn-friends');
btnFriends.addEventListener('click', () => {
  const open = openPanel(friendsWrap, !isOpen(friendsWrap));
  btnFriends.setAttribute('aria-expanded', String(open));
  if (open) el.code.focus();
});
el.name.addEventListener('input', renderIdentity);
for (const sel of [el.country, el.lang, el.mode]) sel.addEventListener('change', renderIdentity);
renderIdentity();

// top-bar menu
const menu = $('#menu');
const menuBtn = $('#menu-btn');
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; menuBtn.setAttribute('aria-expanded', String(!menu.hidden)); });
document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });

/* ------------------------------------------------------- profile & garage */

function renderProfile() {
  const lvl = account.level;
  const [into, span, frac] = account.levelProgress;
  el.topLevel.textContent = lvl;
  el.topTitle.textContent = account.title;
  el.profLevel.textContent = lvl;
  el.profTitle.textContent = account.title;
  el.levelRing.style.setProperty('--p', frac.toFixed(3));
  el.xpFill.style.width = `${Math.round(frac * 100)}%`;
  el.xpText.textContent = `${into.toLocaleString()} / ${span.toLocaleString()} points to level ${lvl + 1}`;
  const st = account.stats;
  el.stPoints.textContent = (st.points || 0).toLocaleString();
  el.stRaces.textContent = st.races || 0;
  el.stWins.textContent = st.wins || 0;
  el.stWpm.textContent = st.bestWpm || 0;
  renderStreak();
  renderRankChips();
  renderRivals();
  renderGarage();
  renderAchievements();
}

function renderStreak() {
  const n = account.streak;
  const today = account.playedToday;
  el.streakBox.classList.toggle('on', n > 0);
  el.streakBox.classList.toggle('today', today);
  el.streakFlame.textContent = n >= 30 ? '🌋' : n >= 7 ? '🔥' : n > 0 ? '🔥' : '🕯️';
  el.streakDays.textContent = n > 0 ? `${n}-day streak` : 'No streak yet';
  const bonus = Math.round(Math.min(50, n * 5));
  el.streakSub.textContent = n === 0
    ? 'Race on any day to start one. Each day in a row adds +5% points, up to +50%.'
    : today
      ? `Today is banked ✓  ·  +${bonus}% on every point you earn  ·  best: ${plural(account.bestStreak, 'day')}`
      : `Race today to keep it alive  ·  +${bonus}% on every point you earn  ·  best: ${plural(account.bestStreak, 'day')}`;
  // last seven days: filled pips for the days the streak covers
  const pips = [];
  for (let i = 6; i >= 0; i--) {
    const covered = today ? i < n : i > 0 && i <= n;
    pips.push(`<i class="${covered ? 'on' : ''} ${i === 0 && today ? 'now' : ''}"></i>`);
  }
  el.streakWeek.innerHTML = pips.join('');
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const RANK_LABEL = {
  'points|all|global': 'World',
  'points|season|global': 'Season',
  'points|today|global': 'Today',
  'wpm|all|global': 'Speed',
  'streak|all|global': 'Streak',
};

function renderRankChips() {
  const badges = (account.stats.badges || []).slice(-6).map((b) => `<span class="rank-chip badge-chip ${b.rank <= 3 ? 'top' : ''}" title="Season ${b.number}: finished #${b.rank}">${medal(b.rank)} S${b.number}</span>`);
  const chips = account.standings.map((s) => {
    const key = `${s.category}|${s.window}|${s.scope}`;
    const label = RANK_LABEL[key] || (s.scope === 'global' ? s.category : s.scope === 'UN' ? 'Country' : `${flag(s.scope)} ${s.scope}`);
    if (!s.rank) return `<span class="rank-chip empty">${label} —</span>`;
    return `<span class="rank-chip ${s.rank <= 3 ? 'top' : ''}">${label} <b>#${s.rank}</b><small>/${s.of.toLocaleString()}</small></span>`;
  });
  el.rankChips.innerHTML = (chips.join('') || '<span class="rank-chip empty">Finish a race to get ranked</span>') + badges.join('');
}

/* ------------------------------------------------------------ season */

// One cached GET; the season line in the profile card and the "ends in" text.
let seasonInfo = null;
async function loadSeason() {
  try {
    const res = await fetch(`/api/season${account.id ? `?me=${encodeURIComponent(account.id)}` : ''}`);
    if (res.ok) seasonInfo = await res.json();
  } catch (_) { /* offline */ }
  renderSeason();
}
function renderSeason() {
  const box = $('#season-line');
  if (!box) return;
  if (!seasonInfo) { box.textContent = ''; return; }
  const days = Math.max(0, Math.ceil((seasonInfo.endsAt - Date.now()) / 86400000));
  const me = seasonInfo.me ? `you're #${seasonInfo.me.rank.toLocaleString()} of ${seasonInfo.me.of.toLocaleString()}` : 'race to get placed';
  const leader = seasonInfo.top[0] ? ` · leader ${escapeHtml(seasonInfo.top[0].name)} ${seasonInfo.top[0].points.toLocaleString()}` : '';
  box.innerHTML = `🏁 <b>Season ${seasonInfo.number}</b> · ${days} day${days === 1 ? '' : 's'} left · ${me}${leader}`;
}

function renderRivals() {
  const rivals = account.rivals;
  if (!rivals.length) {
    el.rivals.innerHTML = '<div class="board-empty small">No rivals yet. Send someone your room link and the head-to-head starts itself.</div>';
    return;
  }
  el.rivals.innerHTML = rivals.map((r) => `
    <div class="rival">
      <span class="b-flag">${flag(r.country)}</span>
      <span class="b-name">${escapeHtml(r.name)}</span>
      <span class="rival-score ${r.w > r.l ? 'up' : r.w < r.l ? 'down' : ''}"><b>${r.w}</b>–<b>${r.l}</b></span>
      <span class="rival-n">${r.n} race${r.n === 1 ? '' : 's'}</span>
    </div>`).join('');
}

function renderGarage() {
  const lvl = account.level;
  el.garage.innerHTML = SKINS.map((s) => {
    const locked = s.unlock > lvl;
    const sel = s.id === account.skin;
    return `<button class="skin ${locked ? 'locked' : ''} ${sel ? 'selected' : ''}" data-skin="${s.id}" title="${escapeHtml(s.blurb)}" ${locked ? 'aria-disabled="true"' : ''}>
      <div class="skin-car" style="--c:${sel ? 'var(--accent-2)' : '#8f86ff'}">${carSvg(s.id)}</div>
      <div class="skin-name">${escapeHtml(s.name)}</div>
      <div class="skin-sub">${locked ? `🔒 Lvl ${s.unlock}` : sel ? '✓ Riding' : 'Select'}</div>
    </button>`;
  }).join('');
  const chosen = SKINS.find((s) => s.id === account.skin) || SKINS[0];
  const next = SKINS.find((s) => s.unlock > lvl);
  el.garageHint.textContent = next
    ? `${chosen.name}: ${chosen.blurb}  ·  Next unlock: ${next.name} at level ${next.unlock}.`
    : `${chosen.name}: ${chosen.blurb}  ·  You've unlocked every car.`;
}

el.garage.addEventListener('click', (e) => {
  const btn = e.target.closest('.skin');
  if (!btn) return;
  const id = btn.dataset.skin;
  const skin = SKINS.find((s) => s.id === id);
  if (!skin) return;
  if (skin.unlock > account.level) {
    toast(`${skin.name} unlocks at level ${skin.unlock} — keep racing!`, 'warn', 2200);
    return;
  }
  if (account.setSkin(id)) {
    sound.ensure();
    sound.join();
    renderGarage();
    if (net.connected) identify(); // tell the lobby about the new ride
  }
});

function renderAchievements() {
  const have = new Set(account.achievements);
  const list = account.catalogue;
  if (!list.length) { el.achGrid.innerHTML = '<div class="board-empty small">Loading…</div>'; return; }
  el.achCount.textContent = `${have.size}/${list.length}`;
  el.achGrid.innerHTML = list.map((a) => `
    <div class="ach ${have.has(a.id) ? 'got' : ''}" title="${escapeHtml(a.desc)}">
      <span class="ach-icon">${a.icon}</span>
      <span class="ach-name">${escapeHtml(a.name)}</span>
    </div>`).join('');
}

const boards = new Boards(el.boards, { onRequest: (q) => net.send({ type: 'board', ...q }) });
boards.setCountry(el.country.value);
el.country.addEventListener('change', () => { boards.setCountry(el.country.value); if (net.connected) identify(); });

/* ------------------------------------------------------------- practice */

// Practice runs are computed entirely in this browser (see solo.js); they
// enter the app through the same onRoom / onFinished path as a server room.
const solo = new Solo({
  net,
  track,
  game,
  emit: (m) => (m.type === 'room' ? onRoom(m) : onFinished(m)),
  myId: () => S.myId || 'me',
  identity: () => ({
    name: el.name.value.trim() || 'Guest',
    country: el.country.value || 'UN',
    skin: account.skin,
    accountId: account.id,
    bestWpm: Math.max(account.stats.solo?.bestWpm || 0, account.stats.bestWpm || 0),
  }),
});
for (const p of PACERS) {
  const opt = document.createElement('option');
  opt.value = p.id;
  opt.textContent = p.label;
  el.pacer.appendChild(opt);
}
el.pacer.value = localStorage.getItem('td_pacer') || 'medium';
if (!el.pacer.value) el.pacer.value = 'medium';
el.pacer.addEventListener('change', () => localStorage.setItem('td_pacer', el.pacer.value));

// language + mode selectors are filled from the passage catalogue
solo.ready.then(() => {
  const fill = (sel, map, saved, fallback) => {
    sel.innerHTML = '';
    for (const [id, v] of Object.entries(map || {})) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = v.native || v.name || id;
      sel.appendChild(opt);
    }
    sel.value = saved && map && map[saved] ? saved : fallback;
  };
  fill(el.lang, solo.langs, localStorage.getItem('td_lang'), detectLang(solo.langs));
  fill(el.mode, solo.categories, localStorage.getItem('td_mode'), 'prose');
  renderIdentity();
});
el.lang.addEventListener('change', () => localStorage.setItem('td_lang', el.lang.value));
el.mode.addEventListener('change', () => localStorage.setItem('td_mode', el.mode.value));

// step-by-step options wizard: pick a Language -> only its Modes appear -> then the Pacers
const wizEl = { lang: $('#wiz-lang-opts'), mode: $('#wiz-mode-opts'), pacer: $('#wiz-pacer-opts') };
const wizStart = $('#wiz-start');
const wizSteps = [$('#wiz-lang'), $('#wiz-mode'), $('#wiz-pacer')];

const modeIdsForLang = (lang) => {
  const out = [], seen = new Set();
  for (const p of solo.catalogue || []) {
    if (p.lang === lang && !seen.has(p.category)) { seen.add(p.category); out.push(p.category); }
  }
  return out.length ? out : ['prose'];
};

const buildWizOptions = (row, items, selected, onPick) => {
  row.innerHTML = '';
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wiz-opt' + (value === selected ? ' on' : '');
    b.value = value;
    b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    row.appendChild(b);
  }
};

const revealStep = (step, show) => {
  if (show === !step.hidden) return;
  step.hidden = !show;
  if (show) { step.classList.remove('enter'); void step.offsetWidth; step.classList.add('enter'); }
};

const syncWizard = () => {
  const lang = el.lang.value || 'en';
  const mode = el.mode.value || 'prose';
  const pacer = el.pacer.value || 'medium';
  buildWizOptions(wizEl.lang, Object.entries(solo.langs).map(([id, v]) => [id, v.native || v.name || id]), lang,
    (id) => { el.lang.value = id; el.lang.dispatchEvent(new Event('change')); syncWizard(); });
  buildWizOptions(wizEl.mode, modeIdsForLang(lang).map((id) => [id, (solo.categories[id] || { name: id }).name]), mode,
    (id) => { el.mode.value = id; el.mode.dispatchEvent(new Event('change')); syncWizard(); });
  buildWizOptions(wizEl.pacer, PACERS.map((p) => [p.id, p.label]), pacer,
    (id) => { el.pacer.value = id; el.pacer.dispatchEvent(new Event('change')); syncWizard(); });
  revealStep(wizSteps[0], true);
  revealStep(wizSteps[1], !!lang);
  revealStep(wizSteps[2], !!mode);
  wizStart.hidden = !pacer;
};

el.lang.addEventListener('change', syncWizard);
el.mode.addEventListener('change', syncWizard);
el.pacer.addEventListener('change', syncWizard);
solo.ready.then(() => syncWizard());

wizStart.addEventListener('click', () => {
  openPanel(optionsWrap, false);
  btnOptions.setAttribute('aria-expanded', 'false');
  btnOptions.textContent = 'Change';
  startPractice();
});

/* ------------------------------------------------- first run: infer, don't ask */

// A newcomer came here to type, so nothing stands between the page and the first
// race: the browser's own language picks the passage language, the country comes
// from the time zone, and the name is asked for once a run is worth ranking (see
// the prompt in the results card).
function detectLang(langs) {
  const want = (navigator.languages || [navigator.language || 'en']).map((l) => String(l).slice(0, 2).toLowerCase());
  for (const code of want) if (langs && langs[code]) return code;
  return 'en';
}

function startPractice(opts = {}) {
  sound.ensure();
  localStorage.setItem('td_name', el.name.value.trim() || 'Guest');
  if (net.connected) identify();
  solo.start({ pacer: el.pacer.value, ...passageOpts(), ...opts });
}
el.btnSolo.addEventListener('click', () => startPractice());
el.btnSoloAgain.addEventListener('click', () => { el.results.hidden = true; solo.again(); });
el.btnSoloWorld.addEventListener('click', () => { leaveRoom(); whenConnected(() => net.send({ type: 'quick' })); });

// /#practice, /#practice/<passage-id> (the /practice pages link here) and
// /#practice/<passage-id>/ghost/<wr|accountId> ("beat my ghost" share links): start typing straight away
function practiceFromHash() {
  const m = location.hash.match(/^#practice(?:\/([a-z0-9-]+))?(?:\/ghost\/([A-Za-z0-9_-]+))?$/i);
  if (!m) return false;
  const opts = { passageId: m[1] ? m[1].toLowerCase() : null };
  if (m[2]) opts.pacer = m[2].toLowerCase() === 'wr' ? 'wr' : { ghostOf: m[2] };
  solo.ready.then(() => startPractice(opts));
  return true;
}

/* ------------------------------------------------------------------ share */

const share = new ShareDialog($('#share-dialog'), net);
el.btnShare.addEventListener('click', () => { if (S.lastResultId) share.open(S.lastResultId); });
el.btnShareProfile.addEventListener('click', () => share.openProfile(account.id));

/* ---------------------------------------------------------- reminders */

const push = new PushReminders(net, { button: $('#btn-remind'), onState: () => renderProfile() });

/* ------------------------------------------------------------------ teams */

const teamCard = new TeamCard($('#team-card'), net, {
  onChanged: (m) => { if (m.profile) { account.setProfile(m.profile, null); renderProfile(); } boards.request(); },
});
const teamHash = location.hash.match(/^#team\/([A-Za-z0-9]{4,8})$/i);
if (teamHash) {
  history.replaceState(null, '', location.pathname);
  toast('Joining the team from your invite link…', 'info', 2500);
  teamCard.join(teamHash[1].toUpperCase());
}

/* --------------------------------------------------------- daily challenge */

// Today's passage for everyone; played as a practice run with today's golden
// words and the current leader as the pacer. The server scores one attempt.
const dailyCard = new DailyCard(el.dailyCard, {
  meId: () => account.id,
  onPlay: (d) => {
    const leader = d.top[0] || null;
    startPractice({
      passage: d.passage,
      bonusWords: d.bonusWords,
      mode: 'daily',
      dailyNumber: d.number,
      pacer: d.leaderGhost ? { ghost: d.leaderGhost, kind: 'leader' } : leader ? leader.wpm : 'medium',
      pacerName: leader ? `${leader.name} · leader` : null,
    });
  },
});
dailyCard.load();

function dailyFromHash() {
  if (!/^#daily$/i.test(location.hash)) return false;
  dailyCard.load().then((d) => { if (d) dailyCard.onPlay(d); });
  return true;
}

/* --------------------------------------------- sections router (the one router) */

function navigate() {
  if (S.room && !S.room.solo) return;   // live race: don't bounce screens
  switchPage(pageFromHash());
  if (!S.room || S.room.solo) practiceFromHash() || dailyFromHash();
}
window.addEventListener('hashchange', navigate);
navigate();

renderProfile();

/* ---------------------------------------------------------------- actions */

function identify() {
  const name = el.name.value.trim() || 'Guest';
  const country = el.country.value || 'UN';
  localStorage.setItem('td_name', name);
  localStorage.setItem('td_country', country);
  net.send({ type: 'hello', name, country, skin: account.skin, ...account.credentials });
}

function whenConnected(action) {
  sound.ensure();
  if (net.connected) { identify(); action(); return; }
  S.pending = () => { identify(); action(); };
  toast('Connecting to the race server…', 'info', 1500);
}

/** Language + mode the player picked (persisted); sent with every room request and practice run. */
const passageOpts = () => ({ lang: el.lang.value || 'en', category: el.mode.value || 'prose' });
$('#btn-quick').addEventListener('click', () => whenConnected(() => net.send({ type: 'quick', ...passageOpts() })));
$('#btn-create').addEventListener('click', () => whenConnected(() => net.send({ type: 'create', ...passageOpts() })));
$('#btn-join').addEventListener('click', () => {
  const code = el.code.value.trim().toUpperCase();
  if (code.length < 4) return toast('Enter the 5-letter room code', 'warn');
  whenConnected(() => net.send({ type: 'join', code }));
});
$('#btn-start').addEventListener('click', () => net.send({ type: 'start', bots: el.botsCheck.checked }));
$('#btn-leave').addEventListener('click', leaveRoom);
$('#btn-results-leave').addEventListener('click', leaveRoom);
$('#btn-results-stay').addEventListener('click', () => { el.results.hidden = true; });

el.roomCode.addEventListener('click', async () => {
  if (!S.room) return;
  const link = `${location.origin}/app#${S.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied to clipboard', 'success');
  } catch (_) {
    toast(link, 'info', 6000);
  }
});

// chat
el.chatToggle.addEventListener('click', () => {
  el.chat.hidden = !el.chat.hidden;
  if (!el.chat.hidden) {
    S.unreadChat = 0;
    el.chatToggle.classList.remove('unread');
    el.chatToggle.dataset.count = '';
    el.chatInput.focus();
  }
});
$('#chat-close').addEventListener('click', () => { el.chat.hidden = true; refocusTyping(); });
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text) return;
  net.send({ type: 'chat', text });
  el.chatInput.value = '';
});

// emotes: mousedown + preventDefault so the typing input never loses focus mid-race
el.emoteBar.addEventListener('mousedown', (e) => {
  const btn = e.target.closest('button[data-e]');
  if (!btn) return;
  e.preventDefault();
  net.send({ type: 'emote', e: btn.dataset.e });
  btn.classList.remove('sent');
  void btn.offsetWidth;
  btn.classList.add('sent');
});
el.emoteBar.addEventListener('touchstart', (e) => {
  const btn = e.target.closest('button[data-e]');
  if (!btn) return;
  e.preventDefault();
  net.send({ type: 'emote', e: btn.dataset.e });
}, { passive: false });

function renderEmoteBar(list) {
  if (S.emotesRendered || !list || !list.length) return;
  S.emotesRendered = true;
  el.emoteBar.innerHTML = list.map((e) => `<button type="button" data-e="${e}" title="React">${e}</button>`).join('');
}

function leaveRoom() {
  if (S.room && S.room.solo) solo.abort();
  else net.send({ type: 'leave' });
  goHome();
}

function goHome() {
  S.room = null;
  S.passage = '';
  S.myFinish = null;
  S.players.clear();
  S.interp.clear();
  resetLocal();
  track.setPlayers([], myId());
  typing.setPassage('');
  typing.setEnabled(false);
  el.results.hidden = true;
  el.countdown.hidden = true;
  el.finishBanner.hidden = true;
  el.focusOverlay.hidden = true;
  el.chat.hidden = true;
  el.chatLog.innerHTML = '';
  el.trackWrap.classList.remove('nitro');
  renderProfile();
  boards.request();
  switchScreen('home');
  if (location.hash) history.replaceState(null, '', location.pathname);
}

function switchScreen(name) {
  flowTo(name);
  el.home.classList.toggle('active', name === 'home');
  el.race.classList.toggle('active', name === 'race');
  for (const p of SECTION_PAGES) screenEl(p).classList.toggle('active', false);
  document.body.classList.toggle('in-race', name === 'race');   // the starfield only comes forward on the track
  if (name === 'race') requestAnimationFrame(() => track.measure());
}

function resetLocal() {
  S.local = { correct: 0, typed: 0, keystrokes: 0, errors: 0, done: false, vis: 0 };
  S.myFinish = null;
  S.nitroShown = false;
  S.lastScoreShown = -1;
  S.lastComboShown = -1;
  game.reset();
  el.hudWpm.textContent = '0';
  el.hudAcc.textContent = '100%';
  el.hudCombo.textContent = '0';
  el.hudMult.textContent = '';
  el.hudScore.textContent = '0';
  el.nitroFill.style.width = '0%';
  el.nitroStat.classList.remove('active', 'ready');
  el.nitroLabel.textContent = 'Nitro';
  el.comboStat.className = 'stat combo-stat';
  el.trackWrap.classList.remove('nitro');
  el.callouts.innerHTML = '';
}

function clearInterp() {
  for (const it of S.interp.values()) it.reset();
}

/* ------------------------------------------------------------ networking */

net.on('open', () => {
  el.connBanner.hidden = true;
  clock.start(2000);
  if (S.pending) {
    const p = S.pending;
    S.pending = null;
    p();
  } else if (S.hadSession) {
    S.hadSession = false;
    goHome();
    toast('Connection was lost, so you left the room. Jump back in!', 'warn', 4500);
  }
});

net.on('close', ({ wasConnected }) => {
  if (wasConnected) el.connBanner.hidden = false;
  clock.stop();
  if (S.room && !S.room.solo) S.hadSession = true; // a practice run does not need the socket
});

net.on('welcome', (m) => {
  S.myId = m.id;
  clock.seed(m.serverTime);
  el.online.textContent = m.online;
  account.catalogue = m.achievements || [];
  boards.setMeta(m.boards);
  renderAchievements();
  identify();          // resume the saved account as soon as we're connected
  boards.request();
});

net.on('account', (m) => {
  account.onAccount(m);
  boards.setMyId(account.id);
  renderProfile();
  boards.request();
  dailyCard.load();   // now we know who "me" is
  loadSeason();
  push.setFromProfile(account.stats);
  el.btnShareProfile.hidden = !account.id;
  if (!m.created && account.streak > 0 && !account.playedToday) {
    toast(`🔥 ${account.streak}-day streak — one race today keeps it alive`, 'info', 4200);
  }
});

net.on('board', (m) => boards.setData(m));
net.on('race_result', onRaceResult);

net.on('online', (m) => { el.online.textContent = m.n; });
net.on('error', (m) => toast(m.message || 'Something went wrong', 'error'));
net.on('left', () => { if (S.room) goHome(); });
net.on('player_left', (m) => { if (S.room) toast(`${m.name} left the room`, 'info', 2000); });
net.on('room', onRoom);
net.on('snap', onSnap);
net.on('finished', onFinished);
net.on('chat', onChat);
net.on('emote', (m) => {
  if (!S.room) return;
  track.emote(m.id, m.e);
  sound.emote();
});
net.on('rev', (m) => { if (S.room) track.rev(m.id); });

clock.onUpdate = (c) => {
  el.ping.textContent = Math.round(c.rtt);
  el.pingPill.dataset.q = c.rtt < 90 ? 'good' : c.rtt < 200 ? 'ok' : 'bad';
};

net.connect();

/* ------------------------------------------------------------- room state */

function onRoom(m) {
  const prev = S.room;
  S.room = m;
  renderEmoteBar(m.emotes);

  const ids = new Set();
  for (const p of m.players) {
    ids.add(p.id);
    if (!S.players.has(p.id) && prev && !p.isBot && p.id !== myId() && prev.state === 'waiting') {
      toast(`${flag(p.country)} ${p.name} joined`, 'info', 1800);
      sound.join();
    }
    S.players.set(p.id, p);
    if (!S.interp.has(p.id)) S.interp.set(p.id, new Interpolator());
  }
  for (const id of [...S.players.keys()]) {
    if (!ids.has(id)) { S.players.delete(id); S.interp.delete(id); }
  }
  track.setPlayers(m.players, myId());

  if (!el.race.classList.contains('active')) switchScreen('race');

  const changed = !prev || prev.state !== m.state || prev.raceNo !== m.raceNo || prev.code !== m.code;
  if (changed) enterState(m);
  refreshStateUI(m);
}

function enterState(m) {
  const st = m.state;
  S.passage = m.passage || '';
  if (st === 'countdown') S.lastResultId = null;
  el.results.hidden = true;
  el.finishBanner.hidden = true;
  el.countdown.hidden = true;
  el.countdown.classList.remove('go');
  el.focusOverlay.hidden = true;
  S.goUntil = 0;

  if (st === 'waiting') {
    resetLocal();
    typing.setPassage('');
    typing.setEnabled(false);
    track.reset();
    clearInterp();
  } else if (st === 'countdown') {
    resetLocal();
    typing.setPassage(S.passage, m.bonusWords || []);
    game.start(m.bonusWords || []);
    typing.setEnabled(false);
    track.reset();
    clearInterp();
    // phones: get the keyboard up now, inside a tap, so it is there at GO
    if (IS_TOUCH && document.activeElement !== typing.input) showFocusOverlay('👆 Tap here so your keyboard is ready');
    el.countdown.hidden = false;
    S.lastCd = null;
    el.cdSub.textContent = (m.bonusWords || []).length
      ? `Get ready to type… ${m.bonusWords.length} words in here are worth extra`
      : 'Fingers on the keys…';
  } else if (st === 'racing') {
    if (typing.text !== S.passage) { // joined/reconnected straight into a race
      resetLocal();
      typing.setPassage(S.passage, m.bonusWords || []);
      game.start(m.bonusWords || []);
      track.reset();
      clearInterp();
    }
    typing.setEnabled(true);
    typing.focus();
    showGo();
    sound.go();
  } else if (st === 'finished') {
    typing.setEnabled(false);
    setNitroVisual(false);
    showResults(m);
  }
}

function refreshStateUI(m) {
  el.race.classList.toggle('solo', !!m.solo);
  el.roomCode.textContent = m.code;
  el.roomCode.disabled = !!m.solo;
  el.roomType.textContent = m.solo ? (m.mode === 'daily' ? 'Daily' : 'Practice') : m.isPrivate ? (m.ranked ? 'Private' : 'Friendly') : 'Ranked';
  el.roomType.className = `badge ${m.solo ? 'solo' : m.isPrivate ? 'private' : 'public'}`;
  el.roomType.title = m.solo
    ? 'You are typing on your own. It counts for your days in a row, but not for points.'
    : m.ranked
      ? 'A race against other people. Points from this one count.'
      : 'A private game with friends. No points, but it counts for your days in a row and your record against them.';
  el.seats.textContent = `${m.players.length}/${m.maxPlayers}`;
  el.seats.hidden = !!m.solo;
  renderSeries(m);
  el.hostBar.hidden = !(m.isPrivate && m.state === 'waiting' && m.hostId === myId());
  if (m.solo) {
    const what = m.passageTitle ? `“${m.passageTitle}”` : 'Practice run';
    if (m.state === 'racing') el.status.textContent = m.pacerWpm ? `${what} — try to beat the robot at ${m.pacerWpm} words a minute` : `${what} — go!`;
    if (m.state === 'countdown') el.status.textContent = `${what} — get ready`;
    if (m.state === 'finished') el.status.textContent = `${what} — finished`;
    return;
  }
  if (m.state === 'racing') el.status.textContent = `Race #${m.raceNo} — type!`;
  if (m.state === 'countdown') el.status.textContent = `Race #${m.raceNo} starts in a moment`;
}

function showGo() {
  el.countdown.hidden = false;
  el.countdown.classList.add('go');
  document.body.classList.add('is-go');     // one light sweep across the passage as it unlocks
  setTimeout(() => document.body.classList.remove('is-go'), 700);
  el.cdNum.textContent = 'GO!';
  el.cdSub.textContent = '';
  restartAnim(el.cdNum);
  S.goUntil = performance.now() + GO_FLASH_MS;
}

function restartAnim(node) {
  node.classList.remove('pop');
  void node.offsetWidth; // reflow so the animation restarts
  node.classList.add('pop');
}

/* ------------------------------------------------------------- snapshots */

function onSnap(m) {
  if (!S.room) return;
  const len = S.passage.length || 1;
  for (const p of m.p) {
    if (p.id === myId()) {
      if (p.r != null) track.updateMeta(p.id, { rank: p.r, finished: p.f });
      continue; // local racer is predicted client-side
    }
    const it = S.interp.get(p.id);
    if (it) it.push(m.t, p.c / len);
    track.updateMeta(p.id, { wpm: p.w, pct: p.c / len, rank: p.r, finished: p.f, nitro: !!p.n && !p.f });
  }
}

function onFinished(m) {
  const p = S.players.get(m.id);
  if (!p) return;
  track.updateMeta(m.id, { rank: m.rank, finished: true, wpm: m.wpm, nitro: false });
  if (m.id === myId()) {
    S.myFinish = m;
    S.local.done = true;
    typing.setEnabled(false);
    setNitroVisual(false);
    const bonus = game.finish(m.rank, m.accuracy, S.local.errors);
    scheduleSend(true); // final score (with finish bonus) to the server
    el.finishBanner.innerHTML = `<span class="big">${medal(m.rank)}</span>
      <div><b>You finished ${m.rank === 1 ? 'first!' : `#${m.rank}`}</b>
      <span>${m.wpm} WPM · ${m.accuracy}% accuracy · ${fmtTime(m.time)}</span>
      <span class="bonus">+${bonus.place} place bonus${bonus.clean ? ` · +${bonus.clean} clean bonus` : ''}</span></div>`;
    el.finishBanner.hidden = false;
    if (m.rank === 1) { confetti.burst(160); sound.win(); } else sound.finish();
  } else {
    toast(`${flag(p.country)} ${p.name} finished ${medal(m.rank)} · ${m.wpm} words a minute`, 'info', 2600);
  }
}

function onChat(m) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<span class="who" style="color:${escapeHtml(m.from.color)}">${flag(m.from.country)} ${escapeHtml(m.from.name)}</span> ${escapeHtml(m.text)}`;
  el.chatLog.appendChild(div);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (el.chat.hidden && m.from.id !== myId()) {
    S.unreadChat++;
    el.chatToggle.classList.add('unread');
    el.chatToggle.dataset.count = S.unreadChat > 9 ? '9+' : String(S.unreadChat);
  }
}

/* --------------------------------------------------------- game feedback */

function callout(text, cls = '', ms = 1100) {
  const node = document.createElement('div');
  node.className = `callout ${cls}`;
  node.textContent = text;
  el.callouts.appendChild(node);
  // keep at most three on screen
  while (el.callouts.children.length > 3) el.callouts.firstChild.remove();
  setTimeout(() => node.remove(), ms);
}

function setNitroVisual(on) {
  if (S.nitroShown === on) return;
  S.nitroShown = on;
  track.setNitro(myId(), on);
  el.trackWrap.classList.toggle('nitro', on);
  el.nitroStat.classList.toggle('active', on);
  document.body.classList.toggle('nitro-shake', on);
}

function handleGameEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'combo':
        callout(ev.label, `combo t${ev.tier}`);
        track.pop(myId(), ev.label.split(' ')[0], 'combo');
        sound.combo(ev.tier);
        el.comboStat.className = `stat combo-stat t${ev.tier}`;
        break;
      case 'combo_break':
        callout(`run broken at ${ev.combo}`, 'break', 800);
        sound.comboBreak();
        el.comboStat.className = 'stat combo-stat';
        break;
      case 'word':
        break;
      case 'golden':
        callout('+250 bonus word', 'golden', 1300);
        track.pop(myId(), '+250', 'golden');
        confetti.burst(40);
        sound.golden();
        break;
      case 'golden_miss':
        callout('bonus word missed', 'miss', 900);
        break;
      case 'nitro':
        callout('Boost!', 'nitro', 1200);
        track.pop(myId(), 'BOOST', 'nitro');
        sound.nitro();
        setNitroVisual(true);
        scheduleSend(true); // let the lobby see the flames immediately
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------- typing */

typing.onChange = (r) => {
  Object.assign(S.local, { correct: r.correct, typed: r.typed, keystrokes: r.keystrokes, errors: r.errors, done: r.done });
  if (r.added) { if (r.ok) sound.key(); else sound.error(); }
  if (r.added && !r.ok) el.passageWrap.classList.remove('shake'), void el.passageWrap.offsetWidth, el.passageWrap.classList.add('shake');
  if (S.room?.state === 'racing') handleGameEvents(game.onKey(r));
  if (S.room?.solo) { solo.onProgress(r); return; } // practice never streams progress
  scheduleSend(r.done);
};

function showFocusOverlay(text) {
  el.focusOverlay.textContent = text;
  el.focusOverlay.hidden = false;
}

typing.onBlur = () => {
  setTimeout(() => {
    if (document.activeElement === el.chatInput || !S.room) return;
    if (S.room.state === 'racing' && !S.local.done) showFocusOverlay(IS_TOUCH ? '👆 Tap here to keep typing' : 'Click here to refocus and keep typing');
    else if (S.room.state === 'countdown' && IS_TOUCH) showFocusOverlay('👆 Tap here so your keyboard is ready');
  }, 0);
};
typing.onFocus = () => {
  el.focusOverlay.hidden = true;
  // keep the passage in view above the on-screen keyboard
  if (IS_TOUCH) setTimeout(() => el.passageWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
};
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (IS_TOUCH && S.room?.state === 'racing' && document.activeElement === typing.input) el.passageWrap.scrollIntoView({ block: 'start' });
  });
}

el.passageWrap.addEventListener('click', refocusTyping);
document.addEventListener('keydown', (e) => {
  if (document.activeElement === el.chatInput) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const st = S.room?.state;
  if (st === 'waiting' || st === 'countdown') {
    if (e.key.length === 1) rev();
    return;
  }
  if (st !== 'racing' || S.local.done) return;
  if (document.activeElement !== typing.input && e.key.length === 1) typing.focus();
});

/* Pre-race engine revving: instant locally, throttled on the wire. */
function rev() {
  track.rev(myId());
  sound.rev();
  const now = performance.now();
  if (now - S.lastRevAt < 320 || S.room?.solo) return;
  S.lastRevAt = now;
  net.send({ type: 'rev' });
}
el.trackWrap.addEventListener('click', () => {
  const st = S.room?.state;
  if (st === 'waiting' || st === 'countdown') rev();
});

function refocusTyping() {
  if (!S.room) return;
  if (S.room.state === 'racing' && !S.local.done) typing.focus();
  else if (S.room.state === 'countdown') typing.focus(true);   // keyboard readiness on phones
}

function scheduleSend(force) {
  if (S.room && S.room.solo) return; // practice: one result at the end, nothing in between
  const now = performance.now();
  const doSend = () => {
    S.lastSendAt = performance.now();
    S.sendTimer = null;
    net.send({
      type: 'progress',
      c: S.local.correct, t: S.local.typed, k: S.local.keystrokes, e: S.local.errors,
      n: game.nitro ? 1 : 0, s: game.score, x: game.bestCombo, g: game.golden, z: game.nitros,
    });
  };
  if (force || now - S.lastSendAt >= SEND_INTERVAL_MS) {
    if (S.sendTimer) { clearTimeout(S.sendTimer); S.sendTimer = null; }
    doSend();
  } else if (!S.sendTimer) {
    S.sendTimer = setTimeout(doSend, SEND_INTERVAL_MS - (now - S.lastSendAt));
  }
}

/* --------------------------------------------------------------- results */

function showResults(m) {
  const isSolo = !!m.solo;
  el.results.classList.toggle('solo', isSolo);
  el.podium.hidden = isSolo;
  el.resultsTable.hidden = isSolo;
  el.soloResults.hidden = !isSolo;
  el.btnResultsStay.hidden = isSolo;
  el.btnSoloAgain.hidden = !isSolo;
  el.btnSoloWorld.hidden = !isSolo;
  el.btnResultsLeave.textContent = isSolo ? 'Back home' : 'Leave this game';
  el.nextRace.hidden = isSolo;
  el.btnShare.hidden = !S.lastResultId;
  if (isSolo) {
    el.resultsTitle.textContent = solo.title();
    el.myRace.hidden = false;
    showMyRace();
    el.mrXp.textContent = 'Saving…';
    el.mrXp.classList.add('unranked');
    el.mrLevel.textContent = `Level ${account.level} · ${account.title}`;
    el.mrXpText.textContent = '';
    el.mrRanks.innerHTML = '';
    el.mrUnlocks.innerHTML = '';
    el.mrSeries.hidden = true;
    solo.renderResults();
    openResults();
    return;
  }

  const results = m.results || [];
  const mine = results.find((r) => r.id === myId());
  const iWon = mine && mine.rank === 1;

  el.resultsTitle.textContent = iWon ? '🏆 You won the race!' : mine ? `You placed ${medal(mine.rank)}` : 'Race results';

  const top = [results[1], results[0], results[2]]; // podium order: 2nd, 1st, 3rd
  el.podium.innerHTML = top.map((r, i) => {
    if (!r) return '<div class="podium-slot empty"></div>';
    const place = i === 1 ? 1 : i === 0 ? 2 : 3;
    return `<div class="podium-slot p${place} ${r.id === myId() ? 'me' : ''}" style="--c:${escapeHtml(r.color)}">
      <div class="podium-car">${carSvg(r.skin)}</div>
      <div class="podium-name">${flag(r.country)} ${escapeHtml(r.name)}</div>
      <div class="podium-wpm">${r.wpm}<small>WPM</small></div>
      <div class="podium-block"><span>${medal(place)}</span></div>
    </div>`;
  }).join('');

  el.resultsBody.innerHTML = results.map((r) => `
    <tr class="${r.id === myId() ? 'me' : ''}" style="--c:${escapeHtml(r.color)}">
      <td>${medal(r.rank)}</td>
      <td><span class="swatch"></span>${flag(r.country)} ${escapeHtml(r.name)}${r.isBot ? ' <span class="tag bot">BOT</span>' : ''}</td>
      <td class="num">${r.wpm}</td>
      <td class="num">${r.accuracy}%</td>
      <td class="num score">${(r.id === myId() ? game.score : r.score || 0).toLocaleString()}</td>
      <td class="num">${r.finished ? fmtTime(r.time) : `${Math.round(r.progress * 100)}%`}</td>
    </tr>`).join('');

  el.myRace.hidden = !mine;
  if (mine) showMyRace();
  renderSeries(m);

  openResults();
  if (iWon && !S.myFinish) { confetti.burst(160); sound.win(); }
}

/**
 * Open the results card. The card reveals in one sequence (CSS reads data-seq),
 * the headline number counts up, and a still-nameless racer is asked for a name
 * here — the first moment it buys them something.
 */
function openResults() {
  const card = el.results.querySelector('.modal-card');
  el.results.hidden = false;
  card.removeAttribute('data-seq');
  void card.offsetWidth;                    // restart the stagger on every open
  card.setAttribute('data-seq', 'in');
  if (!el.soloResults.hidden) countTo($('#sr-wpm'), $('#sr-wpm').textContent);
  if (!el.myRace.hidden) countTo(el.mrScore, el.mrScore.textContent.replace(/,/g, ''), (v) => v.toLocaleString());
  const named = (localStorage.getItem('td_name') || '').trim();
  namePrompt.hidden = !!named && named !== 'Guest';
}

const namePrompt = $('#name-prompt');
namePrompt.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#np-name').value.trim();
  if (!name) return;
  el.name.value = name;
  el.name.dispatchEvent(new Event('input'));
  localStorage.setItem('td_name', name);
  if (net.connected) identify();
  namePrompt.hidden = true;
  toast(`Racing as ${escapeHtml(name)} from now on.`, 'success', 2600);
});

/** The per-race numbers the client itself produced (score, combo, nitro). */
function showMyRace() {
  el.mrScore.textContent = game.score.toLocaleString();
  el.mrCombo.textContent = game.bestCombo;
  el.mrNitro.textContent = game.nitros;
  el.mrGolden.textContent = `${game.golden}/${game.goldenTotal}`;
}

function renderSeries(m) {
  const rows = (m.series || []).filter((r) => r.wins > 0 || (m.series || []).length > 1);
  const show = m.isPrivate && rows.length > 1;
  el.mrSeries.hidden = !show;
  el.series.hidden = !show;
  if (!show) return;
  const line = rows.map((r) => `${escapeHtml(r.name)} ${r.wins}`).join('  ·  ');
  el.series.textContent = `Series: ${line}`;
  el.mrSeries.innerHTML = `<span class="mr-series-label">Room series</span>` + rows.map((r) => `
    <span class="series-pill ${r.id === myId() ? 'me' : ''}" style="--c:${escapeHtml(r.color)}">
      ${flag(r.country)} ${escapeHtml(r.name)} <b>${r.wins}</b>
    </span>`).join('');
}

/**
 * The server settled the race: ranked points, streak, world ranks and any
 * achievements. This is the authoritative half of the results screen.
 */
function onRaceResult(msg) {
  const out = account.applyResult(msg);
  S.lastResultId = msg.resultId || null;
  el.btnShare.hidden = !S.lastResultId;
  boards.setMyId(account.id);
  renderProfile();
  boards.request();

  const lvl = account.level;
  el.mrXp.textContent = out.ranked
    ? `+${out.points.toLocaleString()} points`
    : msg.solo ? 'No points for typing on your own — race other people to collect them' : 'No points in a private game';
  el.mrXp.classList.toggle('unranked', !out.ranked);
  if (msg.solo) solo.onResult(msg);
  if (msg.daily) dailyCard.load();
  if (msg.ranked) loadSeason();
  if (msg.ghost && msg.ghost.wr && !msg.solo) setTimeout(() => toast('🌍 New world record on this passage — your ghost now guards it', 'success', 3600), 700);
  el.mrLevel.textContent = `Level ${lvl} · ${account.title}`;

  const lo = pointsForLevel(lvl);
  const hi = pointsForLevel(lvl + 1);
  const startPts = Math.max(lo, account.points - out.points);
  const startFrac = out.leveledUp ? 0 : (startPts - lo) / (hi - lo);
  const endFrac = (account.points - lo) / (hi - lo);
  el.mrXpFill.style.transition = 'none';
  el.mrXpFill.style.width = `${Math.round(startFrac * 100)}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.mrXpFill.style.transition = 'width 1.1s cubic-bezier(.2,.9,.2,1)';
    el.mrXpFill.style.width = `${Math.round(endFrac * 100)}%`;
  }));
  el.mrXpText.textContent = `${(account.points - lo).toLocaleString()} / ${(hi - lo).toLocaleString()} points to level ${lvl + 1}`;

  // where that leaves you in the world
  el.mrRanks.innerHTML = account.standings.filter((st) => st.rank).map((st) => {
    const key = `${st.category}|${st.window}|${st.scope}`;
    const label = RANK_LABEL[key] || (st.scope === 'global' ? st.category : st.scope === 'UN' ? 'Country' : `${flag(st.scope)} ${st.scope}`);
    return `<span class="rank-chip ${st.rank <= 3 ? 'top' : ''}">${label} <b>#${st.rank}</b><small>/${st.of.toLocaleString()}</small></span>`;
  }).join('');

  // streak + unlock chips
  const chips = [];
  if (out.streakEvent === 'extended') chips.push(`<span class="chip streak-chip">🔥 ${out.streak}-day streak</span>`);
  if (out.streakEvent === 'started') chips.push('<span class="chip streak-chip">🔥 Streak started</span>');
  if (out.streakEvent === 'reset') chips.push('<span class="chip streak-chip dim">🕯️ Streak restarted</span>');
  for (const a of out.unlocked) chips.push(`<span class="chip ach-chip" title="${escapeHtml(a.desc)}">${a.icon} ${escapeHtml(a.name)}</span>`);
  for (const sk of out.newSkins) chips.push(`<span class="chip skin-chip">🚗 ${escapeHtml(sk.name)} unlocked</span>`);
  el.mrUnlocks.innerHTML = chips.join('');

  // the streak and achievement chips are on the results screen itself; a sound is enough here
  if (out.unlocked.length) setTimeout(() => sound.achievement(), 400);
  if (out.leveledUp) setTimeout(() => showLevelUp(out), 900);
}

function showLevelUp(out) {
  el.levelupNum.textContent = out.levelAfter;
  el.levelupTitle.textContent = account.title;
  el.levelupSkins.innerHTML = out.newSkins.length
    ? out.newSkins.map((s) => `<div class="lu-skin" style="--c:var(--accent-2)">${carSvg(s.id)}<span>${escapeHtml(s.name)} unlocked</span></div>`).join('')
    : '';
  el.levelup.classList.remove('out');
  el.levelup.hidden = false;
  sound.levelUp();
  confetti.burst(200);
  setTimeout(() => el.levelup.classList.add('out'), 3400);
  setTimeout(() => { el.levelup.hidden = true; }, 3800);
}
el.levelup.addEventListener('click', () => { el.levelup.hidden = true; });

/* ------------------------------------------------------------ render loop */

function localWpm(now) {
  if (S.myFinish) return S.myFinish.wpm;
  const m = S.room;
  if (!m || !m.startAt) return 0;
  const elapsed = now - m.startAt;
  if (elapsed < 800) return 0;
  return Math.round((S.local.correct / 5) / (elapsed / 60000));
}

function updateWaiting(m, now) {
  const n = m.players.length;
  if (m.isPrivate) {
    el.status.textContent = m.hostId === myId()
      ? `This is your game — send the code ${m.code} to a friend, then press start`
      : 'Waiting for the person who made this game to start it';
  } else {
    const secs = m.lobbyDeadline ? Math.max(0, Math.ceil((m.lobbyDeadline - now) / 1000)) : null;
    el.status.textContent = secs == null
      ? 'Looking for people to race…'
      : `Waiting for people · starts in ${secs}s${n < m.maxPlayers ? ' (computer players fill any empty spots)' : ''}`;
  }
}

function updateCountdown(m, now) {
  const remaining = m.countdownEndsAt - now;
  const n = Math.max(0, Math.ceil(remaining / 1000));
  if (n !== S.lastCd) {
    S.lastCd = n;
    el.cdNum.textContent = n > 0 ? String(n) : 'GO!';
    restartAnim(el.cdNum);
    if (n > 0 && n <= 5) sound.count();
  }
}

function updateRacing(m, now) {
  if (m.tick) m.tick(now); // practice: the pacer lives in this browser
  const len = S.passage.length || 1;
  const wpm = localWpm(now);
  const ks = S.local.keystrokes;
  const acc = ks > 0 ? Math.floor(((ks - S.local.errors) / ks) * 100) : 100;
  const t = S.myFinish ? S.myFinish.time : Math.max(0, now - m.startAt);
  el.hudWpm.textContent = wpm;
  el.hudAcc.textContent = `${acc}%`;
  track.updateMeta(myId(), { wpm, pct: S.local.correct / len });

  // game HUD
  if (game.score !== S.lastScoreShown) {
    S.lastScoreShown = game.score;
    el.hudScore.textContent = game.score.toLocaleString();
    el.hudScore.classList.remove('bump');
    void el.hudScore.offsetWidth;
    el.hudScore.classList.add('bump');
  }
  if (game.combo !== S.lastComboShown) {
    S.lastComboShown = game.combo;
    el.hudCombo.textContent = game.combo;
    el.hudMult.textContent = game.multiplier > 1 ? `· ${game.multiplier}× points` : '';
  }
  const nitro = game.nitro;
  if (nitro) {
    el.nitroFill.style.width = `${Math.round(game.nitroLeft * 100)}%`;
    el.nitroLabel.textContent = 'boost ready';
  } else {
    el.nitroFill.style.width = `${Math.round(game.meter * 100)}%`;
    el.nitroLabel.textContent = game.meter >= 0.8 ? 'Almost…' : 'Nitro';
  }
  el.nitroStat.classList.toggle('ready', !nitro && game.meter >= 0.8);
  if (S.nitroShown && !nitro && !S.local.done) {
    setNitroVisual(false);
    scheduleSend(true);
  }

  // Progress heartbeat: re-send the latest state every 250 ms until the server
  // confirms the finish, so a lost packet (or a burst that hit the server's
  // rate ceiling) can never leave the car stranded short of the line.
  if (!S.myFinish && S.local.typed > 0 && performance.now() - S.lastSendAt > 250) scheduleSend(true);

  if (S.goUntil && performance.now() > S.goUntil) {
    el.countdown.hidden = true;
    el.countdown.classList.remove('go');
    S.goUntil = 0;
  }
}

function updateFinished(m, now) {
  if (m.solo) return;
  const secs = Math.max(0, Math.ceil((m.resultsUntil - now) / 1000));
  el.status.textContent = `Race #${m.raceNo} finished · next race in ${secs}s`;
  el.nextRace.textContent = `Another race starts in ${secs}s`;
}

function frame(ts) {
  const dt = Math.min(100, ts - S.lastFrame);
  S.lastFrame = ts;
  const m = S.room;
  const now = m && m.localClock ? Date.now() : clock.now(); // practice runs keep their own clock
  const st = m ? m.state : null;

  if (m) {
    const len = S.passage.length || 1;
    const target = S.local.correct / len;
    // critically-damped ease so the local car glides instead of stepping per key
    S.local.vis += (target - S.local.vis) * (1 - Math.exp(-dt / 70));
    if (Math.abs(target - S.local.vis) < 0.0004) S.local.vis = target;

    const renderT = now - INTERP_DELAY_MS;
    const me = myId();
    track.render(
      (id) => (id === me ? S.local.vis : m.fractionOf ? m.fractionOf(id, now) : (S.interp.get(id) ? S.interp.get(id).valueAt(renderT) : 0)),
      st === 'racing',
    );

    if (st === 'waiting') updateWaiting(m, now);
    else if (st === 'countdown') updateCountdown(m, now);
    else if (st === 'racing') updateRacing(m, now);
    else if (st === 'finished') updateFinished(m, now);
  }

  const racing = st === 'racing' && !S.local.done;
  bg.setSpeed(racing ? (game.nitro ? 2.6 : 0.35 + Math.min(1.8, localWpm(now) / 55)) : 0.3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ------------------------------------------------------------ install (PWA) */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
let installPrompt = null;
const installBtn = $('#install-btn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  if (outcome === 'accepted') installBtn.hidden = true;
  installPrompt = null;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('TypeDash installed — see you tomorrow for the daily', 'success'); });

// Handy in devtools: TypeDash.game.score, TypeDash.account.level, ...
window.TypeDash = { game, account, boards, solo, state: S };
