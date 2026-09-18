import { TypingArea } from './typing.js';
import { RaceGame } from './game.js';
import { pickBonusWords } from './solo.js';
import { fmtTime } from './ui.js';

/**
 * The embeddable widget (/embed): a self-contained typing race against a
 * pacer bar, with no socket and no account. Everything happens in the
 * iframe; the only server involvement is the cached passage catalogue. It
 * ends on a link into the full game, which is the whole point of it.
 */
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const ORIGIN = location.origin;
const PACER_WPM = Math.max(0, Math.min(200, Number(params.get('pacer')) || 50));
const PACER_REACTION_MS = 350;

const el = {
  passage: $('#passage'), input: $('#hidden-input'), wpm: $('#e-wpm'), acc: $('#e-acc'), time: $('#e-time'),
  me: $('#bar-me'), pacer: $('#bar-pacer'), pacerLabel: $('#pacer-label'), status: $('#e-status'),
  result: $('#result'), rWpm: $('#r-wpm'), rAcc: $('#r-acc'), rTime: $('#r-time'), rLine: $('#r-line'), again: $('#btn-again'), play: $('#btn-play'),
};

const typing = new TypingArea(el.passage, el.input);
const game = new RaceGame();
let catalogue = [];
let run = null;

function postHeight() {
  try { parent.postMessage({ type: 'typedash:height', height: document.documentElement.scrollHeight }, '*'); } catch (_) { /* not framed */ }
}
new ResizeObserver(postHeight).observe(document.body);

async function load() {
  try {
    const res = await fetch('/api/passages');
    catalogue = (await res.json()).passages;
  } catch (_) {
    el.status.textContent = 'Could not load a paragraph. Refresh to try again.';
    return;
  }
  setup();
}

function pick() {
  const wanted = params.get('passage');
  return catalogue.find((p) => p.id === wanted) || catalogue[Math.floor(Math.random() * catalogue.length)];
}

function setup() {
  const p = pick();
  run = { passage: p, len: p.text.length, startAt: 0, done: false, pacerDone: false };
  typing.setPassage(p.text, pickBonusWords(p.text, 3));
  game.start([]);
  typing.setEnabled(true);
  el.result.hidden = true;
  el.status.textContent = `“${p.title}” · ${p.words} words · start typing to race a robot at ${PACER_WPM} words a minute`;
  el.pacerLabel.textContent = PACER_WPM ? `Robot · ${PACER_WPM} a min` : '';
  el.me.style.width = '0%';
  el.pacer.style.width = '0%';
  el.wpm.textContent = '0';
  el.acc.textContent = '100%';
  el.time.textContent = '0:00.0';
  el.passage.addEventListener('click', () => typing.focus(), { once: false });
  postHeight();
}

typing.onChange = (r) => {
  if (!run || run.done) return;
  if (!run.startAt && r.added) {   // the clock starts on the first keystroke
    run.startAt = performance.now();
    el.status.textContent = 'Go!';
  }
  game.onKey(r);
  if (r.done) finish(r);
};

function finish(r) {
  run.done = true;
  const t = performance.now() - run.startAt;
  const wpm = Math.round((run.len / 5) / (t / 60000));
  const acc = r.keystrokes ? Math.floor(((r.keystrokes - r.errors) / r.keystrokes) * 100) : 100;
  const pacerTime = PACER_WPM ? PACER_REACTION_MS + (run.len / ((PACER_WPM * 5) / 60)) * 1000 : null;
  el.rWpm.textContent = wpm;
  el.rAcc.textContent = `${acc}%`;
  el.rTime.textContent = fmtTime(t);
  el.rLine.textContent = pacerTime == null ? 'Nice one.' : t < pacerTime ? `🏎️ You beat the robot (${PACER_WPM} words a min) by ${((pacerTime - t) / 1000).toFixed(1)} s.` : `🐢 The robot (${PACER_WPM} words a min) was ${((t - pacerTime) / 1000).toFixed(1)} s faster.`;
  el.play.href = `${ORIGIN}/app?ref=embed#practice/${run.passage.id}`;
  el.result.hidden = false;
  el.status.textContent = 'Finished';
  typing.setEnabled(false);
  postHeight();
}

function frame(now) {
  if (run && run.startAt && !run.done) {
    const elapsed = now - run.startAt;
    const wpm = elapsed > 800 ? Math.round((typing.correct / 5) / (elapsed / 60000)) : 0;
    el.wpm.textContent = wpm;
    el.acc.textContent = `${typing.keystrokes ? Math.floor(((typing.keystrokes - typing.errors) / typing.keystrokes) * 100) : 100}%`;
    el.time.textContent = fmtTime(elapsed);
    el.me.style.width = `${(typing.correct / run.len) * 100}%`;
    if (PACER_WPM) {
      const chars = (Math.max(0, elapsed - PACER_REACTION_MS) / 1000) * ((PACER_WPM * 5) / 60);
      el.pacer.style.width = `${Math.min(100, (chars / run.len) * 100)}%`;
    }
  }
  requestAnimationFrame(frame);
}

el.again.addEventListener('click', () => setup());
document.addEventListener('keydown', (e) => {
  if (run && !run.done && document.activeElement !== el.input && e.key.length === 1) typing.focus();
});
requestAnimationFrame(frame);
load();
