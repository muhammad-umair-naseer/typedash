'use strict';
const { CATALOGUE } = require('./achievements');
const { STAGES } = require('./passages');
const { nameOf } = require('./countries');

/**
 * Server-rendered pages: share pages, player profiles and (see the SEO
 * routes) the leaderboard / practice / daily pages that search engines and
 * link unfurlers can read without running the app. Plain HTML on top of the
 * app's stylesheet with a link back into the game; nothing here holds a
 * socket or runs a tick, and every page is cheap string assembly.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('en-US');
const fmtTime = (ms) => { const s = Math.max(0, ms || 0) / 1000; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`; };
const place = (r) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);
const flag = (code) => (!code || code === 'UN' || code.length !== 2 ? '🌍' : String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)));

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23ffffff'/%3E%3Cpath d='M36 6 14 36h14l-4 22 26-32H36l4-20z' fill='%23f59e0b'/%3E%3C/svg%3E";

function layout({ origin, path, title, description, image, imageAlt, body, jsonLd = null, noindex = false }) {
  const url = origin + path;
  const img = image || `${origin}/og/site.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  <meta name="theme-color" content="#f7f4ef">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="TypeDash">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(img)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(imageAlt || title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(img)}">
  <link rel="icon" href="${ICON}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body class="page-body">
  <header class="topbar">
    <a class="brand" href="/"><span class="bolt"><svg class="i fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg></span>TypeDash</a>
    <nav class="topbar-right page-nav">
      <a class="pill" href="/practice">Practice</a>
      <a class="pill" href="/daily">Daily</a>
      <a class="pill" href="/leaderboard">Rankings</a>
      <a class="btn primary small" href="/app">Play now</a>
    </nav>
  </header>
  <main class="page">${body}</main>
  <footer class="page-foot">
    <a href="/">TypeDash</a> · real-time multiplayer typing race · free, no sign-up ·
    <a href="/practice">practice passages</a> · <a href="/daily">daily challenge</a> · <a href="/leaderboard">world rankings</a>
  </footer>
</body>
</html>`;
}

/* ------------------------------------------------------------- share page */

function shareMeta(s) {
  const who = s.name || 'A racer';
  if (s.kind === 'daily') {
    return {
      title: `${who} scored ${s.wpm} WPM on TypeDash Daily #${s.dailyNumber}`,
      description: `${s.rank ? `#${s.rank} of ${num(s.of)} today · ` : ''}${s.accuracy}% accuracy · ${fmtTime(s.time)}. Same passage for everyone, one scored attempt a day. Your turn.`,
      cta: { href: '/app#daily', label: "Play today's daily" },
    };
  }
  if (s.kind === 'practice') {
    return {
      title: `${who} typed ${s.wpm} WPM on “${s.passageTitle || 'a TypeDash passage'}”`,
      description: `${s.accuracy}% accuracy in ${fmtTime(s.time)}. Race their ghost on the same passage — free, no sign-up.`,
      cta: { href: s.passageId && s.accountId ? `/app#practice/${s.passageId}/ghost/${s.accountId}` : '/app#practice', label: 'Beat my ghost' },
    };
  }
  return {
    title: `${who} came ${place(s.rank)} of ${s.of} at ${s.wpm} WPM in a TypeDash race`,
    description: `${s.accuracy}% accuracy · ${s.time ? fmtTime(s.time) : 'did not finish'}${s.ranked ? ` · +${num(s.points)} ranked points` : ''}. Five cars, one passage, live. Can you beat them?`,
    cta: { href: '/app', label: 'Race now' },
  };
}

function sharePage(s, id, origin) {
  const meta = shareMeta(s);
  const image = `${origin}/og/r/${id}.png`;
  const body = `
    <section class="card page-card share-page">
      <img class="share-img" src="${esc(image)}" alt="${esc(meta.title)}" width="1200" height="630">
      <h1>${esc(meta.title)}</h1>
      <p class="sub">${esc(meta.description)}</p>
      <div class="page-cta">
        <a class="btn primary big" href="${esc(meta.cta.href)}">${esc(meta.cta.label)}</a>
      </div>
      <p class="hint">TypeDash is a free typing race. A short paragraph appears, you type it, and whoever finishes first wins. No sign-up — you are typing within seconds.</p>
    </section>`;
  return layout({ origin, path: `/r/${id}`, title: meta.title, description: meta.description, image, body });
}

/* ------------------------------------------------------------- profile page */

function profilePage(p, origin) {
  const title = `${p.name} · Level ${p.level} ${p.title} on TypeDash`;
  const description = `${num(p.points)} ranked points · best ${p.bestWpm} WPM · ${num(p.wins)} wins in ${num(p.races)} races${p.worldRank ? ` · #${num(p.worldRank)} in the world` : ''}${p.streak > 0 ? ` · ${p.streak}-day streak` : ''}.`;
  const image = `${origin}/og/u/${p.id}.png`;
  const have = new Set(p.achievements);
  const ach = CATALOGUE.filter((a) => have.has(a.id));
  const stat = (v, l) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`;
  const body = `
    <section class="card page-card profile-page">
      <img class="share-img" src="${esc(image)}" alt="${esc(title)}" width="1200" height="630">
      <h1>${flag(p.country)} ${esc(p.name)} <small>Level ${p.level} · ${esc(p.title)}</small></h1>
      <p class="sub">${esc(description)}</p>
      <div class="prof-stats page-stats">
        ${stat(num(p.points), 'points')}${stat(p.bestWpm, 'best words a min')}${stat(num(p.wins), 'wins')}${stat(num(p.races), 'races')}
        ${stat(p.worldRank ? `#${num(p.worldRank)}` : '—', 'place in the world')}${stat(p.streak, 'days in a row')}${stat(p.bestCombo, 'best run of correct letters')}${stat(num(p.solo.finished), 'goes on their own')}
      </div>
      ${ach.length ? `<h2>Awards <small>${ach.length} of ${CATALOGUE.length}</small></h2><div class="ach-grid">${ach.map((a) => `<div class="ach got" title="${esc(a.desc)}"><span class="ach-icon">${a.icon}</span><span class="ach-name">${esc(a.name)}</span></div>`).join('')}</div>` : ''}
      <div class="page-cta"><a class="btn primary big" href="/app">Race ${esc(p.name)}</a></div>
      <p class="hint">Profiles are created automatically the first time you race — no sign-up. Your stats, streak and achievements follow your browser.</p>
    </section>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: { '@type': 'Person', name: p.name, identifier: p.id, url: `${origin}/u/${p.id}` },
  };
  return layout({ origin, path: `/u/${p.id}`, title, description, image, body, jsonLd });
}

/* ------------------------------------------------------------- SEO pages */

const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);

function boardTable(rows, fmt, { showCountry = true } = {}) {
  if (!rows.length) return '<p class="hint">Nobody on this board yet — one race puts you on it.</p>';
  return `<table class="results-table board-table"><thead><tr><th>#</th><th>Racer</th><th class="num">Score</th></tr></thead><tbody>${rows.map((r) => `
    <tr><td>${medal(r.rank)}</td><td>${showCountry ? `${flag(r.country)} ` : ''}<a href="/u/${esc(r.id)}">${esc(r.name)}</a></td><td class="num">${esc(fmt(r.value))}</td></tr>`).join('')}</tbody></table>`;
}

/**
 * /leaderboard and /leaderboard/:country — the ranking boards as plain HTML.
 * `top` carries the rows per category; `countries` the codes that have players.
 */
function leaderboardPage({ origin, scope, top, countries, dailyRows, season, teams, countryRows }) {
  const global = scope === 'global';
  const cname = global ? null : nameOf(scope);
  const title = global ? 'World typing rankings · TypeDash' : `Fastest typists in ${cname} · TypeDash rankings`;
  const description = global
    ? `The top ranked racers on TypeDash by points, typing speed (WPM) and daily streak, worldwide. Updated live after every race.`
    : `The top ranked TypeDash racers from ${cname} by points, typing speed (WPM) and daily streak. Updated live after every race.`;
  const path = global ? '/leaderboard' : `/leaderboard/${scope}`;
  const links = countries.filter((c) => c !== scope).map((c) => `<a class="chip-btn" href="/leaderboard/${esc(c)}">${flag(c)} ${esc(nameOf(c) || c)}</a>`).join(' ');
  const body = `
    <section class="card page-card">
      <h1>${global ? 'World rankings' : `${flag(scope)} ${esc(cname)} rankings`} <small>${global ? 'every country' : `<a href="/leaderboard">see the world board</a>`}</small></h1>
      <p class="sub">${esc(description)}</p>
      <h2>Season ${season ? season.number : ''} <small>this month · ends ${season ? new Date(season.endsAt).toISOString().slice(0, 10) : ''}</small></h2>${boardTable(top.season || [], (v) => num(v), { showCountry: global })}
      <h2>Points <small>all time</small></h2>${boardTable(top.points, (v) => num(v), { showCountry: global })}
      <h2>Fastest <small>best words a minute</small></h2>${boardTable(top.wpm, (v) => `${v} a min`, { showCountry: global })}
      <h2>Streak <small>days in a row</small></h2>${boardTable(top.streak, (v) => `${v} 🔥`, { showCountry: global })}
      ${global && dailyRows ? `<h2>Today's paragraph</h2>${boardTable(dailyRows, (v) => `${v} a min`)}` : ''}
      ${global && teams ? `<h2>Teams <small>this season</small></h2>${teams.length ? `<table class="results-table board-table"><thead><tr><th>#</th><th>Team</th><th class="num">Members</th><th class="num">Points</th></tr></thead><tbody>${teams.map((t) => `<tr><td>${medal(t.rank)}</td><td><a href="/t/${esc(t.id)}">${esc(t.name)}</a></td><td class="num">${t.members}</td><td class="num">${num(t.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No teams on the board yet — create one from your profile card.</p>'}` : ''}
      ${global && countryRows ? `<h2>Countries <small>this week</small></h2>${countryRows.length ? `<table class="results-table board-table"><thead><tr><th>#</th><th>Country</th><th class="num">Racers</th><th class="num">Points</th></tr></thead><tbody>${countryRows.map((c) => `<tr><td>${medal(c.rank)}</td><td>${flag(c.country)} <a href="/leaderboard/${esc(c.country)}">${esc(c.name)}</a></td><td class="num">${c.players}</td><td class="num">${num(c.value)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No points this week yet.</p>'}` : ''}
      <div class="page-cta"><a class="btn primary big" href="/app">Have a go</a></div>
      ${global && season && season.past.length ? `<h2>Past seasons</h2><div class="past-seasons">${season.past.map((s) => `
        <div class="past-season"><b>Season ${s.number}</b> <span class="passage-meta">${esc(s.key)} · ${num(s.players)} racers</span><div>${s.top.map((t) => `${medal(t.rank)} ${flag(t.country)} <a href="/u/${esc(t.id)}">${esc(t.name)}</a> <small>${num(t.points)}</small>`).join(' · ')}</div></div>`).join('')}</div>` : ''}
      ${links ? `<h2>The fastest in each country</h2><div class="chips wrap">${links}</div>` : ''}
    </section>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: global ? 'TypeDash world rankings' : `TypeDash rankings — ${cname}`,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: top.points.length,
    itemListElement: top.points.slice(0, 25).map((r) => ({ '@type': 'ListItem', position: r.rank, name: r.name, url: `${origin}/u/${r.id}` })),
  };
  return layout({ origin, path, title, description, body, jsonLd });
}

/** /practice — every passage with its record holder. */
/** The key a set of paragraphs lives under: a language code, or a drill type. */
const setKeyOf = (p) => (p.category === 'prose' ? p.lang : p.category);
const setPathOf = (p) => (p.category === 'prose' ? `/practice/lang/${p.lang}` : `/practice/drill/${p.category}`);

/** Everything grouped into the sets the chooser offers, in the catalogue's own order. */
function practiceSets(passages, langs = {}, categories = {}) {
  const sets = [];
  for (const p of passages) {
    const key = setKeyOf(p);
    let set = sets.find((x) => x.key === key);
    if (!set) {
      const isDrill = p.category !== 'prose';
      sets.push((set = {
        key,
        path: setPathOf(p),
        kind: isDrill ? 'drill' : 'language',
        name: isDrill ? (categories[p.category] || { name: p.category }).name : (langs[p.lang] || { native: p.lang }).native,
        english: isDrill ? '' : (langs[p.lang] || { name: p.lang }).name,
        note: isDrill ? (categories[p.category] || { desc: '' }).desc : '',
        items: [],
      }));
    }
    set.items.push(p);
  }
  for (const set of sets) set.stages = new Set(set.items.map((p) => p.stage || 1)).size;
  return sets;
}

/** One card per set of paragraphs, easiest thing on the page to understand: pick your language. */
function practiceIndexPage({ origin, passages, records, langs = {}, categories = {} }) {
  const sets = practiceSets(passages, langs, categories);
  const sample = passages.find((p) => p.lang === 'en' && p.category === 'prose') || passages[0];
  const langNames = Object.keys(langs).map((l) => langs[l].native);
  const title = 'Typing practice passages · TypeDash';
  // the meta description keeps the words people search for; the page itself says it plainly
  const description = `${passages.length} typing practice passages (WPM test paragraphs) in ${langNames.length} languages — ${langNames.join(', ')} — plus code and number drills, sorted into stages from easy to hard. Free, no sign-up.`;
  const card = (set) => `
    <a class="set-card card" href="${esc(set.path)}">
      <b>${esc(set.name)}</b>
      ${set.english && set.english !== set.name ? `<span class="set-sub">${esc(set.english)}</span>` : ''}
      ${set.note ? `<span class="set-sub">${esc(set.note)}</span>` : ''}
      <span class="set-meta">${set.items.length} paragraphs · ${set.stages} stage${set.stages === 1 ? '' : 's'}</span>
    </a>`;
  const body = `
    <section class="card page-card">
      <h1>Pick a language <small>then choose a paragraph to type</small></h1>
      <p class="sub">${passages.length} paragraphs in ${langNames.length} languages, plus drills made of code and of numbers. Inside each one they run from easy to hard, and nothing is locked.</p>
      <h2>Languages</h2>
      <div class="set-grid">${sets.filter((x) => x.kind === 'language').map(card).join('')}</div>
      <h2>Drills</h2>
      <div class="set-grid">${sets.filter((x) => x.kind === 'drill').map(card).join('')}</div>
      <div class="page-cta"><a class="btn primary big" href="/app#practice">Type a random one now</a><a class="btn big" href="/daily">Today's paragraph</a></div>

      <h2>Put a typing box on your own site</h2>
      <div class="tile embed-snippet">
        <p>One small script, no account needed. Your visitors type a paragraph without leaving your page.</p>
        <pre><code>&lt;script src="${esc(origin)}/embed.js" data-passage="${esc(sample ? sample.id : 'trains')}" data-pacer="50"&gt;&lt;/script&gt;</code></pre>
        <a class="btn" href="/embed?passage=${esc(sample ? sample.id : 'trains')}">See what it looks like</a>
      </div>
    </section>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'TypeDash typing practice',
    itemListElement: sets.map((set, i) => ({ '@type': 'ListItem', position: i + 1, name: set.name, url: `${origin}${set.path}` })),
  };
  return layout({ origin, path: '/practice', title, description, body, jsonLd });
}

/** One set: its paragraphs, in stage cards, easiest stage first. */
function practiceSetPage({ origin, set, records, allSets }) {
  const rec = Object.fromEntries(records.map((r) => [r.passageId, r]));
  const title = `${set.name} typing practice · ${set.items.length} passages · TypeDash`;
  const description = `${set.items.length} ${set.name} typing practice passages, sorted into ${set.stages} stages from easy to hard. Type any of them in your browser — free, no sign-up.`;
  const item = (p) => {
    const r = rec[p.id];
    return `<li><a href="/practice/${esc(p.id)}"><b>${esc(p.title)}</b></a> <span class="passage-meta">${p.words} words${r ? ` · fastest so far ${r.wpm} a min by ${flag(r.country)} ${esc(r.name)}` : ' · nobody has raced it yet'}</span></li>`;
  };
  const stages = STAGES
    .map((st) => ({ st, items: set.items.filter((p) => (p.stage || 1) === st.id) }))
    .filter((x) => x.items.length);
  const others = allSets.filter((x) => x.key !== set.key);
  const body = `
    <section class="card page-card">
      <h1>${esc(set.name)} <small>${set.items.length} paragraphs · ${set.stages} stages</small></h1>
      <p class="sub">Stage 1 is short and plain. Each stage after it has longer words, more punctuation or numbers. Start wherever you like — nothing is locked.</p>
      ${stages.map((x) => `<div class="stage card s${x.st.id}">
        <div class="stage-head">
          <span class="stage-no">Stage ${x.st.id}</span>
          <b>${esc(x.st.name)}</b>
          <span class="stage-note">${esc(x.st.note)}</span>
          <span class="stage-count">${x.items.length} ${x.items.length === 1 ? 'paragraph' : 'paragraphs'}</span>
        </div>
        <ol class="passage-list">${x.items.map(item).join('')}</ol>
      </div>`).join('')}
      <div class="page-cta"><a class="btn primary big" href="/app#practice">Type a random one now</a><a class="btn big" href="/practice">All languages</a></div>
      <h2>Other languages and drills</h2>
      <div class="set-grid small">${others.map((o) => `<a class="set-card card" href="${esc(o.path)}"><b>${esc(o.name)}</b><span class="set-meta">${o.items.length} paragraphs</span></a>`).join('')}</div>
    </section>`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${set.name} typing practice`,
    itemListElement: set.items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.title, url: `${origin}/practice/${p.id}` })),
  };
  return layout({ origin, path: set.path, title, description, body, jsonLd });
}

function practicePage({ origin, passage, record, prev, next, langs = {}, categories = {} }) {
  const p = passage;
  const langName = langs[p.lang] ? langs[p.lang].native : p.lang;
  const catName = categories[p.category] ? categories[p.category].name : p.category;
  const stage = STAGES[(p.stage || 1) - 1] || STAGES[0];
  const title = `Typing practice: “${p.title}” (${p.words} words, ${p.lang === 'en' && p.category === 'prose' ? 'English' : `${langName}${p.category !== 'prose' ? ` · ${catName}` : ''}`}) · TypeDash`;
  const description = `${p.text.slice(0, 150).replace(/\s+\S*$/, '')}… Practise this ${p.words}-word passage in your browser${record ? `, then race the ${record.wpm} WPM record ghost` : ''}. Free, no sign-up.`;
  const body = `
    <section class="card page-card practice-page">
      <h1>${esc(p.title)} <small>${esc(langName)}${p.category !== 'prose' ? ` · ${esc(catName)}` : ''} · ${p.words} words · ${p.text.length} characters</small></h1>
      <p class="page-note stage-note-line"><span class="stage-no">Stage ${stage.id}</span> <b>${esc(stage.name)}</b> — ${esc(stage.note)}</p>
      <blockquote class="passage-text">${esc(p.text)}</blockquote>
      ${record
        ? `<div class="record-box">Fastest anyone has typed this: <b>${record.wpm} words a minute</b> at ${record.accuracy}% correct, by ${flag(record.country)} ${esc(record.name)} (${fmtTime(record.time)})</div>`
        : '<div class="record-box dim">No world record on this passage yet — the first clean run takes it.</div>'}
      <div class="page-cta">
        <a class="btn primary big" href="/app#practice/${esc(p.id)}">Practise this passage</a>
        ${record ? `<a class="btn big" href="/app#practice/${esc(p.id)}/ghost/wr">Race the record ghost</a>` : ''}
      </div>
      <p class="hint">Practice runs happen entirely in your browser: no lobby, no waiting. Golden words pay a bonus, clean words charge nitro, and a verified run can set the record.</p>
      <nav class="passage-nav">${prev ? `<a href="/practice/${esc(prev.id)}">← ${esc(prev.title)}</a>` : '<span></span>'}<a href="/practice">All passages</a>${next ? `<a href="/practice/${esc(next.id)}">${esc(next.title)} →</a>` : '<span></span>'}</nav>
    </section>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'CreativeWork', name: p.title, text: p.text, wordCount: p.words, inLanguage: p.lang, url: `${origin}/practice/${p.id}`, isAccessibleForFree: true };
  return layout({ origin, path: `/practice/${p.id}`, title, description, body, jsonLd });
}

/** /daily — today's challenge, who is leading, and yesterday's podium. */
function dailyPage({ origin, today, yesterday }) {
  const d = today;
  const title = `TypeDash Daily #${d.number} — “${d.passage.title}”`;
  const leader = d.top[0] ? `Best so far: ${d.top[0].wpm} words a minute by ${d.top[0].name}.` : 'Nobody has had a go yet.';
  const description = `Today's typing challenge: ${d.passage.words} words, the same passage for everyone, one scored attempt. ${num(d.players)} played so far. ${leader}`;
  const rows = (list) => list.map((t) => ({ id: t.id, rank: t.rank, name: t.name, country: t.country, value: t.wpm }));
  const body = `
    <section class="card page-card daily-page">
      <h1>Daily #${d.number} <small>“${esc(d.passage.title)}” · ${d.passage.words} words · resets at midnight UTC</small></h1>
      <p class="sub">${esc(description)}</p>
      <div class="page-cta"><a class="btn primary big" href="/app#daily">Play today's daily</a></div>
      <h2>Today's top 10 <small>${num(d.players)} have tried it</small></h2>${boardTable(rows(d.top), (v) => `${v} a min`)}
      ${yesterday && yesterday.top.length ? `<h2>Yesterday · #${yesterday.number} <small>“${esc(yesterday.title)}”</small></h2>${boardTable(rows(yesterday.top), (v) => `${v} a min`)}` : ''}
      <p class="hint">The daily is played in practice mode, right in your browser. Your first verified finished run is the one that counts; later runs are practice. A daily streak grows for every consecutive day you complete it.</p>
    </section>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: `${origin}/daily`, dateModified: new Date().toISOString() };
  return layout({ origin, path: '/daily', title, description, image: `${origin}/og/daily.png`, body, jsonLd });
}

function robots(origin) {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /og/\nDisallow: /r/\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function sitemap(origin, urls) {
  const items = urls.map((u) => `  <url><loc>${esc(origin + u.path)}</loc>${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}${u.priority != null ? `<priority>${u.priority}</priority>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

/** /t/:id — a team's public page. */
function teamPage(t, origin) {
  const title = `[${t.tag}] ${t.name} · TypeDash team`;
  const description = `${t.size} member${t.size === 1 ? '' : 's'} · ${num(t.season.points)} points this season${t.season.rank ? ` (#${t.season.rank} of ${t.season.of})` : ''} · ${num(t.allTime.points)} all time. Every ranked point a member earns counts for the team.`;
  const body = `
    <section class="card page-card team-page">
      <h1>[${esc(t.tag)}] ${esc(t.name)} <small>${t.size}/${t.max} members · team since ${new Date(t.createdAt).toISOString().slice(0, 10)}</small></h1>
      <p class="sub">${esc(description)}</p>
      <div class="prof-stats page-stats">
        <div><b>${num(t.season.points)}</b><span>season points</span></div>
        <div><b>${t.season.rank ? `#${t.season.rank}` : '—'}</b><span>season rank</span></div>
        <div><b>${num(t.allTime.points)}</b><span>all time</span></div>
        <div><b>${t.trophies.length}</b><span>trophies</span></div>
      </div>
      ${t.trophies.length ? `<p class="hint">${t.trophies.map((x) => `${medal(x.rank)} Season ${x.number}`).join(' · ')}</p>` : ''}
      <h2>Members</h2>
      <table class="results-table board-table"><thead><tr><th>Racer</th><th class="num">Season</th><th class="num">All time</th><th class="num">Best a min</th></tr></thead><tbody>${t.members.map((m) => `
        <tr><td>${flag(m.country)} <a href="/u/${esc(m.id)}">${esc(m.name)}</a>${m.owner ? ' <span class="tag">OWNER</span>' : ''}</td><td class="num">${num(m.season)}</td><td class="num">${num(m.points)}</td><td class="num">${m.bestWpm}</td></tr>`).join('')}</tbody></table>
      <div class="page-cta"><a class="btn primary big" href="/app">Race them</a><a class="btn big" href="/leaderboard">Team rankings</a></div>
      <p class="hint">Teams are free: create one from your profile card, share the invite link, and every ranked race your members finish scores for the team.</p>
    </section>`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'SportsTeam', name: t.name, alternateName: t.tag, url: `${origin}/t/${t.id}`, memberOf: { '@type': 'Organization', name: 'TypeDash' } };
  return layout({ origin, path: `/t/${t.id}`, title, description, body, jsonLd });
}

/** /embed — the widget document itself (self-contained: inline styles, one module). */
function embedPage({ origin, passage }) {
  const title = passage ? `TypeDash · “${passage.title}”` : 'TypeDash typing race';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex">
  <link rel="icon" href="${ICON}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <style>
    :root { --bg: #f7f3ee; --panel: #ffffff; --b: rgba(58, 42, 25,.1); --text: #2a2521; --muted: #7a7267; --accent: #d97706; --accent2: #0d9fc4; --gold: #b45309; --red: #e04a61; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 Inter, system-ui, sans-serif; }
    .wrap { padding: 16px 18px 14px; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
    .brand { font: 700 1.05rem 'Space Grotesk', Inter, sans-serif; text-decoration: none; color: var(--text); display: inline-flex; gap: 6px; align-items: center; }
    .brand span { color: #f59e0b; }
    .stats { display: flex; gap: 8px; font-variant-numeric: tabular-nums; }
    .stat { padding: 4px 10px; border-radius: 999px; background: #ffffff; border: 1px solid var(--b); font-size: .8rem; color: var(--muted); }
    .stat b { color: var(--accent2); font: 700 .95rem 'Space Grotesk', Inter, sans-serif; margin-right: 4px; }
    .status { color: var(--muted); font-size: .82rem; margin: 0 0 8px; min-height: 1.3em; }
    .bars { display: grid; gap: 6px; margin: 8px 0 12px; }
    .bar { position: relative; height: 10px; border-radius: 999px; background: rgba(58, 42, 25,.08); border: 1px solid rgba(58, 42, 25,.06); overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; border-radius: 999px; transition: width .12s linear; }
    .bar.me i { background: linear-gradient(90deg, var(--accent), var(--accent2)); }
    .bar.pacer i { background: rgba(58, 42, 25,.2); }
    .bar-label { font-size: .7rem; color: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
    .passage-wrap { position: relative; padding: 14px 16px; border-radius: 14px; background: var(--panel); border: 1px solid var(--b); cursor: text; }
    .passage { font: 1.02rem/1.8 'JetBrains Mono', ui-monospace, monospace; color: #6b6359; max-height: 190px; overflow-y: auto; user-select: none; }
    .passage .w { display: inline-block; white-space: pre; }
    .passage .c.ok { color: var(--text); }
    .passage .c.bad { color: #fff; background: rgba(224,74,97,.5); border-radius: 3px; }
    .passage .c.cur { background: rgba(217, 119, 6,.18); border-radius: 3px; box-shadow: -2px 0 0 var(--accent2); }
    .passage .w.gold .c { color: #a9820a; }
    .passage .w.gold.gold-hit .c { color: #0d7d4c; }
    .passage.locked { filter: saturate(.6); }
    .hidden-input { position: absolute; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; font-size: 16px; }
    .result { margin-top: 12px; padding: 14px 16px; border-radius: 14px; background: rgba(217, 119, 6,.1); border: 1px solid rgba(217, 119, 6,.35); }
    .result-grid { display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
    .result-grid b { font: 700 2rem/1 'Space Grotesk', Inter, sans-serif; color: var(--accent2); }
    .result-grid span { color: var(--muted); font-size: .8rem; }
    .result p { margin: 8px 0 10px; font-size: .9rem; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 10px; border: 1px solid var(--b); background: #f0eae2; color: var(--text); font: 600 .9rem Inter, sans-serif; text-decoration: none; cursor: pointer; }
    .btn.primary { background: #f59e0b; border-color: transparent; color: #2a2521; }
    .foot { margin-top: 10px; font-size: .74rem; color: var(--muted); text-align: right; }
    .foot a { color: var(--text); }
    [hidden] { display: none !important; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <a class="brand" href="${esc(origin)}/?ref=embed" target="_blank" rel="noopener"><span>⚡</span>TypeDash</a>
      <div class="stats"><div class="stat"><b id="e-wpm">0</b>a min</div><div class="stat"><b id="e-acc">100%</b>right</div><div class="stat"><b id="e-time">0:00.0</b></div></div>
    </div>
    <p class="status" id="e-status">Loading a passage…</p>
    <div class="bars">
      <div class="bar-label">You</div><div class="bar me"><i id="bar-me"></i></div>
      <div class="bar-label" id="pacer-label">Pacer</div><div class="bar pacer"><i id="bar-pacer"></i></div>
    </div>
    <div class="passage-wrap" id="passage-wrap">
      <input id="hidden-input" class="hidden-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Typing input">
      <div id="passage" class="passage locked"></div>
    </div>
    <div class="result" id="result" hidden>
      <div class="result-grid"><div><b id="r-wpm">0</b> <span>words a min</span></div><div><b id="r-acc">100%</b> <span>typed right</span></div><div><b id="r-time">0:00.0</b> <span>time</span></div></div>
      <p id="r-line"></p>
      <div class="row">
        <a class="btn primary" id="btn-play" href="${esc(origin)}/app?ref=embed" target="_blank" rel="noopener">Race the world on TypeDash</a>
        <button class="btn" id="btn-again" type="button">↻ Try again</button>
      </div>
    </div>
    <p class="foot">Live multiplayer, daily challenge and rankings at <a href="${esc(origin)}/app?ref=embed" target="_blank" rel="noopener">${esc(origin.replace(/^https?:\/\//, ''))}</a></p>
  </div>
  <script type="module" src="/js/embed.js"></script>
</body>
</html>`;
}

function notFoundPage(origin, path) {
  const body = `
    <section class="card page-card">
      <h1>Nothing here</h1>
      <p class="sub">That link has expired or never existed. The race, however, is on.</p>
      <div class="page-cta"><a class="btn primary big" href="/app">Play TypeDash</a></div>
    </section>`;
  return layout({ origin, path, title: 'Not found · TypeDash', description: 'That page does not exist.', body, noindex: true });
}

module.exports = {
  practiceSets,
  practiceSetPage, layout, sharePage, shareMeta, profilePage, leaderboardPage, practiceIndexPage, practicePage, dailyPage, teamPage, embedPage, robots, sitemap, notFoundPage, esc, num, fmtTime, flag };
