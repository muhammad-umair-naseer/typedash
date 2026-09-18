'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Social cards (1200x630) for link unfurls: race / practice / daily results,
 * player profiles, today's daily and the site itself. Cards are built as SVG
 * and rasterised to PNG with @resvg/resvg-js when it is installed (optional
 * dependency); without it the SVG is served as-is. Fonts are bundled in
 * server/fonts so rendering is deterministic on any host and never scans
 * system fonts (which takes seconds).
 *
 * Rendering is the one CPU-bound thing on this server, so every card is
 * cached in memory by key and served with long cache headers; a card is only
 * rendered when somebody actually shares or unfurls it.
 */
let Resvg = null;
try { ({ Resvg } = require('@resvg/resvg-js')); } catch (_) { /* PNG rendering unavailable: SVG cards still work */ }

const W = 1200;
const H = 630;
const FONT_FILES = ['Inter-Medium.ttf', 'Inter-Bold.ttf', 'SpaceGrotesk-Bold.ttf']
  .map((f) => path.join(__dirname, 'fonts', f))
  .filter((f) => fs.existsSync(f));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const num = (n) => Number(n || 0).toLocaleString('en-US');
const fmtTime = (ms) => { const s = Math.max(0, ms || 0) / 1000; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const place = (r) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);

/* Side-view car bodies — keep in sync with public/js/cars.js. */
const BODIES = {
  sport: { body: 'M6 33 C6 27 10 24 16 23 L34 21 L46 10 C49 7 53 6 58 6 L84 6 C89 6 93 8 96 12 L104 21 L113 24 C117 25 119 28 119 32 L119 36 C119 39 117 40 114 40 L11 40 C8 40 6 38 6 36 Z', glass: 'M40 21 L49 12 C51 10 54 9 58 9 L80 9 C83 9 85 10 87 12 L94 21 Z' },
  hatch: { body: 'M8 34 C8 28 12 25 18 24 L30 23 L36 12 C38 9 42 8 46 8 L88 8 C93 8 97 11 100 15 L107 24 L113 26 C117 27 119 30 119 34 L119 37 C119 39 117 40 114 40 L12 40 C9 40 8 38 8 36 Z', glass: 'M34 23 L39 13 C40 11 43 10 46 10 L86 10 C90 10 93 12 95 15 L100 23 Z' },
  muscle: { body: 'M6 34 C6 28 9 25 14 24 L32 22 L42 12 C44 9 47 8 51 8 L74 8 C78 8 81 10 83 13 L88 22 L112 24 C117 25 119 28 119 32 L119 36 C119 39 117 40 114 40 L11 40 C8 40 6 38 6 36 Z', glass: 'M36 22 L44 13 C45 11 48 10 51 10 L72 10 C75 10 77 11 79 13 L85 22 Z' },
  pickup: { body: 'M6 30 L6 36 C6 38 8 40 11 40 L114 40 C117 40 119 38 119 36 L119 30 C119 27 117 25 113 24 L104 22 L96 11 C94 8 91 7 87 7 L62 7 C58 7 56 9 56 12 L56 24 L12 26 C8 27 6 28 6 30 Z', glass: 'M60 22 L60 12 C60 10 61 9 63 9 L86 9 C88 9 90 10 91 12 L98 22 Z' },
  rocket: { body: 'M4 36 L4 33 C4 30 7 28 10 28 L36 27 L44 18 C47 14 51 13 56 13 L78 13 C83 13 87 15 90 19 L96 27 L114 29 C117 30 119 32 119 35 L119 37 C119 39 117 40 114 40 L9 40 C6 40 4 39 4 36 Z', glass: 'M42 27 L47 19 C49 16 52 15 56 15 L76 15 C79 15 82 16 84 19 L89 27 Z' },
};
const SKIN_BODY = { dash: 'sport', bolt: 'sport', hatch: 'hatch', muscle: 'muscle', flame: 'muscle', pickup: 'pickup', rocket: 'rocket', checker: 'sport', nova: 'rocket' };

function car(skin, color, x, y, scale) {
  const b = BODIES[SKIN_BODY[skin] || 'sport'];
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="62" cy="47" rx="54" ry="3.5" fill="#000" fill-opacity=".5"/>
    <path d="${b.body}" fill="${color}"/>
    <path d="${b.body}" fill="url(#gloss)"/>
    <path d="${b.glass}" fill="#d6f1ff" fill-opacity=".92"/>
    <rect x="112" y="27" width="6.5" height="4" rx="1" fill="#fff5c2"/>
    <rect x="6" y="27" width="5" height="4" rx="1" fill="#ff3b3b"/>
    <path d="M13 36 H113" stroke="#000" stroke-opacity=".28" stroke-width="2"/>
    <circle cx="30" cy="40" r="9.5" fill="#15151a"/><circle cx="30" cy="40" r="5.2" fill="#d5d5df"/>
    <circle cx="92" cy="40" r="9.5" fill="#15151a"/><circle cx="92" cy="40" r="5.2" fill="#d5d5df"/>
  </g>`;
}

const BOLT = 'M36 6 14 36h14l-4 22 26-32H36l4-20z';

/** Common frame: background, brand, a tag top-right, footer line. `inner` draws the middle. */
function frame({ tag, inner, footer }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7f4ef"/><stop offset="1" stop-color="#f0eae2"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#d97706"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g stroke="#2a2521" stroke-opacity=".05" stroke-width="2">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="${-100 + i * 260}" y1="${H}" x2="${300 + i * 260}" y2="0"/>`).join('')}</g>
  <g transform="translate(56 40) scale(0.72)"><rect width="64" height="64" rx="14" fill="#ffffff"/><path d="${BOLT}" fill="#f59e0b"/></g>
  <text x="116" y="80" font-family="Space Grotesk" font-weight="700" font-size="38" fill="#2a2521">TypeDash</text>
  <text x="${W - 56}" y="78" text-anchor="end" font-family="Inter" font-weight="700" font-size="22" letter-spacing="4" fill="#b45309">${esc(tag)}</text>
  ${inner}
  <line x1="56" y1="536" x2="${W - 56}" y2="536" stroke="#2a2521" stroke-opacity=".08" stroke-width="2"/>
  <text x="56" y="584" font-family="Inter" font-weight="500" font-size="26" fill="#7a7267">${esc(footer)}</text>
</svg>`;
}

/** A pill with the two-letter country code (flag emoji need a colour font, so we spell it out). */
const pill = (x, y, text, color = '#7a7267') => `<rect x="${x}" y="${y - 30}" width="${28 + text.length * 17}" height="40" rx="20" fill="#2a2521" fill-opacity=".05" stroke="#2a2521" stroke-opacity=".09"/><text x="${x + 14}" y="${y - 1}" font-family="Inter" font-weight="700" font-size="24" letter-spacing="2" fill="${color}">${esc(text)}</text>`;

/** big number + label on the left, three lines and a car on the right */
function hero({ big, bigLabel, name, country, line2, line3, skin, color = '#0d9fc4', bigColor = '#0d9fc4' }) {
  const bigStr = String(big);
  const bigSize = bigStr.length > 3 ? 150 : 210;
  const nameStr = cut(name, 18);
  const nameW = nameStr.length * 31;
  return `
  <text x="60" y="392" font-family="Space Grotesk" font-weight="700" font-size="${bigSize}" fill="${bigColor}">${esc(bigStr)}</text>
  <text x="66" y="446" font-family="Inter" font-weight="700" font-size="30" letter-spacing="8" fill="#7a7267">${esc(bigLabel)}</text>
  <text x="520" y="296" font-family="Space Grotesk" font-weight="700" font-size="58" fill="#2a2521">${esc(nameStr)}</text>
  ${country && country !== 'UN' ? pill(520 + nameW + 16, 292, country) : ''}
  <text x="520" y="354" font-family="Inter" font-weight="500" font-size="33" fill="#2a2521">${esc(cut(line2, 40))}</text>
  <text x="520" y="404" font-family="Inter" font-weight="500" font-size="29" fill="#7a7267">${esc(cut(line3, 46))}</text>
  ${car(skin, color, 850, 428, 2.6)}`;
}

function resultCard(s, origin) {
  const host = hostOf(origin);
  if (s.kind === 'daily') {
    return frame({
      tag: `DAILY #${s.dailyNumber || ''}`.trim(),
      inner: hero({
        big: s.wpm, bigLabel: 'WPM', name: s.name, country: s.country, skin: s.skin, color: s.color,
        line2: s.rank ? `#${s.rank} of ${num(s.of)} today · ${s.accuracy}% accuracy` : `${s.accuracy}% accuracy · ${fmtTime(s.time)}`,
        line3: `“${s.passageTitle || 'Daily challenge'}” · ${fmtTime(s.time)}`,
      }),
      footer: `Same passage for everyone, one shot a day · play it at ${host}`,
    });
  }
  if (s.kind === 'practice') {
    const pacer = s.pacer && s.pacer.kind === 'ghost' ? `${s.pacer.won ? 'beat' : 'lost to'} ${s.pacer.name}'s ghost (${s.pacer.wpm} WPM)`
      : s.pacer && s.pacer.wpm ? `${s.pacer.won ? 'beat' : 'lost to'} the ${s.pacer.wpm} WPM pacer` : 'practice run';
    return frame({
      tag: 'PRACTICE',
      inner: hero({
        big: s.wpm, bigLabel: 'WPM', name: s.name, country: s.country, skin: s.skin, color: s.color,
        line2: `${s.accuracy}% accuracy · ${fmtTime(s.time)}`,
        line3: `“${s.passageTitle || 'Practice'}” · ${pacer}`,
      }),
      footer: `Beat my ghost on this passage at ${host} · free, no sign-up`,
    });
  }
  const ranked = s.ranked ? `+${num(s.points)} ranked points` : 'friendly race';
  return frame({
    tag: s.ranked ? 'RANKED RACE' : 'FRIENDLY RACE',
    inner: hero({
      big: s.wpm, bigLabel: 'WPM', name: s.name, country: s.country, skin: s.skin, color: s.color,
      line2: `${place(s.rank)} of ${s.of} · ${s.accuracy}% accuracy · ${s.time ? fmtTime(s.time) : 'DNF'}`,
      line3: `${ranked}${s.streak > 1 ? ` · ${s.streak}-day streak` : ''}`,
    }),
    footer: `Race me at ${host} · real-time multiplayer typing race`,
  });
}

function profileCard(p, origin) {
  const rank = p.worldRank ? `#${num(p.worldRank)} in the world` : 'unranked';
  return frame({
    tag: 'PLAYER PROFILE',
    inner: hero({
      big: p.level, bigLabel: 'LEVEL', name: p.name, country: p.country, skin: p.skin, color: '#d97706', bigColor: '#b8860b',
      line2: `${p.title} · ${num(p.points)} points · best ${p.bestWpm} WPM`,
      line3: `${rank} · ${p.wins} wins · ${p.streak > 0 ? `${p.streak}-day streak` : `${p.races} races`}`,
    }),
    footer: `Race me at ${hostOf(origin)} · real-time multiplayer typing race`,
  });
}

function siteCard(origin) {
  return frame({
    tag: 'FREE · NO SIGN-UP',
    inner: `
  <text x="60" y="270" font-family="Space Grotesk" font-weight="700" font-size="84" fill="#2a2521">Type against</text>
  <text x="60" y="365" font-family="Space Grotesk" font-weight="700" font-size="84" fill="url(#grad)">the world.</text>
  <text x="60" y="438" font-family="Inter" font-weight="500" font-size="30" fill="#7a7267">Five cars, one passage, live.</text>
  ${car('rocket', '#0d9fc4', 760, 300, 3.2)}`,
    footer: `${hostOf(origin)} · real-time multiplayer typing race with worldwide rankings`,
  });
}

function dailyCard(d, origin) {
  const leader = d.top && d.top[0] ? `leader ${d.top[0].wpm} WPM (${cut(d.top[0].name, 14)})` : 'nobody has set a time yet';
  return frame({
    tag: `DAILY #${d.number}`,
    inner: hero({
      big: `#${d.number}`, bigLabel: 'DAILY', name: cut(d.passage.title, 26), country: null, skin: 'checker', color: '#b8860b', bigColor: '#b8860b',
      line2: `${d.passage.words} words · same passage for everyone`,
      line3: `${num(d.players)} played today · ${leader}`,
    }),
    footer: `One scored attempt a day · play it at ${hostOf(origin)}/daily`,
  });
}

function hostOf(origin) {
  return String(origin || '').replace(/^https?:\/\//, '') || 'typedash';
}

/* ------------------------------------------------------------- rendering */

const cache = new Map();   // key -> { at, png }
const CACHE_MAX = 300;

/** PNG for an SVG, cached by key. Returns null when the rasteriser is not installed. */
function png(key, svg, ttlMs = 3600000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.png;
  if (!Resvg) return null;
  const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: W } });
  const out = Buffer.from(r.render().asPng());
  cache.set(key, { at: Date.now(), png: out });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

module.exports = { resultCard, profileCard, siteCard, dailyCard, png, available: !!Resvg, W, H, _cache: cache };
