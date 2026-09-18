'use strict';
const fs = require('fs');
const path = require('path');

/**
 * The passage catalogue. Every file in server/passages/ exports
 * { lang, category, passages: [{ id, title, text }] }; all of it is original
 * writing for this game. Every passage has a stable `id` (also its URL slug):
 * ghost records, daily challenges and /practice pages are keyed by it, so
 * never reuse an id once it has shipped.
 *
 * English prose is ASCII-only on purpose so every keyboard layout can type
 * it; other languages use their real orthography, because that is what their
 * typists' keyboards produce.
 */
const LANGS = {
  en: { name: 'English', native: 'English' },
  es: { name: 'Spanish', native: 'Español' },
  de: { name: 'German', native: 'Deutsch' },
  fr: { name: 'French', native: 'Français' },
  pt: { name: 'Portuguese', native: 'Português' },
  id: { name: 'Indonesian', native: 'Bahasa Indonesia' },
  tr: { name: 'Turkish', native: 'Türkçe' },
};
const CATEGORIES = {
  prose: { name: 'Prose', desc: 'Sentences and stories' },
  code: { name: 'Code', desc: 'Real one-liners, symbols and all' },
  numbers: { name: 'Numbers & symbols', desc: 'Dates, prices, codes' },
};

const DIR = path.join(__dirname, 'passages');
const PASSAGES = [];
// English prose first, then the other languages, then the drills — the order /practice lists them in
const order = (f) => (f === 'en.js' ? '0' : LANGS[f.replace('.js', '')] ? `1${f}` : `2${f}`);
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort((a, b) => order(a).localeCompare(order(b)))) {
  const mod = require(path.join(DIR, file));
  if (!LANGS[mod.lang]) throw new Error(`${file}: unknown lang ${mod.lang}`);
  if (!CATEGORIES[mod.category]) throw new Error(`${file}: unknown category ${mod.category}`);
  for (const p of mod.passages) {
    PASSAGES.push({ lang: mod.lang, category: mod.category, ...p, words: p.text.split(' ').length });
  }
}
/**
 * Stages: the /practice list is ordered from gentle to hard so a newcomer knows
 * where to start. Difficulty comes from the text itself — long words, heavy
 * punctuation, digits and capitals all slow a typist down — and each language
 * and drill type is split into its own stages, so "New" means new *for that
 * language* rather than "English prose is easier than Turkish".
 */
const STAGES = [
  { id: 1, name: 'New', note: 'Short, plain words — start here' },
  { id: 2, name: 'Warming up', note: 'A little longer, still everyday words' },
  { id: 3, name: 'Tricky', note: 'Longer words and more punctuation' },
  { id: 4, name: 'Toughest', note: 'The hardest ones we have' },
];

function difficulty(p) {
  const t = p.text;
  const words = t.split(/\s+/).filter(Boolean);
  const avgWord = words.reduce((n, w) => n + w.length, 0) / (words.length || 1);
  const share = (re) => (t.match(re) || []).length / (t.length || 1);
  return avgWord
    + share(/[^\p{L}\p{N}\s]/gu) * 28        // punctuation and symbols
    + share(/\p{N}/gu) * 30                   // digits
    + share(/\p{Lu}/gu) * 12                  // capitals (a shift for each one)
    + (words.filter((w) => w.length >= 9).length / (words.length || 1)) * 8
    + t.length / 400;                        // sheer length
}

// assign a stage per language + drill type: sort by difficulty, then deal the
// list into as many stages as it can fill with at least two paragraphs each
for (const lang of Object.keys(LANGS)) {
  for (const category of Object.keys(CATEGORIES)) {
    const group = PASSAGES.filter((p) => p.lang === lang && p.category === category);
    if (!group.length) continue;
    group.sort((a, b) => difficulty(a) - difficulty(b) || a.id.localeCompare(b.id));
    const count = Math.max(1, Math.min(STAGES.length, Math.floor(group.length / 2)));
    const per = Math.ceil(group.length / count);
    group.forEach((p, i) => { p.stage = Math.min(count, Math.floor(i / per) + 1); });
  }
}

const stageOf = (p) => STAGES[(p && p.stage ? p.stage : 1) - 1] || STAGES[0];

const BY_ID = new Map(PASSAGES.map((p) => [p.id, p]));
if (BY_ID.size !== PASSAGES.length) {
  const seen = new Set();
  throw new Error(`duplicate passage ids: ${PASSAGES.filter((p) => seen.has(p.id) || !seen.add(p.id)).map((p) => p.id).join(', ')}`);
}

function byId(id) {
  return BY_ID.get(String(id || '')) || null;
}

const isLang = (l) => !!LANGS[l];
const isCategory = (c) => !!CATEGORIES[c];

/** Every passage matching the filter (all of them by default). */
function list({ lang = null, category = null } = {}) {
  return PASSAGES.filter((p) => (!lang || p.lang === lang) && (!category || p.category === category));
}

/** A random passage matching the filter (English prose if the combination is empty), never `exclude` when there is a choice. */
function pick({ lang = 'en', category = 'prose', exclude = null } = {}) {
  let pool = list({ lang, category });
  if (!pool.length) pool = list({ lang: 'en', category: 'prose' });
  const choices = pool.length > 1 ? pool.filter((p) => p.id !== exclude) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Pick `count` "golden" word indices for a passage: words of 4+ letters, never
 * the first word, spread out so two bonuses are never back to back. `rand`
 * may be a seeded generator so everyone gets the same words (daily challenge).
 */
function pickBonusWords(text, count, rand = Math.random) {
  const words = text.split(' ');
  const candidates = [];
  for (let i = 1; i < words.length; i++) {
    if (words[i].replace(/[^\p{L}]/gu, '').length >= 4) candidates.push(i);
  }
  const chosen = [];
  let guard = 200;
  while (chosen.length < count && candidates.length && guard-- > 0) {
    const idx = candidates[Math.floor(rand() * candidates.length)];
    if (chosen.some((c) => Math.abs(c - idx) < 2)) continue;
    chosen.push(idx);
  }
  return chosen.sort((a, b) => a - b);
}

module.exports = { PASSAGES, LANGS, CATEGORIES, STAGES, byId, list, pick, pickBonusWords, isLang, isCategory, difficulty, stageOf };
