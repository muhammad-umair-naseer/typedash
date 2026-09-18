/**
 * Practice mode: the whole run happens in this browser.
 *
 * Passage choice, the countdown, the pacer car, timing, combos and score are
 * all computed locally, so a practising player costs the server nothing while
 * they type: no lobby, no tick loop, no snapshot stream. The server hears from
 * a practice run exactly twice — `solo_start` when GO happens and `solo_done`
 * with the single result, which it sanity-checks against the typing-rate
 * ceiling and that start stamp before writing it to the account.
 *
 * To the rest of the client a practice run looks like a room: `Solo` emits
 * the same `room` / `finished` messages a server room would (flagged
 * `solo: true`, with a `localClock`), so the track, HUD, countdown and
 * results screen need no special casing beyond a few labels.
 */
import { fmtTime, toast, escapeHtml } from './ui.js';

export const PACERS = [
  { id: 'medium', label: 'Medium pacer · 55 WPM', wpm: 55 },
  { id: 'easy', label: 'Easy pacer · 35 WPM', wpm: 35 },
  { id: 'hard', label: 'Hard pacer · 80 WPM', wpm: 80 },
  { id: 'pro', label: 'Pro pacer · 110 WPM', wpm: 110 },
  { id: 'best', label: 'Pacer: my best', wpm: null },
  { id: 'wr', label: 'Ghost: world record', ghost: 'wr' },
  { id: 'pb', label: 'Ghost: my best on this passage', ghost: 'pb' },
  { id: 'none', label: 'No pacer', wpm: 0 },
];

export const COUNTDOWN_MS = 1500;
const PACER_REACTION_MS = 350;
const SAMPLE_MS = 250;          // progress timeline resolution sent to the server
const MAX_SAMPLES = 400;
const RESULTS_DELAY_MS = 1400;  // let the finish banner land before the results modal
const PACER_ID = 'pacer';

/** Same rule as the server's Room.pickBonusWords: 4+ letter words, never the first, never adjacent. */
export function pickBonusWords(passage, count, rand = Math.random) {
  const words = passage.split(' ');
  const candidates = [];
  for (let i = 1; i < words.length; i++) {
    if (words[i].replace(/[^a-z]/gi, '').length >= 4) candidates.push(i);
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

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Characters a ghost had typed `t` ms after GO, interpolated from its [[t, chars], ...] timeline. */
export function ghostChars(timeline, t) {
  const n = timeline.length;
  if (!n || t <= 0) return 0;
  if (t >= timeline[n - 1][0]) return timeline[n - 1][1];
  let lo = -1;                 // t(lo) <= t < t(hi); index -1 is the implicit origin (0, 0)
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid][0] <= t) lo = mid; else hi = mid;
  }
  const [t0, c0] = lo < 0 ? [0, 0] : timeline[lo];
  const [t1, c1] = timeline[hi];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
  return c0 + (c1 - c0) * f;
}

export class Solo {
  /**
   * @param {object} o
   * @param {import('./net.js').Net} o.net
   * @param {(m:object)=>void} o.emit  routes a synthetic `room` / `finished` message into the app
   * @param {()=>string} o.myId        the local racer id (the socket id once connected)
   * @param {()=>object} o.identity    { name, country, skin, bestWpm }
   * @param {import('./track.js').Track} o.track
   * @param {import('./game.js').RaceGame} o.game
   */
  constructor({ net, emit, myId, identity, track, game }) {
    this.net = net;
    this.emit = emit;
    this.myId = myId;
    this.identity = identity;
    this.track = track;
    this.game = game;
    this.catalogue = null;
    this.bonusCount = 3;
    this.lastId = null;
    this.lastOpts = null;
    this.run = null;
    this.raceNo = 0;
    this.pending = null;          // a result waiting for the socket to come back
    this.serverResult = null;
    this.ready = this.load();
    net.on('hello_ok', () => this.flush());
  }

  /** Pull the passage catalogue once over plain HTTP (cached by the browser). */
  async load() {
    try {
      const res = await fetch('/api/passages');
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      this.catalogue = data.passages;
      this.langs = data.langs || { en: { name: 'English', native: 'English' } };
      this.categories = data.categories || { prose: { name: 'Prose' } };
      this.bonusCount = data.bonusWords ?? 3;
    } catch (_) {
      this.catalogue = null;
    }
    return this.catalogue;
  }

  get active() { return !!this.run; }
  get racing() { return !!this.run && this.run.state === 'racing'; }

  passageById(id) {
    return (this.catalogue || []).find((p) => p.id === id) || null;
  }

  /** A stored replay for a passage: the world record, or the personal best of an account (mine by default). */
  async fetchGhost(passageId, kind, ofAccount = null) {
    try {
      const me = ofAccount || this.identity().accountId;
      const res = await fetch(`/api/ghost?passage=${encodeURIComponent(passageId)}${me ? `&me=${encodeURIComponent(me)}` : ''}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const g = (await res.json())[kind];
      return g && Array.isArray(g.timeline) && g.timeline.length >= 2 ? g : null;
    } catch (_) {
      return null;
    }
  }

  resolvePacer(pacer) {
    if (typeof pacer === 'number') return Math.max(0, Math.min(400, Math.round(pacer)));
    const spec = PACERS.find((p) => p.id === pacer && p.wpm !== undefined) || PACERS[0];
    if (spec.wpm != null) return spec.wpm;
    const best = this.identity().bestWpm || 0;
    if (!best) toast('No personal best yet — pacing at 55 WPM until you set one', 'info', 2600);
    return best || 55;
  }

  /**
   * Start a run. `passageId` picks a specific passage (practice pages, daily
   * challenge); otherwise a random one that is not the last one played.
   */
  async start({ passageId = null, passage = null, bonusWords = null, pacer = 'medium', pacerName = null, mode = 'practice', dailyNumber = null, lang = 'en', category = 'prose' } = {}) {
    if (!this.catalogue && !passage) {
      toast('Loading passages…', 'info', 1200);
      await this.load();
    }
    if (!this.catalogue && !passage) {
      toast('Could not load the passages. Check your connection and try again.', 'error');
      return false;
    }
    this.lastOpts = { passageId, passage, bonusWords, pacer, pacerName, mode, dailyNumber, lang, category };
    let p = passage || (passageId ? this.passageById(passageId) : null);
    if (passageId && !p) toast('That passage is not available — here is another one', 'warn', 2600);
    if (!p) {
      let pool = this.catalogue.filter((x) => x.lang === lang && x.category === category);
      if (!pool.length) pool = this.catalogue.filter((x) => x.lang === 'en' && x.category === 'prose');
      if (pool.length > 1) pool = pool.filter((x) => x.id !== this.lastId);
      p = pool[Math.floor(Math.random() * pool.length)];
    }
    this.lastId = p.id;

    const me = this.identity();
    // the pacer is either a fixed speed or a ghost replay (world record, personal best, today's leader)
    let ghost = null;
    let pacerKind = 'wpm';
    if (pacer && typeof pacer === 'object' && pacer.ghost) {
      ghost = pacer.ghost;
      pacerKind = pacer.kind || 'leader';
    } else if (pacer && typeof pacer === 'object' && pacer.ghostOf) {   // "beat my ghost" links
      ghost = await this.fetchGhost(p.id, 'pb', pacer.ghostOf);
      if (ghost) pacerKind = 'rival';
      else toast('That ghost is gone — pacing at 55 WPM instead', 'info', 3000);
    } else if (pacer === 'wr' || pacer === 'pb') {
      ghost = await this.fetchGhost(p.id, pacer);
      if (ghost) pacerKind = pacer;
      else toast(pacer === 'wr' ? 'No world record on this passage yet — pacing at 55 WPM. Set the record!' : 'No personal best on this passage yet — pacing at 55 WPM.', 'info', 3000);
    }
    if (ghost && !(ghost.timeline && ghost.timeline.length >= 2 && ghost.wpm > 0)) ghost = null;
    const pacerWpm = ghost ? ghost.wpm : this.resolvePacer(pacer === 'wr' || pacer === 'pb' || (pacer && typeof pacer === 'object') ? 'medium' : pacer);
    const meId = this.myId();
    const players = [{ id: meId, name: me.name, country: me.country, isBot: false, role: 'human', color: '#4cc9f0', skin: me.skin }];
    if (ghost) players.push({ id: PACER_ID, name: pacerName || ghost.name, country: ghost.country || 'UN', isBot: true, role: 'ghost', color: '#fbbf24', skin: ghost.skin || 'dash' });
    else if (pacerWpm > 0) players.push({ id: PACER_ID, name: pacerName || 'Robot', country: 'UN', isBot: true, role: 'pacer', color: '#8a8fa8', skin: 'hatch' });

    this.serverResult = null;
    this.serverMsg = null;
    this.run = {
      mode,
      dailyNumber,
      passage: p,
      len: p.text.length,
      bonusWords: bonusWords || pickBonusWords(p.text, this.bonusCount),
      pacerWpm,
      pacerCps: (pacerWpm * 5) / 60,
      pacerKind,
      ghost: ghost ? { name: ghost.name, wpm: ghost.wpm, timeline: ghost.timeline, time: ghost.timeline[ghost.timeline.length - 1][0] } : null,
      players,
      meId,
      raceNo: ++this.raceNo,
      state: 'countdown',
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
      startAt: null,
      finishOrder: 0,
      timeline: [],
      lastT: 0,
      lastC: 0,
      stats: { keystrokes: 0, errors: 0, correct: 0 },
      pacerShown: -1,
      pacerFinish: null,
      myFinish: null,
      result: null,
    };
    const run = this.run;
    this.emit(this.roomState('countdown'));
    setTimeout(() => { if (this.run === run) this.go(); }, COUNTDOWN_MS);
    return true;
  }

  go() {
    const run = this.run;
    run.state = 'racing';
    run.startAt = Date.now();
    this.emit(this.roomState('racing'));
    // the only thing the server needs while a practice run is in progress
    this.net.send({ type: 'solo_start', passageId: run.passage.id, mode: run.mode });
  }

  /** What a server room would have broadcast for this transition. */
  roomState(state, extra = {}) {
    const r = this.run;
    return {
      type: 'room',
      solo: true,
      mode: r.mode,
      localClock: true,
      meId: r.meId,
      code: r.mode === 'daily' ? 'DAILY' : 'PRACTICE',
      isPrivate: true,
      hostId: r.meId,
      state,
      raceNo: r.raceNo,
      maxPlayers: 2,
      players: r.players,
      passage: r.passage.text,
      passageId: r.passage.id,
      passageTitle: r.passage.title,
      passageLang: r.passage.lang,
      lang: r.passage.lang,
      category: r.passage.category,
      bonusWords: r.bonusWords,
      emotes: [],
      ranked: false,
      series: [],
      lobbyDeadline: null,
      countdownEndsAt: r.countdownEndsAt,
      startAt: r.startAt,
      endAt: null,
      resultsUntil: null,
      results: null,
      serverTime: Date.now(),
      pacerWpm: r.pacerWpm,
      fractionOf: (id, now) => this.fractionOf(id, now),
      tick: (now) => this.tick(now),
      ...extra,
    };
  }

  /** Progress 0..1 of a racer at local time `now` (the pacer is a pure function of elapsed time). */
  fractionOf(id, now) {
    const r = this.run;
    if (!r || id !== PACER_ID || !r.startAt) return 0;
    if (r.ghost) return clamp01(ghostChars(r.ghost.timeline, now - r.startAt) / r.len);
    if (!r.pacerCps) return 0;
    const chars = (Math.max(0, now - r.startAt - PACER_REACTION_MS) / 1000) * r.pacerCps;
    return clamp01(chars / r.len);
  }

  /** When the pacer crosses the line (ms after GO). */
  pacerTime() {
    const r = this.run;
    return r.ghost ? r.ghost.time : Math.round(PACER_REACTION_MS + (r.len / r.pacerCps) * 1000);
  }

  get hasPacer() { return !!this.run && (!!this.run.ghost || !!this.run.pacerCps); }

  /** Called every animation frame while racing: drives the pacer's stats and finish. */
  tick(now) {
    const r = this.run;
    if (!r || r.state !== 'racing' || !this.hasPacer) return;
    const f = this.fractionOf(PACER_ID, now);
    if (Math.abs(f - r.pacerShown) >= 0.004 || (f >= 1 && r.pacerShown < 1)) {
      r.pacerShown = f;
      const elapsed = now - r.startAt;
      const wpm = elapsed > 800 ? Math.min(r.pacerWpm, Math.round(((f * r.len) / 5) / (elapsed / 60000))) : 0;
      this.track.updateMeta(PACER_ID, { wpm, pct: f });
    }
    if (f >= 1 && !r.pacerFinish) {
      const time = this.pacerTime();
      r.pacerFinish = { time, rank: ++r.finishOrder };
      this.emit({ type: 'finished', id: PACER_ID, rank: r.pacerFinish.rank, time, wpm: r.pacerWpm, accuracy: 97 });
    }
  }

  /** A keystroke landed (TypingArea.onChange). Records the timeline and detects the finish. */
  onProgress(res) {
    const r = this.run;
    if (!r || r.state !== 'racing' || r.myFinish) return;
    const t = Date.now() - r.startAt;
    if (res.correct > r.lastC) {
      if (res.done || t - r.lastT >= SAMPLE_MS) {
        if (r.timeline.length < MAX_SAMPLES) r.timeline.push([t, res.correct]);
        else r.timeline[r.timeline.length - 1] = [t, res.correct];
        r.lastT = t;
      }
      r.lastC = res.correct;
    }
    r.stats = { keystrokes: res.keystrokes, errors: res.errors, correct: res.correct };
    if (res.done) this.finish(t);
  }

  finish(t) {
    const r = this.run;
    if (r.timeline.length === 0 || r.timeline[r.timeline.length - 1][1] !== r.len) r.timeline.push([t, r.len]);
    r.myFinish = { time: t, rank: ++r.finishOrder };
    const { keystrokes, errors } = r.stats;
    const wpm = Math.round((r.len / 5) / (t / 60000));
    const accuracy = keystrokes > 0 ? Math.floor(((keystrokes - errors) / keystrokes) * 100) : 100;
    r.result = { wpm, accuracy, time: t, errors, keystrokes };
    this.emit({ type: 'finished', id: r.meId, rank: r.myFinish.rank, time: t, wpm, accuracy });
    setTimeout(() => { if (this.run === r) this.showResults(); }, RESULTS_DELAY_MS);
  }

  showResults() {
    const r = this.run;
    r.state = 'finished';
    const me = r.players[0];
    const results = [{
      id: r.meId, name: me.name, country: me.country, isBot: false, color: me.color, skin: me.skin,
      rank: r.myFinish.rank, wpm: r.result.wpm, accuracy: r.result.accuracy, time: r.result.time, progress: 1, finished: true,
      score: this.game.score, bestCombo: this.game.bestCombo, golden: this.game.golden,
    }];
    if (this.hasPacer) {
      const pacer = r.players[1];
      results.push({
        id: PACER_ID, name: pacer.name, country: pacer.country, isBot: true, color: pacer.color, skin: pacer.skin,
        rank: r.pacerFinish ? r.pacerFinish.rank : 2, wpm: r.pacerWpm, accuracy: 97,
        time: r.pacerFinish ? r.pacerFinish.time : null, progress: this.fractionOf(PACER_ID, Date.now()), finished: !!r.pacerFinish,
        score: 0, bestCombo: 0, golden: 0,
      });
      results.sort((a, b) => a.rank - b.rank);
    }
    this.emit(this.roomState('finished', { results }));
    this.submit();
  }

  /** The one message a practice run sends to the server. */
  submit() {
    const r = this.run;
    const g = this.game;
    const msg = {
      type: 'solo_done',
      passageId: r.passage.id,
      mode: r.mode,
      chars: r.len,
      finished: true,
      time: r.result.time,
      keystrokes: r.result.keystrokes,
      errors: r.result.errors,
      golden: g.golden,
      goldenTotal: g.goldenTotal,
      bestCombo: g.bestCombo,
      nitros: g.nitros,
      score: g.score,
      pacerWpm: r.pacerWpm || null,
      pacerKind: r.pacerKind,
      timeline: r.timeline,
    };
    if (!this.net.send(msg)) {
      this.pending = msg;
      toast('Your result will be saved when the connection returns', 'info', 2600);
    }
  }

  flush() {
    if (!this.pending) return;
    const m = this.pending;
    this.pending = null;
    this.net.send(m);
  }

  /** Server accepted the run (`race_result` with a `solo` block, plus `daily` for the daily challenge). */
  onResult(msg) {
    this.serverResult = msg.solo;
    this.serverMsg = msg;
    this.renderResults();
  }

  again() {
    return this.start(this.lastOpts || {});
  }

  abort() {
    this.run = null;
    this.serverResult = null;
  }

  title() {
    const r = this.run;
    if (!r || !r.result) return 'Your go';
    if (r.mode === 'daily') return `⚡ Today's paragraph${r.dailyNumber ? ` · #${r.dailyNumber}` : ''}`;
    if (r.ghost) return r.myFinish.rank === 1 ? '👻 You were faster!' : '👻 They were faster';
    if (r.pacerCps && r.myFinish.rank === 1) return '🏎️ You beat the robot!';
    if (r.pacerCps) return '🐢 The robot was faster';
    return '🏃 Nice one';
  }

  /** Fill the practice block of the results modal (local numbers first, server verdict when it arrives). */
  renderResults() {
    const r = this.run;
    if (!r || !r.result) return;
    const $ = (id) => document.getElementById(id);
    const sr = this.serverResult;
    const best = sr ? sr.best : this.identity().bestWpm || 0;
    $('sr-wpm').textContent = r.result.wpm;
    $('sr-acc').textContent = `${r.result.accuracy}%`;
    $('sr-time').textContent = fmtTime(r.result.time);
    $('sr-best').textContent = best ? `${best} words a min` : '—';

    const lines = [];
    const d = this.serverMsg && this.serverMsg.daily;
    if (r.mode === 'daily' && d) {
      if (d.counted) {
        lines.push(`<span class="sr-line win">✅ This one counted — you are #${d.rank} of ${d.of} today</span>`);
        if (d.streak > 1) lines.push(`<span class="sr-line pb">🔥 ${d.streak} days in a row</span>`);
      } else if (d.reason === 'already-played') {
        lines.push(`<span class="sr-line dim">You already had your go today, so this one was just for fun. The one that counted: <b>${d.entry.wpm} words a min</b>, #${d.rank} of ${d.of}.</span>`);
      } else if (d.reason === 'unverified') {
        lines.push('<span class="sr-line lose">⚠️ This one did not count — your internet dropped part way through. Try again.</span>');
      } else if (d.reason === 'not-today') {
        lines.push('<span class="sr-line lose">This one did not count — the day changed while you were typing. Have a go at today\'s paragraph.</span>');
      }
    }
    if (this.hasPacer) {
      const diff = (Math.abs(this.pacerTime() - r.result.time) / 1000).toFixed(1);
      const won = r.myFinish.rank === 1;
      if (r.ghost) {
        const who = `${escapeHtml(r.ghost.name)}'s run (${r.ghost.wpm} words a min)`;
        lines.push(won ? `<span class="sr-line win">👻 You beat ${who} by ${diff} s</span>` : `<span class="sr-line lose">👻 ${who} was ${diff} s faster</span>`);
      } else {
        lines.push(won ? `<span class="sr-line win">🏎️ You beat the robot (${r.pacerWpm} words a min) by ${diff} s</span>` : `<span class="sr-line lose">🐢 The robot (${r.pacerWpm} words a min) was ${diff} s faster</span>`);
      }
    }
    if (sr) {
      if (sr.ghost && sr.ghost.wr) lines.push('<span class="sr-line pb">🌍 Nobody on TypeDash has typed this paragraph faster!</span>');
      else if (sr.ghost && sr.ghost.pb) lines.push('<span class="sr-line pb">👻 Your best yet on this paragraph — saved, so you can race yourself later</span>');
      if (sr.improved) lines.push('<span class="sr-line pb">🏆 Your fastest on your own so far</span>');
      if (!sr.verified) lines.push('<span class="sr-line dim">Saved, but it will not count towards records — you went offline part way through.</span>');
      lines.push(`<span class="sr-line dim">${sr.runs} ${sr.runs === 1 ? 'go' : 'goes'} on your own so far</span>`);
    } else {
      lines.push('<span class="sr-line dim">Saving…</span>');
    }
    $('sr-lines').innerHTML = lines.join('');
    $('sr-passage').textContent = r.passage.title ? `“${r.passage.title}”` : '';
  }
}

export { escapeHtml };
