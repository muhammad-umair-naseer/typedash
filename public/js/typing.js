/**
 * Renders the passage as per-character spans and turns a hidden <input>'s
 * value into race progress.
 *
 *  - `correct` is the length of the longest prefix of the input that matches
 *    the passage; only that counts as progress (the server uses the same
 *    definition).
 *  - Trailing mistakes are allowed (so you can see and fix them) but capped at
 *    MAX_TRAIL so a runaway typo does not scroll the whole passage red.
 *  - Keystrokes and errors are counted on insertion only, which is the usual
 *    definition of accuracy in typing games.
 *  - Words are tracked so the game layer can reward flawless words and golden
 *    (bonus) words: a word is "committed" once its trailing space is part of
 *    the correct prefix (or the passage ends).
 */
const MAX_TRAIL = 8;

export class TypingArea {
  constructor(passageEl, inputEl) {
    this.el = passageEl;
    this.input = inputEl;
    this.onChange = null;
    this.onBlur = null;
    this.onFocus = null;

    this.text = '';
    this.chars = [];
    this.words = [];        // word span elements
    this.wordCommitAt = []; // correct-prefix length at which word i is committed
    this.wordsCommitted = 0;
    this.errorsInWord = 0;
    this.typed = '';
    this.correct = 0;
    this.keystrokes = 0;
    this.errors = 0;
    this.enabled = false;
    this.done = false;

    this.input.addEventListener('input', () => this.handle(this.input.value));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
    });
    this.input.addEventListener('paste', (e) => e.preventDefault());
    this.input.addEventListener('drop', (e) => e.preventDefault());
    this.input.addEventListener('blur', () => this.onBlur && this.onBlur());
    this.input.addEventListener('focus', () => this.onFocus && this.onFocus());
    this.setPassage('');
  }

  setPassage(text, bonusWords = []) {
    this.text = text || '';
    this.typed = '';
    this.correct = 0;
    this.keystrokes = 0;
    this.errors = 0;
    this.done = false;
    this.wordsCommitted = 0;
    this.errorsInWord = 0;
    this.input.value = '';
    this.el.innerHTML = '';
    this.chars = [];
    this.words = [];
    this.wordCommitAt = [];
    this.el.scrollTop = 0;

    if (!this.text) {
      const ph = document.createElement('span');
      ph.className = 'placeholder';
      ph.textContent = 'The paragraph appears here when the countdown ends. Tap any key while you wait.';
      this.el.appendChild(ph);
      return;
    }

    const bonus = new Set(bonusWords);
    // group characters into words (trailing space stays with the word) so a
    // word never wraps in the middle
    let word = document.createElement('span');
    word.className = 'w';
    const frag = document.createDocumentFragment();
    const pushWord = (commitAt) => {
      const idx = this.words.length;
      if (bonus.has(idx)) {
        word.classList.add('gold');
        word.title = 'Bonus word: type it with no mistakes for extra points';
      }
      this.words.push(word);
      this.wordCommitAt.push(commitAt);
      frag.appendChild(word);
    };
    for (let i = 0; i < this.text.length; i++) {
      const ch = this.text[i];
      const span = document.createElement('span');
      span.className = ch === ' ' ? 'c sp' : 'c';
      span.textContent = ch;
      this.chars.push(span);
      word.appendChild(span);
      if (ch === ' ') {
        pushWord(i + 1);
        word = document.createElement('span');
        word.className = 'w';
      }
    }
    if (word.childNodes.length) pushWord(this.text.length);
    this.el.appendChild(frag);
    this.paint(0, 0);
  }

  setEnabled(v) {
    this.enabled = v;
    this.el.classList.toggle('locked', !v);
    if (v) this.focus();
  }

  /**
   * Focus the input. Normally only while enabled; `force` focuses during the
   * countdown too, so a touch device can raise its keyboard inside a tap
   * gesture and have it ready at GO (iOS refuses programmatic focus otherwise).
   */
  focus(force = false) {
    if (!this.enabled && !force) return;
    this.input.focus({ preventScroll: true });
  }

  handle(value) {
    if (!this.enabled || this.done || !this.text) {
      this.input.value = this.typed;
      return;
    }

    let correct = 0;
    const n = Math.min(value.length, this.text.length);
    while (correct < n && value[correct] === this.text[correct]) correct++;

    if (value.length > this.text.length || value.length - correct > MAX_TRAIL) {
      this.input.value = this.typed; // reject: too many trailing mistakes
      return;
    }

    // first index where the new value differs from what was typed before
    let diff = 0;
    const m = Math.min(value.length, this.typed.length);
    while (diff < m && value[diff] === this.typed[diff]) diff++;

    let added = 0;
    let lastKeyOk = true;
    if (value.length > this.typed.length) {
      for (let i = diff; i < value.length; i++) {
        this.keystrokes++;
        added++;
        if (value[i] !== this.text[i]) { this.errors++; this.errorsInWord++; lastKeyOk = false; }
      }
    }

    const prevLen = this.typed.length;
    this.typed = value;
    this.correct = correct;
    this.done = value === this.text;

    // word commits (a single keystroke commits at most one word, but loop anyway)
    let wordDone = null;
    while (this.wordsCommitted < this.words.length && correct >= this.wordCommitAt[this.wordsCommitted]) {
      const index = this.wordsCommitted;
      const flawless = this.errorsInWord === 0;
      const w = this.words[index];
      w.classList.add(flawless ? 'done-ok' : 'done');
      if (w.classList.contains('gold')) w.classList.add(flawless ? 'gold-hit' : 'gold-miss');
      wordDone = { index, flawless };
      this.wordsCommitted++;
      this.errorsInWord = 0;
    }

    this.paint(diff, Math.max(prevLen, value.length));
    this.keepCaretVisible();

    if (this.done) this.enabled = false;
    if (this.onChange) {
      this.onChange({
        correct,
        typed: value.length,
        keystrokes: this.keystrokes,
        errors: this.errors,
        done: this.done,
        added,
        ok: lastKeyOk,
        lastKeyOk,
        wordDone,
      });
    }
  }

  /** Repaint character classes in [lo, hi] (inclusive). */
  paint(lo, hi) {
    const t = this.typed;
    const end = Math.min(hi, this.chars.length - 1);
    for (let i = Math.max(0, lo); i <= end; i++) {
      const el = this.chars[i];
      let cls = this.text[i] === ' ' ? 'c sp' : 'c';
      if (i < t.length) cls += t[i] === this.text[i] ? ' ok' : ' bad';
      else if (i === t.length) cls += ' cur';
      el.className = cls;
    }
  }

  keepCaretVisible() {
    const cur = this.chars[this.typed.length];
    if (!cur) return;
    const box = this.el.getBoundingClientRect();
    const r = cur.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) {
      cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}
